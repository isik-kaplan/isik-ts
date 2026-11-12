import type { CountQuery, RangeQuery, Store, StoreAdapter, StoreTx, StoredRecord, TableDef } from './store'
import { TransactionInactiveError } from './store'

interface Stored {
  k: string
  v: unknown
  i: Record<string, string>
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// IndexedDB's own inactive error is a DOMException; every adapter throws the one class instead.
function inactiveAware<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    // Stryker disable next-line all: fake-indexeddb never reports this - its transactions finish first - and browsers do
    if ((error as DOMException).name === 'TransactionInactiveError') throw new TransactionInactiveError()
    throw error
  }
}

function keyRangeOf(query: CountQuery): IDBKeyRange | null | undefined {
  const { lower, upper, lowerOpen = false, upperOpen = false } = query
  if (lower !== undefined && upper !== undefined) {
    // IndexedDB throws on an empty range; an empty one simply matches nothing.
    if (lower > upper || (lower === upper && (lowerOpen || upperOpen))) return null
    return IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen)
  }
  if (lower !== undefined) return IDBKeyRange.lowerBound(lower, lowerOpen)
  if (upper !== undefined) return IDBKeyRange.upperBound(upper, upperOpen)
  return undefined
}

function matchesSchema(db: IDBDatabase, tables: readonly TableDef[]): boolean {
  if (db.objectStoreNames.length !== tables.length) return false
  if (!tables.every((def) => db.objectStoreNames.contains(def.name))) return false
  if (tables.length === 0) return true
  const transaction = db.transaction(tables.map((def) => def.name))
  return tables.every((def) => {
    const names = [...transaction.objectStore(def.name).indexNames]
    return names.length === def.indexes.length && def.indexes.every((index) => names.includes(index))
  })
}

export interface IndexedDBAdapterOptions {
  /** The IndexedDB to use. Default: the global one. */
  indexedDB?: IDBFactory
}

/**
 * A store in the browser's IndexedDB. A schema change is an upgrade to the next version; another tab
 * holding the old one is asked to close it, and reopens on its next transaction.
 */
export function createIndexedDBAdapter(options: IndexedDBAdapterOptions = {}): StoreAdapter {
  const factory = (): IDBFactory => options.indexedDB ?? globalThis.indexedDB

  function upgrade(name: string, version: number | undefined, tables: readonly TableDef[]): Promise<IDBDatabase> {
    const request = factory().open(name, version)
    request.onupgradeneeded = () => {
      const db = request.result
      const transaction = request.transaction as IDBTransaction
      const listed = new Set(tables.map((def) => def.name))
      for (const existing of [...db.objectStoreNames]) {
        if (!listed.has(existing)) db.deleteObjectStore(existing)
      }
      for (const def of tables) {
        const store = db.objectStoreNames.contains(def.name)
          ? transaction.objectStore(def.name)
          : db.createObjectStore(def.name, { keyPath: 'k' })
        const dropped = [...store.indexNames].filter((index) => !def.indexes.includes(index))
        for (const index of dropped) store.deleteIndex(index)
        // Records keep their values for a dropped index unless stripped, and would fill it again if it
        // came back: stripped, it comes back empty, as in the other adapters.
        // Stryker disable next-line ConditionalExpression,EqualityOperator: stripping nothing from every record writes them back unchanged
        if (dropped.length > 0) {
          const cursorRequest = store.openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (cursor === null) return
            const stored = cursor.value as Stored
            for (const index of dropped) delete stored.i[index]
            cursor.update(stored)
            cursor.continue()
          }
        }
        for (const index of def.indexes) {
          if (!store.indexNames.contains(index)) store.createIndex(index, `i.${index}`)
        }
      }
    }
    return settle(request)
  }

  async function connect(name: string, tables: readonly TableDef[]): Promise<IDBDatabase> {
    const current = await upgrade(name, undefined, tables)
    if (matchesSchema(current, tables)) return current
    const next = current.version + 1
    current.close()
    return upgrade(name, next, tables)
  }

  return {
    async open(name, tables) {
      const defs = new Map(tables.map((def) => [def.name, def]))
      let db: IDBDatabase | undefined
      let closed = false

      async function database(): Promise<IDBDatabase> {
        if (db === undefined) {
          const opened = await connect(name, tables)
          opened.onversionchange = () => {
            opened.close()
            db = undefined
          }
          db = opened
        }
        return db
      }
      await database()

      const store: Store = {
        async transaction(names, mode, fn) {
          if (closed) throw new Error('sync store: the database is closed')
          const unknown = names.find((table) => !defs.has(table))
          if (unknown !== undefined) throw new Error(`sync store: table ${unknown} is not part of this transaction`)
          const transaction = (await database()).transaction(names, mode)
          let finished = false
          const done = new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => {
              finished = true
              resolve()
            }
            // Stryker disable next-line BlockStatement: an abort the adapter did not start - a quota error - finishes it too; fake-indexeddb raises none
            transaction.onabort = () => {
              // Stryker disable next-line BooleanLiteral: as above
              finished = true
              reject(transaction.error)
            }
          })
          // A finished transaction refuses with InvalidStateError, an inactive one with
          // TransactionInactiveError; to the caller both are the one mistake.
          const objectStore = (table: string, write = false) => {
            if (finished) throw new TransactionInactiveError()
            if (!defs.has(table) || !names.includes(table)) {
              throw new Error(`sync store: table ${table} is not part of this transaction`)
            }
            if (write && mode === 'readonly') throw new Error('sync store: a readonly transaction cannot write')
            return inactiveAware(() => transaction.objectStore(table))
          }
          const source = (table: string, index: string | undefined) => {
            const store = objectStore(table)
            if (index === undefined) return store
            if (!(defs.get(table) as TableDef).indexes.includes(index)) {
              throw new Error(`sync store: table ${table} has no index ${index}`)
            }
            return inactiveAware(() => store.index(index))
          }

          const tx: StoreTx = {
            async get<V>(table: string, key: string) {
              const stored = await settle<Stored | undefined>(inactiveAware(() => objectStore(table).get(key)))
              return stored?.v as V | undefined
            },
            async put(table, key, value, index = {}) {
              // Stryker disable next-line ConditionalExpression,MethodExpression: an undefined value is no key, and IndexedDB leaves it out of the index either way
              const defined = Object.fromEntries(Object.entries(index).filter(([, v]) => v !== undefined))
              await settle(inactiveAware(() => objectStore(table, true).put({ k: key, v: value, i: defined })))
            },
            async delete(table, key) {
              await settle(inactiveAware(() => objectStore(table, true).delete(key)))
            },
            async clear(table) {
              await settle(inactiveAware(() => objectStore(table, true).clear()))
            },
            range<V>(table: string, query: RangeQuery = {}) {
              const range = keyRangeOf(query)
              if (range === null) return Promise.resolve([])
              const request = inactiveAware(() =>
                source(table, query.index).openCursor(range, query.reverse ? 'prev' : 'next')
              )
              const results: StoredRecord<V>[] = []
              let skip = query.offset ?? 0
              return new Promise<StoredRecord<V>[]>((resolve, reject) => {
                request.onerror = () => reject(request.error)
                request.onsuccess = () => {
                  const cursor = request.result
                  if (cursor === null || results.length === query.limit) return resolve(results)
                  if (skip > 0) {
                    cursor.advance(skip)
                    skip = 0
                    return
                  }
                  const stored = cursor.value as Stored
                  results.push({ key: stored.k, value: stored.v as V })
                  cursor.continue()
                }
              })
            },
            count(table, query = {}) {
              const range = keyRangeOf(query)
              if (range === null) return Promise.resolve(0)
              return settle(inactiveAware(() => source(table, query.index).count(range)))
            },
          }

          let result: Awaited<ReturnType<typeof fn>>
          try {
            result = await fn(tx)
          } catch (error) {
            finished = true
            try {
              transaction.abort()
            } catch {
              // Already finished: nothing it wrote can be undone, and the error is still the caller's.
            }
            done.catch(() => undefined)
            throw error
          }
          await done
          return result
        },
        close() {
          closed = true
          db?.close()
        },
      }
      return store
    },
    async deleteDatabase(name) {
      await settle(factory().deleteDatabase(name))
    },
  }
}
