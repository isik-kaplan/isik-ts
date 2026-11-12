import { describe, expect, it } from 'vitest'

import * as sync from '../../src/sync'
import { TransactionInactiveError, createTxGuard } from '../../src/sync/store'

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

describe('createTxGuard', () => {
  it('stays active while any operation is outstanding, ending a macrotask after the last', async () => {
    const guard = createTxGuard()
    const slow = guard.run(() => tick(20).then(() => 'slow'))
    await guard.run(() => 'fast')
    // The fast one's expiry fires while the slow one is still out: the guard stays active.
    await tick(5)
    expect(await guard.run(() => 'still')).toBe('still')
    expect(await slow).toBe('slow')
    await tick(5)
    await expect(guard.run(() => 'late')).rejects.toBeInstanceOf(TransactionInactiveError)
  })

  it('ends at once when told, and with no operation at all after a macrotask', async () => {
    const ended = createTxGuard()
    ended.end()
    await expect(ended.run(() => 1)).rejects.toBeInstanceOf(TransactionInactiveError)
    const idle = createTxGuard()
    await tick()
    await expect(idle.run(() => 1)).rejects.toBeInstanceOf(TransactionInactiveError)
  })

  it('stays usable after an operation throws', async () => {
    const guard = createTxGuard()
    await expect(guard.run(() => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(await guard.run(() => 2)).toBe(2)
  })
})

describe('@isikk/core/sync', () => {
  it('exports the engine, the adapters, the push strategies and the protocol', () => {
    expect(Object.keys(sync).sort()).toEqual(
      [
        'AFTER_PREFIX',
        'PROTOCOL_HEADER',
        'PROTOCOL_VERSION',
        'PendingWritesError',
        'RowExistsError',
        'RowNotFoundError',
        'TransactionInactiveError',
        'batchPush',
        'createIndexedDBAdapter',
        'createMemoryAdapter',
        'createSQLiteAdapter',
        'createMutex',
        'createTxGuard',
        'deepEqual',
        'encodeKey',
        'expoSQLite',
        'inBounds',
        'materialize',
        'openSyncEngine',
        'outcomeOf',
        'rebasable',
        'referencesOf',
        'resourcesOf',
        'restPush',
        'rowKeyOf',
        'scopeOf',
        'selectBatch',
        'uuid7',
      ].sort()
    )
  })
})
