import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'

import { createIndexedDBAdapter } from '../../src/sync/idb'

describe('the IndexedDB adapter across tabs', () => {
  it('closes when another tab upgrades the schema, and reopens on its next transaction', async () => {
    const indexedDB = new IDBFactory()
    const first = await createIndexedDBAdapter({ indexedDB }).open('db', [{ name: 'a', indexes: [] }])
    await first.transaction(['a'], 'readwrite', (tx) => tx.put('a', 'k', 1))
    const second = await createIndexedDBAdapter({ indexedDB }).open('db', [
      { name: 'a', indexes: ['x'] },
      { name: 'b', indexes: [] },
    ])
    await second.transaction(['b'], 'readwrite', (tx) => tx.put('b', 'k', 2))
    second.close()
    expect(await first.transaction(['a'], 'readonly', (tx) => tx.get('a', 'k'))).toBe(1)
  })

  it('fails the requests still out when a transaction aborts', async () => {
    const store = await createIndexedDBAdapter({ indexedDB: new IDBFactory() }).open('db', [{ name: 'a', indexes: [] }])
    const pending: Promise<unknown>[] = []
    await expect(
      store.transaction(['a'], 'readwrite', async (tx) => {
        pending.push(tx.range('a'), tx.get('a', 'k'))
        throw new Error('abandoned')
      })
    ).rejects.toThrow('abandoned')
    for (const request of pending) await expect(request).rejects.toBeDefined()
  })

  it('upgrades only when the schema changed, and connects once', async () => {
    const indexedDB = new IDBFactory()
    let opens = 0
    const counting = new Proxy(indexedDB, {
      get(target, property) {
        if (property === 'open') {
          return (...args: Parameters<IDBFactory['open']>) => {
            opens += 1
            return target.open(...args)
          }
        }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const adapter = createIndexedDBAdapter({ indexedDB: counting })
    const versionOf = async () => (await indexedDB.databases()).find((db) => db.name === 'db')?.version
    const tables = [
      { name: 'a', indexes: ['x', 'y'] },
      { name: 'b', indexes: [] },
    ]

    const empty = await adapter.open('db', [])
    empty.close()
    expect(await versionOf()).toBe(1)
    const first = await adapter.open('db', tables)
    expect(await versionOf()).toBe(2)
    const before = opens
    await first.transaction(['a'], 'readwrite', (tx) => tx.put('a', 'k', 1, { x: '1' }))
    await first.transaction(['a'], 'readonly', (tx) => tx.get('a', 'k'))
    expect(opens).toBe(before)
    first.close()
    ;(await adapter.open('db', tables)).close()
    ;(
      await adapter.open('db', [
        { name: 'b', indexes: [] },
        { name: 'a', indexes: ['y', 'x'] },
      ])
    ).close()
    expect(await versionOf()).toBe(2)
    ;(
      await adapter.open('db', [
        { name: 'a', indexes: ['x', 'z'] },
        { name: 'b', indexes: [] },
      ])
    ).close()
    expect(await versionOf()).toBe(3)
    ;(
      await adapter.open('db', [
        { name: 'a', indexes: ['x', 'z', 'w'] },
        { name: 'b', indexes: [] },
      ])
    ).close()
    expect(await versionOf()).toBe(4)
    ;(
      await adapter.open('db', [
        { name: 'a', indexes: ['x', 'z'] },
        { name: 'b', indexes: [] },
      ])
    ).close()
    expect(await versionOf()).toBe(5)
    ;(
      await adapter.open('db', [
        { name: 'a', indexes: ['x'] },
        { name: 'c', indexes: [] },
      ])
    ).close()
    expect(await versionOf()).toBe(6)
    ;(await adapter.open('db', [])).close()
    expect(await versionOf()).toBe(7)
  })

  it('closes cleanly after another tab took its connection away', async () => {
    const indexedDB = new IDBFactory()
    const first = await createIndexedDBAdapter({ indexedDB }).open('db', [{ name: 'a', indexes: [] }])
    const second = await createIndexedDBAdapter({ indexedDB }).open('db', [{ name: 'a', indexes: ['x'] }])
    second.close()
    expect(() => first.close()).not.toThrow()
  })

  it('uses the global IndexedDB by default', async () => {
    const store = await createIndexedDBAdapter().open('global', [{ name: 'a', indexes: [] }])
    await store.transaction(['a'], 'readwrite', (tx) => tx.put('a', 'k', 1))
    expect(await store.transaction(['a'], 'readonly', (tx) => tx.get('a', 'k'))).toBe(1)
    store.close()
  })
})
