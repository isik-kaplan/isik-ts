import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'

import { createIndexedDBAdapter } from '../../src/sync/idb'
import { createMemoryAdapter } from '../../src/sync/memory'
import { createSQLiteAdapter } from '../../src/sync/sqlite'
import type { StoreAdapter, StoreTx, TableDef } from '../../src/sync/store'
import { TransactionInactiveError } from '../../src/sync/store'
import { sqlJsOptions } from './support/sqljs'

// One contract, three adapters: whatever a test here says, IndexedDB, SQLite and memory all do.

const ADAPTERS: [string, () => StoreAdapter][] = [
  ['memory', () => createMemoryAdapter()],
  ['indexeddb', () => createIndexedDBAdapter({ indexedDB: new IDBFactory() })],
  ['sqlite', () => createSQLiteAdapter(sqlJsOptions())],
]

const PEOPLE: TableDef = { name: 'people', indexes: ['age', 'city'] }
const OTHER: TableDef = { name: 'other', indexes: [] }

describe.each(ADAPTERS)('the %s adapter', (_, make) => {
  async function opened(tables: TableDef[] = [PEOPLE, OTHER]) {
    const adapter = make()
    const store = await adapter.open('db', tables)
    return { adapter, store }
  }

  async function seeded() {
    const { adapter, store } = await opened()
    await store.transaction(['people'], 'readwrite', async (tx) => {
      await tx.put('people', 'c', { name: 'Cem' }, { age: '30', city: 'b' })
      await tx.put('people', 'a', { name: 'Ada' }, { age: '30', city: undefined })
      await tx.put('people', 'b', { name: 'Bo' }, { age: '20', city: 'a' })
      await tx.put('people', 'd', { name: 'Dee' }, {})
    })
    return { adapter, store }
  }

  const keysOf = (records: { key: string }[]) => records.map((record) => record.key)

  it('puts, gets, replaces and deletes', async () => {
    const { store } = await opened()
    await store.transaction(['people'], 'readwrite', async (tx) => {
      expect(await tx.get('people', 'a')).toBeUndefined()
      await tx.put('people', 'a', { n: 1, nested: { list: [1, 'x', null] } })
      expect(await tx.get('people', 'a')).toEqual({ n: 1, nested: { list: [1, 'x', null] } })
      await tx.put('people', 'a', { n: 2 })
      expect(await tx.get('people', 'a')).toEqual({ n: 2 })
      await tx.delete('people', 'a')
      expect(await tx.get('people', 'a')).toBeUndefined()
      await tx.delete('people', 'missing')
    })
  })

  it('keeps a value apart from the object it was put from', async () => {
    const { store } = await opened()
    const value = { list: [1] }
    await store.transaction(['people'], 'readwrite', async (tx) => {
      await tx.put('people', 'a', value)
      value.list.push(2)
      const read = await tx.get<{ list: number[] }>('people', 'a')
      read?.list.push(3)
      expect(await tx.get('people', 'a')).toEqual({ list: [1] })
    })
  })

  it('returns what the transaction returns, and commits', async () => {
    const { store } = await opened()
    const result = await store.transaction(['people'], 'readwrite', async (tx) => {
      await tx.put('people', 'a', 1)
      return 'done'
    })
    expect(result).toBe('done')
    expect(await store.transaction(['people'], 'readonly', (tx) => tx.get('people', 'a'))).toBe(1)
  })

  it('commits nothing from a transaction that throws', async () => {
    const { store } = await opened()
    await store.transaction(['people'], 'readwrite', (tx) => tx.put('people', 'kept', 1))
    const failure = store.transaction(['people', 'other'], 'readwrite', async (tx) => {
      await tx.put('people', 'a', 1)
      await tx.put('other', 'b', 1)
      await tx.delete('people', 'kept')
      throw new Error('boom')
    })
    await expect(failure).rejects.toThrow('boom')
    await store.transaction(['people', 'other'], 'readonly', async (tx) => {
      expect(await tx.get('people', 'a')).toBeUndefined()
      expect(await tx.get('other', 'b')).toBeUndefined()
      expect(await tx.get('people', 'kept')).toBe(1)
    })
  })

  it('clears a table and only that table', async () => {
    const { store } = await seeded()
    await store.transaction(['people', 'other'], 'readwrite', async (tx) => {
      await tx.put('other', 'x', 1)
      await tx.clear('people')
      expect(await tx.count('people')).toBe(0)
      expect(await tx.count('people', { index: 'age' })).toBe(0)
      expect(await tx.get('other', 'x')).toBe(1)
    })
  })

  it('ranges over keys in order, with inclusive and open bounds, offset, limit and reverse', async () => {
    const { store } = await seeded()
    await store.transaction(['people'], 'readonly', async (tx) => {
      expect(keysOf(await tx.range('people'))).toEqual(['a', 'b', 'c', 'd'])
      expect((await tx.range('people', { lower: 'b', upper: 'b' }))[0]).toEqual({ key: 'b', value: { name: 'Bo' } })
      expect(keysOf(await tx.range('people', { lower: 'b', upper: 'c' }))).toEqual(['b', 'c'])
      expect(keysOf(await tx.range('people', { lower: 'b', upper: 'c', lowerOpen: true }))).toEqual(['c'])
      expect(keysOf(await tx.range('people', { lower: 'b', upper: 'c', upperOpen: true }))).toEqual(['b'])
      expect(keysOf(await tx.range('people', { lower: 'c' }))).toEqual(['c', 'd'])
      expect(keysOf(await tx.range('people', { lower: 'c', lowerOpen: true }))).toEqual(['d'])
      expect(keysOf(await tx.range('people', { upper: 'b' }))).toEqual(['a', 'b'])
      expect(keysOf(await tx.range('people', { upper: 'b', upperOpen: true }))).toEqual(['a'])
      expect(keysOf(await tx.range('people', { offset: 1, limit: 2 }))).toEqual(['b', 'c'])
      expect(keysOf(await tx.range('people', { offset: 3 }))).toEqual(['d'])
      expect(keysOf(await tx.range('people', { limit: 0 }))).toEqual([])
      expect(keysOf(await tx.range('people', { reverse: true, limit: 3 }))).toEqual(['d', 'c', 'b'])
      expect(keysOf(await tx.range('people', { lower: 'c', upper: 'b' }))).toEqual([])
      expect(keysOf(await tx.range('people', { lower: 'b', upper: 'b', lowerOpen: true }))).toEqual([])
      expect(keysOf(await tx.range('people', { lower: 'b', upper: 'b', upperOpen: true }))).toEqual([])
    })
  })

  it('ranges over an index by value, then key, leaving out records without one', async () => {
    const { store } = await seeded()
    await store.transaction(['people'], 'readonly', async (tx) => {
      expect(keysOf(await tx.range('people', { index: 'age' }))).toEqual(['b', 'a', 'c'])
      expect(keysOf(await tx.range('people', { index: 'age', reverse: true }))).toEqual(['c', 'a', 'b'])
      expect(keysOf(await tx.range('people', { index: 'age', lower: '30', upper: '30' }))).toEqual(['a', 'c'])
      expect(keysOf(await tx.range('people', { index: 'age', upper: '30', upperOpen: true }))).toEqual(['b'])
      expect(keysOf(await tx.range('people', { index: 'age', lower: '20', lowerOpen: true }))).toEqual(['a', 'c'])
      expect(keysOf(await tx.range('people', { index: 'age', offset: 1, limit: 1 }))).toEqual(['a'])
      expect(keysOf(await tx.range('people', { index: 'city' }))).toEqual(['b', 'c'])
      expect(keysOf(await tx.range('people', { index: 'city', lower: 'b', upper: 'a' }))).toEqual([])
      expect((await tx.range('people', { index: 'city', limit: 1 }))[0].value).toEqual({ name: 'Bo' })
    })
  })

  it('moves a record between index values when it is put again', async () => {
    const { store } = await seeded()
    await store.transaction(['people'], 'readwrite', async (tx) => {
      await tx.put('people', 'b', { name: 'Bo' }, { age: '40' })
      expect(keysOf(await tx.range('people', { index: 'age' }))).toEqual(['a', 'c', 'b'])
      expect(keysOf(await tx.range('people', { index: 'city' }))).toEqual(['c'])
      await tx.delete('people', 'c')
      expect(keysOf(await tx.range('people', { index: 'city' }))).toEqual([])
    })
  })

  it('counts a table, an index and a range', async () => {
    const { store } = await seeded()
    await store.transaction(['people'], 'readonly', async (tx) => {
      expect(await tx.count('people')).toBe(4)
      expect(await tx.count('people', { lower: 'b' })).toBe(3)
      expect(await tx.count('people', { index: 'age' })).toBe(3)
      expect(await tx.count('people', { index: 'age', lower: '30' })).toBe(2)
      expect(await tx.count('people', { index: 'age', lower: '30', upper: '20' })).toBe(0)
    })
  })

  it('orders strings by UTF-16 code unit, emoji included', async () => {
    const { store } = await opened()
    const keys = ['', '😀', 'z', 'Z', 'é', '']
    await store.transaction(['people'], 'readwrite', async (tx) => {
      for (const key of keys) await tx.put('people', key || 'empty', key, { age: key })
    })
    const sorted = [...keys].sort()
    await store.transaction(['people'], 'readonly', async (tx) => {
      expect((await tx.range('people', { index: 'age' })).map((record) => record.value)).toEqual(sorted)
      expect(await tx.count('people', { index: 'age', lower: '\ud83d', upper: String.fromCharCode(0xffff) })).toBe(2)
    })
  })

  it('refuses an unknown index, a table outside the transaction or the database, and a write in a readonly one', async () => {
    const { store } = await opened()
    const readonly = <T>(fn: Parameters<typeof store.transaction<T>>[2]) =>
      store.transaction(['people'], 'readonly', fn)
    await expect(readonly((tx) => tx.range('people', { index: 'nope' }))).rejects.toThrow(
      'sync store: table people has no index nope'
    )
    await expect(readonly((tx) => tx.count('people', { index: 'nope' }))).rejects.toThrow(
      'sync store: table people has no index nope'
    )
    await expect(readonly((tx) => tx.get('other', 'a'))).rejects.toThrow(
      'sync store: table other is not part of this transaction'
    )
    await expect(store.transaction(['ghost'], 'readonly', (tx) => tx.get('ghost', 'a'))).rejects.toThrow(
      'sync store: table ghost is not part of this transaction'
    )
    for (const write of [
      (tx: StoreTx) => tx.put('people', 'a', 1),
      (tx: StoreTx) => tx.delete('people', 'a'),
      (tx: StoreTx) => tx.clear('people'),
    ]) {
      await expect(readonly(write)).rejects.toThrow('sync store: a readonly transaction cannot write')
    }
  })

  it('refuses a transaction used after it finished, or after it threw', async () => {
    const { store } = await opened()
    let finished: StoreTx | undefined
    await store.transaction(['people'], 'readwrite', async (tx) => {
      finished = tx
    })
    await expect((finished as StoreTx).get('people', 'a')).rejects.toBeInstanceOf(TransactionInactiveError)
    let thrown: StoreTx | undefined
    await store
      .transaction(['people'], 'readwrite', async (tx) => {
        thrown = tx
        throw new Error('no')
      })
      .catch(() => undefined)
    await expect((thrown as StoreTx).put('people', 'a', 1)).rejects.toBeInstanceOf(TransactionInactiveError)
  })

  it('takes table names that need quoting', async () => {
    const adapter = make()
    const store = await adapter.open('quoted', [{ name: 'a "b" c', indexes: ['x'] }])
    await store.transaction(['a "b" c'], 'readwrite', (tx) => tx.put('a "b" c', 'k', 1, { x: 'v' }))
    expect(await store.transaction(['a "b" c'], 'readonly', (tx) => tx.count('a "b" c', { index: 'x' }))).toBe(1)
  })

  it('keeps tables apart whose names differ only by quotes', async () => {
    const store = await make().open('quotes', [
      { name: 'a"b', indexes: [] },
      { name: 'ab', indexes: [] },
    ])
    await store.transaction(['a"b'], 'readwrite', (tx) => tx.put('a"b', 'k', 1))
    expect(await store.transaction(['ab'], 'readonly', (tx) => tx.count('ab'))).toBe(0)
  })

  it('drops a table, then opens without it again and again', async () => {
    const adapter = make()
    await adapter.open('drops', [PEOPLE, OTHER])
    await adapter.open('drops', [PEOPLE])
    const store = await adapter.open('drops', [PEOPLE])
    expect(await store.transaction(['people'], 'readonly', (tx) => tx.count('people'))).toBe(0)
  })

  it('reopens with only an index changed: the new one starts empty, the old one is gone', async () => {
    const { adapter, store } = await seeded()
    store.close()
    const changed = await adapter.open('db', [{ name: 'people', indexes: ['age', 'name'] }, OTHER])
    await changed.transaction(['people'], 'readwrite', async (tx) => {
      expect(await tx.count('people', { index: 'name' })).toBe(0)
      await tx.put('people', 'z', {}, { name: 'z' })
      expect(await tx.count('people', { index: 'name' })).toBe(1)
    })
    await expect(
      changed.transaction(['people'], 'readonly', (tx) => tx.count('people', { index: 'city' }))
    ).rejects.toThrow()
  })

  it('reopens with a table fewer: the dropped one comes back empty', async () => {
    const { adapter, store } = await seeded()
    await store.transaction(['other'], 'readwrite', (tx) => tx.put('other', 'x', 1))
    store.close()
    ;(await adapter.open('db', [PEOPLE])).close()
    const back = await adapter.open('db', [PEOPLE, OTHER])
    expect(await back.transaction(['other'], 'readonly', (tx) => tx.count('other'))).toBe(0)
    expect(await back.transaction(['people'], 'readonly', (tx) => tx.count('people'))).toBe(4)
  })

  it('stays active across store operations and resolved promises', async () => {
    const { store } = await opened()
    await store.transaction(['people'], 'readwrite', async (tx) => {
      await tx.put('people', 'a', 1)
      await Promise.resolve()
      await tx.get('people', 'a')
      await tx.put('people', 'b', 2)
    })
    expect(await store.transaction(['people'], 'readonly', (tx) => tx.count('people'))).toBe(2)
  })

  it('ends a transaction that awaits anything but the store', async () => {
    const { store } = await opened()
    const misuse = store.transaction(['people'], 'readwrite', async (tx) => {
      await tx.put('people', 'a', 1)
      await new Promise((resolve) => setTimeout(resolve, 5))
      await tx.put('people', 'b', 2)
    })
    await expect(misuse).rejects.toBeInstanceOf(TransactionInactiveError)
    await expect(misuse).rejects.toMatchObject({
      name: 'TransactionInactiveError',
      message:
        'sync store: the transaction has already finished - something other than the store was awaited inside it, and only store operations may be',
    })
  })

  it('runs concurrent transactions one at a time', async () => {
    const { store } = await opened()
    const increment = () =>
      store.transaction(['people'], 'readwrite', async (tx) => {
        const value = (await tx.get<number>('people', 'n')) ?? 0
        await tx.put('people', 'n', value + 1)
      })
    await Promise.all([increment(), increment(), increment()])
    expect(await store.transaction(['people'], 'readonly', (tx) => tx.get('people', 'n'))).toBe(3)
  })

  it('reopens with a changed schema: records survive, a new index starts empty, a dropped table is gone', async () => {
    const { adapter, store } = await seeded()
    await store.transaction(['other'], 'readwrite', (tx) => tx.put('other', 'x', 1))
    store.close()
    await expect(store.transaction(['people'], 'readonly', (tx) => tx.count('people'))).rejects.toThrow(/closed/)

    const changed = await adapter.open('db', [
      { name: 'people', indexes: ['age', 'name'] },
      { name: 'fresh', indexes: ['f'] },
    ])
    await changed.transaction(['people', 'fresh'], 'readwrite', async (tx) => {
      expect(await tx.count('people')).toBe(4)
      expect(keysOf(await tx.range('people', { index: 'age' }))).toEqual(['b', 'a', 'c'])
      expect(await tx.count('people', { index: 'name' })).toBe(0)
      await tx.put('people', 'a', { name: 'Ada' }, { age: '30', name: 'Ada' })
      expect(keysOf(await tx.range('people', { index: 'name' }))).toEqual(['a'])
      expect(await tx.count('fresh')).toBe(0)
    })
    await expect(
      changed.transaction(['people'], 'readonly', (tx) => tx.count('people', { index: 'city' }))
    ).rejects.toThrow()
    await expect(changed.transaction(['other'], 'readonly', (tx) => tx.count('other'))).rejects.toThrow()
    changed.close()

    const back = await adapter.open('db', [PEOPLE, OTHER])
    await back.transaction(['people', 'other'], 'readonly', async (tx) => {
      expect(await tx.count('other')).toBe(0)
      expect(await tx.count('people', { index: 'city' })).toBe(0)
    })
  })

  it('reopens an unchanged schema with everything kept', async () => {
    const { adapter, store } = await seeded()
    store.close()
    const again = await adapter.open('db', [PEOPLE, OTHER])
    expect(await again.transaction(['people'], 'readonly', (tx) => tx.count('people', { index: 'city' }))).toBe(2)
  })

  it('opens a database with no tables', async () => {
    const adapter = make()
    const store = await adapter.open('empty', [])
    store.close()
    await adapter.open('empty', [])
  })

  it('deletes a database', async () => {
    const { adapter, store } = await seeded()
    store.close()
    await adapter.deleteDatabase('db')
    const fresh = await adapter.open('db', [PEOPLE, OTHER])
    expect(await fresh.transaction(['people'], 'readonly', (tx) => tx.count('people'))).toBe(0)
  })

  it('keeps databases apart by name', async () => {
    const adapter = make()
    const one = await adapter.open('one', [OTHER])
    const two = await adapter.open('two', [OTHER])
    await one.transaction(['other'], 'readwrite', (tx) => tx.put('other', 'a', 1))
    expect(await two.transaction(['other'], 'readonly', (tx) => tx.count('other'))).toBe(0)
  })
})
