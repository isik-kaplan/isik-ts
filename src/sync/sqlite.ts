import type { CountQuery, RangeQuery, Store, StoreAdapter, StoreTx, TableDef } from './store'
import { createTxGuard } from './store'

export type SQLiteValue = string | number | null

/** The statements the adapter runs, inside or outside a transaction. */
export interface SQLiteQueries {
  run(sql: string, params?: readonly SQLiteValue[]): Promise<void>
  all<T>(sql: string, params?: readonly SQLiteValue[]): Promise<T[]>
}

/** One open SQLite database. Expo's is wrapped by `expoSQLite`; any other binding fits the same shape. */
export interface SQLiteDatabase extends SQLiteQueries {
  /** Runs `fn` exclusively in one transaction, committed when it resolves and rolled back when it throws. */
  transaction<T>(fn: (queries: SQLiteQueries) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export interface SQLiteAdapterOptions {
  openDatabase(name: string): Promise<SQLiteDatabase>
  deleteDatabase(name: string): Promise<void>
}

// SQLite compares text as UTF-8 bytes, and IndexedDB and JavaScript as UTF-16 code units; the two
// disagree once an emoji meets a character above U+E000. Sorted columns therefore hold every code unit
// as four hex digits, whose byte order is code-unit order.
function sortable(value: string): string {
  // Stryker disable next-line StringLiteral: a prefix shared by every sorted value keeps their order
  let result = ''
  for (let i = 0; i < value.length; i += 1) result += value.charCodeAt(i).toString(16).padStart(4, '0')
  return result
}

function quoted(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

const records = (table: string) => quoted(`t:${table}`)
const indexRows = (table: string) => quoted(`x:${table}`)

function boundsOf(column: string, query: CountQuery): [string, SQLiteValue[]] {
  const clauses: string[] = []
  const params: SQLiteValue[] = []
  if (query.lower !== undefined) {
    clauses.push(`${column} ${query.lowerOpen ? '>' : '>='} ?`)
    params.push(sortable(query.lower))
  }
  if (query.upper !== undefined) {
    clauses.push(`${column} ${query.upperOpen ? '<' : '<='} ?`)
    params.push(sortable(query.upper))
  }
  return [clauses.map((clause) => ` AND ${clause}`).join(''), params]
}

/** The SQL and parameters that select a query's records, ordered and paged. */
function selectOf(table: string, query: RangeQuery, count: boolean): [string, SQLiteValue[]] {
  // Stryker disable next-line StringLiteral: an ORDER BY with no direction is ascending
  const direction = query.reverse ? 'DESC' : 'ASC'
  const page = count ? '' : ` LIMIT ${query.limit ?? -1} OFFSET ${query.offset ?? 0}`
  const columns = count ? 'COUNT(*) AS n' : 't.k AS k, t.v AS v'
  if (query.index === undefined) {
    const [where, params] = boundsOf('t.s', query)
    const order = count ? '' : ` ORDER BY t.s ${direction}`
    return [`SELECT ${columns} FROM ${records(table)} t WHERE 1${where}${order}${page}`, params]
  }
  const [where, params] = boundsOf('x.val', query)
  const order = count ? '' : ` ORDER BY x.val ${direction}, t.s ${direction}`
  return [
    `SELECT ${columns} FROM ${indexRows(table)} x JOIN ${records(table)} t ON t.k = x.k WHERE x.n = ?${where}${order}${page}`,
    [query.index, ...params],
  ]
}

/**
 * A store in SQLite. Each table is two SQLite tables - its records, and its index values - so adding
 * or removing an index never needs a migration.
 */
export function createSQLiteAdapter(options: SQLiteAdapterOptions): StoreAdapter {
  return {
    async open(name, tables) {
      const db = await options.openDatabase(name)
      const defs = new Map(tables.map((def) => [def.name, def]))

      await db.transaction(async (q) => {
        await q.run('CREATE TABLE IF NOT EXISTS "_tables" (name TEXT PRIMARY KEY, indexes TEXT NOT NULL)')
        const existing = await q.all<{ name: string; indexes: string }>('SELECT name, indexes FROM "_tables"')
        for (const { name: table } of existing) {
          if (!defs.has(table)) {
            await q.run(`DROP TABLE ${records(table)}`)
            await q.run(`DROP TABLE ${indexRows(table)}`)
            await q.run('DELETE FROM "_tables" WHERE name = ?', [table])
          }
        }
        for (const def of tables) {
          await q.run(
            `CREATE TABLE IF NOT EXISTS ${records(def.name)} (k TEXT PRIMARY KEY, s TEXT NOT NULL UNIQUE, v TEXT NOT NULL)`
          )
          await q.run(
            `CREATE TABLE IF NOT EXISTS ${indexRows(def.name)} (n TEXT NOT NULL, val TEXT NOT NULL, k TEXT NOT NULL, PRIMARY KEY (n, val, k))`
          )
          // Stryker disable next-line StringLiteral: the index only speeds up deletes by key; its name changes nothing
          await q.run(`CREATE INDEX IF NOT EXISTS ${quoted(`x:${def.name}:k`)} ON ${indexRows(def.name)} (k)`)
          const placeholders = def.indexes.map(() => '?').join(', ')
          await q.run(`DELETE FROM ${indexRows(def.name)} WHERE n NOT IN (${placeholders})`, def.indexes)
          await q.run('INSERT OR REPLACE INTO "_tables" (name, indexes) VALUES (?, ?)', [
            def.name,
            JSON.stringify(def.indexes),
          ])
        }
      })

      let closed = false
      const store: Store = {
        transaction(names, mode, fn) {
          if (closed) return Promise.reject(new Error('sync store: the database is closed'))
          return db.transaction(async (q) => {
            const guard = createTxGuard()
            function check(table: string, write: boolean): string {
              const def = defs.get(table)
              if (def === undefined || !names.includes(table)) {
                throw new Error(`sync store: table ${table} is not part of this transaction`)
              }
              if (write && mode === 'readonly') throw new Error('sync store: a readonly transaction cannot write')
              return table
            }
            function checkIndex(table: string, index: string | undefined) {
              if (index !== undefined && !(defs.get(table) as TableDef).indexes.includes(index)) {
                throw new Error(`sync store: table ${table} has no index ${index}`)
              }
            }

            const tx: StoreTx = {
              get: <V>(table: string, key: string) =>
                guard.run(async () => {
                  check(table, false)
                  const rows = await q.all<{ v: string }>(`SELECT v FROM ${records(table)} WHERE k = ?`, [key])
                  return rows.length === 0 ? undefined : (JSON.parse(rows[0].v) as V)
                }),
              put: (table, key, value, index = {}) =>
                guard.run(async () => {
                  check(table, true)
                  await q.run(`INSERT OR REPLACE INTO ${records(table)} (k, s, v) VALUES (?, ?, ?)`, [
                    key,
                    sortable(key),
                    JSON.stringify(value),
                  ])
                  await q.run(`DELETE FROM ${indexRows(table)} WHERE k = ?`, [key])
                  for (const [indexName, indexValue] of Object.entries(index)) {
                    if (indexValue === undefined) continue
                    await q.run(`INSERT INTO ${indexRows(table)} (n, val, k) VALUES (?, ?, ?)`, [
                      indexName,
                      sortable(indexValue),
                      key,
                    ])
                  }
                }),
              delete: (table, key) =>
                guard.run(async () => {
                  check(table, true)
                  await q.run(`DELETE FROM ${records(table)} WHERE k = ?`, [key])
                  // Stryker disable next-line ArrayDeclaration: an index row whose record is gone joins nothing, and a later put of the key clears it
                  await q.run(`DELETE FROM ${indexRows(table)} WHERE k = ?`, [key])
                }),
              clear: (table) =>
                guard.run(async () => {
                  check(table, true)
                  await q.run(`DELETE FROM ${records(table)}`)
                  await q.run(`DELETE FROM ${indexRows(table)}`)
                }),
              range: <V>(table: string, query: RangeQuery = {}) =>
                guard.run(async () => {
                  check(table, false)
                  checkIndex(table, query.index)
                  const rows = await q.all<{ k: string; v: string }>(...selectOf(table, query, false))
                  return rows.map((row) => ({ key: row.k, value: JSON.parse(row.v) as V }))
                }),
              count: (table, query = {}) =>
                guard.run(async () => {
                  check(table, false)
                  checkIndex(table, query.index)
                  const rows = await q.all<{ n: number }>(...selectOf(table, query, true))
                  return rows[0].n
                }),
            }
            try {
              return await fn(tx)
            } finally {
              guard.end()
            }
          })
        },
        close() {
          closed = true
          db.close().catch(() => undefined)
        },
      }
      return store
    },
    deleteDatabase(name) {
      return options.deleteDatabase(name)
    },
  }
}

/** The part of expo-sqlite's database the adapter uses. */
export interface ExpoSQLiteDatabase {
  runAsync(sql: string, params: SQLiteValue[]): Promise<unknown>
  getAllAsync<T>(sql: string, params: SQLiteValue[]): Promise<T[]>
  withExclusiveTransactionAsync(task: (txn: ExpoSQLiteDatabase) => Promise<void>): Promise<void>
  closeAsync(): Promise<void>
}

/** The part of the expo-sqlite module the adapter uses. */
export interface ExpoSQLiteModule {
  openDatabaseAsync(name: string): Promise<ExpoSQLiteDatabase>
  deleteDatabaseAsync(name: string): Promise<void>
}

function queriesOf(db: ExpoSQLiteDatabase): SQLiteQueries {
  return {
    async run(sql, params = []) {
      await db.runAsync(sql, [...params])
    },
    all: (sql, params = []) => db.getAllAsync(sql, [...params]),
  }
}

/**
 * The adapter's options for expo-sqlite: `createSQLiteAdapter(expoSQLite(SQLite))` with
 * `import * as SQLite from 'expo-sqlite'`. Nothing here imports expo-sqlite itself.
 */
export function expoSQLite(module: ExpoSQLiteModule): SQLiteAdapterOptions {
  return {
    async openDatabase(name) {
      const db = await module.openDatabaseAsync(`${name}.db`)
      return {
        ...queriesOf(db),
        async transaction<T>(fn: (queries: SQLiteQueries) => Promise<T>) {
          let result: T | undefined
          await db.withExclusiveTransactionAsync(async (txn) => {
            result = await fn(queriesOf(txn))
          })
          return result as T
        },
        close: () => db.closeAsync(),
      }
    },
    deleteDatabase: (name) => module.deleteDatabaseAsync(`${name}.db`),
  }
}
