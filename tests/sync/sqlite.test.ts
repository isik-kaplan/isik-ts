import initSqlJs from 'sql.js'
import { describe, expect, it, vi } from 'vitest'

import type { ExpoSQLiteDatabase, SQLiteValue } from '../../src/sync/sqlite'
import { createSQLiteAdapter, expoSQLite } from '../../src/sync/sqlite'

// expo-sqlite's surface, played by sql.js: what `expoSQLite` calls on it is all the adapter relies on.

const SQL = await initSqlJs()

function fakeExpo() {
  const deleted: string[] = []
  const closed: string[] = []
  const opened: string[] = []
  const module = {
    async openDatabaseAsync(name: string): Promise<ExpoSQLiteDatabase> {
      opened.push(name)
      const db = new SQL.Database()
      const handle: ExpoSQLiteDatabase = {
        async runAsync(sql: string, params: SQLiteValue[]) {
          db.run(sql, params)
          return { changes: db.getRowsModified() }
        },
        async getAllAsync<T>(sql: string, params: SQLiteValue[]) {
          const statement = db.prepare(sql)
          statement.bind(params)
          const rows: T[] = []
          while (statement.step()) rows.push(statement.getAsObject() as T)
          statement.free()
          return rows
        },
        async withExclusiveTransactionAsync(task) {
          db.run('BEGIN')
          try {
            await task(handle)
            db.run('COMMIT')
          } catch (error) {
            db.run('ROLLBACK')
            throw error
          }
        },
        async closeAsync() {
          closed.push(name)
        },
      }
      return handle
    },
    deleteDatabaseAsync: vi.fn(async (name: string) => {
      deleted.push(name)
    }),
  }
  return { module, deleted, closed, opened }
}

describe('expoSQLite', () => {
  it('opens and deletes `<name>.db`, runs in exclusive transactions, and returns what they return', async () => {
    const { module, deleted, closed, opened } = fakeExpo()
    const adapter = createSQLiteAdapter(expoSQLite(module))
    const store = await adapter.open('user-1', [{ name: 'rows', indexes: ['by'] }])
    expect(opened).toEqual(['user-1.db'])
    const result = await store.transaction(['rows'], 'readwrite', async (tx) => {
      await tx.put('rows', 'a', { n: 1 }, { by: 'x' })
      return tx.range('rows', { index: 'by' })
    })
    expect(result).toEqual([{ key: 'a', value: { n: 1 } }])
    await expect(
      store.transaction(['rows'], 'readwrite', async (tx) => {
        await tx.put('rows', 'b', { n: 2 })
        throw new Error('rolled back')
      })
    ).rejects.toThrow('rolled back')
    expect(await store.transaction(['rows'], 'readonly', (tx) => tx.count('rows'))).toBe(1)
    store.close()
    await vi.waitFor(() => expect(closed).toEqual(['user-1.db']))
    await adapter.deleteDatabase('user-1')
    expect(deleted).toEqual(['user-1.db'])
  })

  it('runs a query outside a transaction with no parameters', async () => {
    const { module } = fakeExpo()
    const db = await expoSQLite(module).openDatabase('x')
    await db.run('CREATE TABLE t (a TEXT)')
    await db.run('INSERT INTO t VALUES (?)', ['v'])
    expect(await db.all('SELECT a FROM t')).toEqual([{ a: 'v' }])
    await db.close()
  })

  it('swallows a failure to close', async () => {
    const adapter = createSQLiteAdapter({
      openDatabase: async () => ({
        run: async () => undefined,
        all: async () => [] as never[],
        transaction: (fn) => fn({ run: async () => undefined, all: async () => [] as never[] }),
        close: () => Promise.reject(new Error('already closed')),
      }),
      deleteDatabase: async () => undefined,
    })
    const store = await adapter.open('x', [])
    store.close()
    await expect(store.transaction([], 'readonly', async () => 1)).rejects.toThrow(/closed/)
  })
})
