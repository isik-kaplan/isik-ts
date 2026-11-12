import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'

import type { SQLiteAdapterOptions, SQLiteDatabase, SQLiteQueries, SQLiteValue } from '../../../src/sync/sqlite'
import { createMutex } from '../../../src/sync/store'

// sql.js stands in for expo-sqlite in Node: the same SQLite, compiled to WebAssembly. Databases live in
// memory, kept by name so a test can close and reopen one.

const SQL = await initSqlJs()

function queriesOf(db: Database): SQLiteQueries {
  return {
    async run(sql, params = []) {
      db.run(sql, params as SQLiteValue[])
    },
    async all<T>(sql: string, params: readonly SQLiteValue[] = []) {
      const statement = db.prepare(sql)
      statement.bind(params as SQLiteValue[])
      const rows: T[] = []
      while (statement.step()) rows.push(statement.getAsObject() as T)
      statement.free()
      return rows
    },
  }
}

export function sqlJsOptions(): SQLiteAdapterOptions & { opened: string[] } {
  const databases = new Map<string, { db: Database; exclusive: ReturnType<typeof createMutex> }>()
  const opened: string[] = []
  return {
    opened,
    async openDatabase(name): Promise<SQLiteDatabase> {
      opened.push(name)
      let entry = databases.get(name)
      if (entry === undefined) {
        entry = { db: new SQL.Database(), exclusive: createMutex() }
        databases.set(name, entry)
      }
      const { db, exclusive } = entry
      return {
        ...queriesOf(db),
        transaction: (fn) =>
          exclusive(async () => {
            db.run('BEGIN')
            try {
              const result = await fn(queriesOf(db))
              db.run('COMMIT')
              return result
            } catch (error) {
              db.run('ROLLBACK')
              throw error
            }
          }),
        close: async () => undefined,
      }
    },
    async deleteDatabase(name) {
      databases.get(name)?.db.close()
      databases.delete(name)
    },
  }
}
