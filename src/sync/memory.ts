import type { IndexValues, RangeQuery, Store, StoreAdapter, StoreTx, StoredRecord, TableDef } from './store'
import { createMutex, createTxGuard, inBounds } from './store'

interface Entry {
  value: unknown
  index: IndexValues
}

type Table = Map<string, Entry>

interface Database {
  defs: Map<string, TableDef>
  tables: Map<string, Table>
  exclusive: ReturnType<typeof createMutex>
}

function clone<V>(value: V): V {
  return structuredClone(value)
}

function rangeOf(def: TableDef, table: Table, query: RangeQuery): [string, Entry][] {
  const { index } = query
  if (index !== undefined && !def.indexes.includes(index)) {
    throw new Error(`sync store: table ${def.name} has no index ${index}`)
  }
  // What a record is ranged and ordered by: its key, or its value in the index.
  const valueOf =
    index === undefined ? (record: [string, Entry]) => record[0] : (record: [string, Entry]) => record[1].index[index]
  const matching = [...table].filter((record) => {
    const value = valueOf(record)
    return value !== undefined && inBounds(value, query)
  })
  matching.sort((a, b) => {
    const left = valueOf(a) as string
    const right = valueOf(b) as string
    // Stryker disable next-line EqualityOperator: the two are unequal here, so < and <= agree
    if (left !== right) return left < right ? -1 : 1
    // Stryker disable next-line EqualityOperator: keys are unique, so < and <= agree
    return a[0] < b[0] ? -1 : 1
  })
  if (query.reverse) matching.reverse()
  const start = query.offset ?? 0
  return matching.slice(start, query.limit === undefined ? undefined : start + query.limit)
}

/**
 * A store that lives in memory: for tests, server rendering and a device that should keep nothing.
 * One adapter keeps its databases for its own lifetime, so a test can close and reopen one.
 */
export function createMemoryAdapter(): StoreAdapter {
  const databases = new Map<string, Database>()

  return {
    async open(name: string, tables: readonly TableDef[]): Promise<Store> {
      const database = databases.get(name) ?? {
        defs: new Map(),
        tables: new Map(),
        exclusive: createMutex(),
      }
      databases.set(name, database)
      const listed = new Set(tables.map((def) => def.name))
      for (const existing of [...database.tables.keys()]) {
        if (!listed.has(existing)) database.tables.delete(existing)
      }
      database.defs = new Map(tables.map((def) => [def.name, def]))
      for (const def of tables) {
        const table = database.tables.get(def.name) ?? new Map<string, Entry>()
        // A dropped index is forgotten, so adding it back starts it empty, as in the other adapters.
        for (const [key, entry] of table) {
          const index = Object.fromEntries(Object.entries(entry.index).filter(([name]) => def.indexes.includes(name)))
          table.set(key, { value: entry.value, index })
        }
        database.tables.set(def.name, table)
      }

      let closed = false
      return {
        transaction(names, mode, fn) {
          return database.exclusive(async () => {
            if (closed) throw new Error('sync store: the database is closed')
            const working = new Map<string, Table>()
            function tableOf(table: string, write: boolean): [TableDef, Table] {
              const def = database.defs.get(table)
              if (def === undefined || !names.includes(table)) {
                throw new Error(`sync store: table ${table} is not part of this transaction`)
              }
              if (write && mode === 'readonly') {
                throw new Error('sync store: a readonly transaction cannot write')
              }
              // A write copies the table once, so a transaction that throws leaves the original untouched.
              if (write && !working.has(table)) working.set(table, new Map(database.tables.get(table)))
              return [def, (working.get(table) ?? database.tables.get(table)) as Table]
            }
            const guard = createTxGuard()
            const tx: StoreTx = {
              get: (table, key) =>
                guard.run(() => {
                  const entry = tableOf(table, false)[1].get(key)
                  return entry === undefined ? undefined : clone(entry.value as never)
                }),
              put: (table, key, value, index = {}) =>
                guard.run(() => {
                  tableOf(table, true)[1].set(key, { value: clone(value), index: { ...index } })
                }),
              delete: (table, key) =>
                guard.run(() => {
                  tableOf(table, true)[1].delete(key)
                }),
              clear: (table) =>
                guard.run(() => {
                  tableOf(table, true)[1].clear()
                }),
              range: <V>(table: string, query: RangeQuery = {}) =>
                guard.run(() =>
                  rangeOf(...tableOf(table, false), query).map(([key, entry]): StoredRecord<V> => ({
                    key,
                    value: clone(entry.value as V),
                  }))
                ),
              count: (table, query = {}) => guard.run(() => rangeOf(...tableOf(table, false), query).length),
            }
            try {
              const result = await fn(tx)
              for (const [table, contents] of working) database.tables.set(table, contents)
              return result
            } finally {
              guard.end()
            }
          })
        },
        close() {
          closed = true
        },
      }
    },
    async deleteDatabase(name: string) {
      databases.delete(name)
    },
  }
}
