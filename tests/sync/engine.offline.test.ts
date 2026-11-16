import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SyncProgress } from '../../src/sync/engine'
import { OfflineModeError, SyncPausedError, SyncUnreachableError } from '../../src/sync/engine'
import { createMemoryAdapter } from '../../src/sync/memory'
import type { Change } from '../../src/sync/protocol'
import { TEAM7, U1, client, id, task } from './support/harness'
import { FakeServer } from './support/server'

// Offline mode, chosen by the app, and a full sync with progress for the screen around it.

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function counting(server: FakeServer, fail: (path: string) => Response | null = () => null) {
  const base = server.fetchAs(() => U1)
  const calls: string[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    calls.push(path)
    return fail(path) ?? base(input, init)
  }
  return { fetch, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Isik-Sync-Protocol': '1' } })

/** A fetch whose feed answers are `pages`, in order, and whose pushes go to `server`. */
function scripted(server: FakeServer, pages: unknown[]) {
  const base = server.fetchAs(() => U1)
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).pathname === '/sync/changes') return json(pages.shift())
    return base(input, init)
  }
  return fetch
}

const note = (n: number) => ({ id: id(n), team: TEAM7, body: `note ${n}` })
const up = (data: { id: string } & Record<string, unknown>): Change => ({
  op: 'upsert',
  model: 'notes',
  id: data.id,
  etag: `"${data.id}"`,
  data,
})

describe('going offline', () => {
  it('makes no network call at all, while reads and writes go on locally and queue', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const { fetch, calls } = counting(server)
    let fire = () => {}
    const foreground = (on: () => void) => {
      fire = on
      return () => {}
    }
    const engine = await client(server, U1, { fetch, interval: 1000, foreground })
    await engine.goOffline()
    expect(engine.status().mode).toBe('offline')
    engine.start()
    await engine.create('tasks', task(id(1)))
    await engine.update('tasks', id(1), { title: 'renamed' })
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    fire()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toEqual([])
    expect(await engine.get('tasks', id(1))).toMatchObject({ title: 'renamed' })
    expect(engine.status()).toMatchObject({ pending: 1, syncing: false, error: null })
    // Refused before it begins: the status never so much as shows it syncing.
    let changes = 0
    const unsubscribe = engine.subscribeStatus(() => (changes += 1))
    await expect(engine.sync()).rejects.toBeInstanceOf(OfflineModeError)
    expect(changes).toBe(0)
    unsubscribe()
    await expect(engine.syncFully()).rejects.toThrow('sync: the engine is offline; call goOnline() first')
    expect(new OfflineModeError().name).toBe('OfflineModeError')
    expect(calls).toEqual([])
    engine.close()
  })

  it('stays offline across a restart, and goOnline lets the triggers sync again without syncing itself', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const adapter = createMemoryAdapter()
    const { fetch, calls } = counting(server)
    const first = await client(server, U1, { adapter, fetch })
    await first.goOffline()
    first.close()
    const engine = await client(server, U1, { adapter, fetch })
    expect(engine.status().mode).toBe('offline')
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual([])
    await engine.goOnline()
    expect(engine.status().mode).toBe('online')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toEqual([])
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toContain('/sync/changes')
    engine.close()
    const reopened = await client(server, U1, { adapter, fetch })
    expect(reopened.status().mode).toBe('online')
  })

  it('cancels a sync already scheduled', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const { fetch, calls } = counting(server)
    const engine = await client(server, U1, { fetch, debounce: 500 })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    calls.length = 0
    await engine.create('tasks', task(id(1)))
    await engine.goOffline()
    await engine.goOnline()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toEqual([])
    engine.close()
  })

  it('waits out the sync in flight, which then makes no further call, and shows no error', async () => {
    const server = new FakeServer()
    let release = () => {}
    const { fetch: base, calls } = counting(server)
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const answer = await base(input, init)
      if (calls.length === 1) await new Promise<void>((resolve) => (release = resolve))
      return answer
    }
    const engine = await client(server, U1, { fetch })
    await engine.create('tasks', task(id(1)))
    const syncing = engine.sync()
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    let offline = false
    const going = engine.goOffline().then(() => (offline = true))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(offline).toBe(false)
    release()
    await going
    await expect(syncing).rejects.toBeInstanceOf(OfflineModeError)
    expect(calls).toEqual(['/sync/capabilities'])
    expect(engine.status()).toMatchObject({ mode: 'offline', syncing: false, error: null, pending: 1 })
    engine.close()
  })

  it('tells the other tabs, and a tab that did not hear reads the stored mode before syncing', async () => {
    const server = new FakeServer()
    const adapter = createMemoryAdapter()
    const one = await client(server, U1, { adapter, broadcast: true })
    const two = await client(server, U1, { adapter, broadcast: true })
    await one.goOffline()
    await vi.waitFor(() => expect(two.status().mode).toBe('offline'))
    await one.goOnline()
    await vi.waitFor(() => expect(two.status().mode).toBe('online'))
    one.close()
    two.close()

    const { fetch, calls } = counting(server)
    const deaf = await client(server, U1, { adapter, fetch })
    const other = await client(server, U1, { adapter })
    await other.goOffline()
    expect(deaf.status().mode).toBe('online')
    await expect(deaf.sync()).rejects.toBeInstanceOf(OfflineModeError)
    expect(deaf.status()).toMatchObject({ mode: 'offline', syncing: false })
    expect(calls).toEqual([])
  })
})

describe('syncFully', () => {
  it('pushes everything, pulls every page, and resolves with what is left to resolve', async () => {
    const server = new FakeServer()
    for (let n = 1; n <= 5; n += 1) server.create('tasks', task(id(n)))
    const engine = await client(server, U1, { pageSize: 2, batchSize: 2 })
    for (let n = 11; n <= 13; n += 1) await engine.create('tasks', task(id(n)))
    const seen: SyncProgress[] = []
    expect(await engine.syncFully({ onProgress: (p) => seen.push(p) })).toEqual({ conflicts: 0, dead: 0 })
    expect(server.rows.get('tasks')?.size).toBe(8)
    expect(await engine.count('tasks')).toBe(8)
    expect(engine.status()).toMatchObject({ pending: 0, syncing: false })
    expect(seen.filter((p) => p.phase === 'push')).toEqual([
      { phase: 'push', sent: 0, total: 3 },
      { phase: 'push', sent: 2, total: 3 },
      { phase: 'push', sent: 3, total: 3 },
    ])
    expect(seen.filter((p) => p.phase === 'snapshot')).toEqual([
      { phase: 'snapshot', scope: null, model: null, received: 2, total: 8 },
      { phase: 'snapshot', scope: null, model: null, received: 4, total: 8 },
      { phase: 'snapshot', scope: null, model: null, received: 6, total: 8 },
      { phase: 'snapshot', scope: null, model: null, received: 8, total: 8 },
    ])
    expect(engine.progress()).toBeNull()
  })

  it('reports live changes, deletes too, against what the server says remains', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(9)))
    const engine = await client(server, U1, { pageSize: 2 })
    await engine.sync()
    for (let n = 1; n <= 2; n += 1) server.create('tasks', task(id(n)))
    server.delete('tasks', id(9))
    const seen: SyncProgress[] = []
    await engine.syncFully({ onProgress: (p) => seen.push(p) })
    expect(seen).toEqual([
      { phase: 'pull', received: 2, remaining: 1 },
      { phase: 'pull', received: 3, remaining: 0 },
    ])
  })

  it('leaves writes made while it runs for the next sync, so it always ends', async () => {
    const server = new FakeServer()
    const engine = await client(server, U1, { batchSize: 1 })
    await engine.create('tasks', task(id(1)))
    await engine.create('tasks', task(id(2)))
    let written = false
    const pushes: SyncProgress[] = []
    await engine.syncFully({
      onProgress: (p) => {
        if (p.phase !== 'push') return
        pushes.push(p)
        if (!written) {
          written = true
          engine.create('tasks', task(id(3))).catch(() => undefined)
        }
      },
    })
    expect(pushes).toEqual([
      { phase: 'push', sent: 0, total: 2 },
      { phase: 'push', sent: 1, total: 2 },
      { phase: 'push', sent: 2, total: 2 },
    ])
    await vi.waitFor(() => expect(engine.status().pending).toBe(1))
    expect([...(server.rows.get('tasks')?.keys() ?? [])].sort()).toEqual([id(1), id(2)])
    await engine.sync()
    expect(server.rows.get('tasks')?.size).toBe(3)
  })

  it('counts conflicts and dead letters instead of failing on them', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    const engine = await client(server, U1)
    await engine.sync()
    await engine.update('tasks', id(1), { title: 'mine' })
    await engine.create('tasks', { id: id(2), owner: U1 } as never)
    server.update('tasks', id(1), { title: 'theirs' })
    expect(await engine.syncFully()).toEqual({ conflicts: 1, dead: 1 })
  })

  it('counts neither a conflict nor a write too large to send in what it has to push', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    const engine = await client(server, U1)
    await engine.sync()
    await engine.update('tasks', id(1), { title: 'mine' })
    server.update('tasks', id(1), { title: 'theirs' })
    await engine.sync()
    expect(engine.status().conflicts).toBe(1)
    server.push = { max_entries: null, max_bytes: 600 }
    await engine.create('tasks', task(id(2), { title: 'x'.repeat(1000) }))
    await engine.create('tasks', task(id(3)))
    const seen: SyncProgress[] = []
    expect(await engine.syncFully({ onProgress: (p) => seen.push(p) })).toEqual({ conflicts: 1, dead: 1 })
    // The server's limit is learned from its 413, which answered nothing, so nothing counts as sent.
    expect(seen.filter((p) => p.phase === 'push')).toEqual([
      { phase: 'push', sent: 0, total: 2 },
      { phase: 'push', sent: 0, total: 1 },
      { phase: 'push', sent: 1, total: 1 },
    ])
  })

  it('rejects while paused without a request, as sync() makes none', async () => {
    const server = new FakeServer()
    let refuse = true
    const { fetch, calls } = counting(server, () => (refuse ? new Response(null, { status: 401 }) : null))
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    expect(engine.status().paused).toBe('unauthorized')
    refuse = false
    calls.length = 0
    await expect(engine.syncFully()).rejects.toMatchObject({ reason: 'unauthorized' })
    expect(calls).toEqual([])
  })

  it('rejects when the server is out of reach or refuses the user, and when closed', async () => {
    const server = new FakeServer()
    let answer: Response | null = new Response(null, { status: 503, headers: { 'Retry-After': '5' } })
    const { fetch } = counting(server, () => answer)
    const engine = await client(server, U1, { fetch })
    const unreachable = await engine.syncFully().catch((e: unknown) => e)
    expect(unreachable).toBeInstanceOf(SyncUnreachableError)
    expect(unreachable).toMatchObject({ name: 'SyncUnreachableError', retryAfter: 5 })
    expect(engine.status().error).toBe(unreachable)
    answer = new Response(null, { status: 401 })
    const paused = await engine.syncFully().catch((e: unknown) => e)
    expect(paused).toBeInstanceOf(SyncPausedError)
    expect(paused).toMatchObject({ name: 'SyncPausedError', reason: 'unauthorized' })
    expect(engine.status().paused).toBe('unauthorized')
    await expect(engine.syncFully()).rejects.toMatchObject({ reason: 'unauthorized' })
    engine.close()
    await expect(engine.syncFully()).rejects.toThrow('sync: the engine is closed')
  })

  it('stops between requests when its signal aborts, showing no error', async () => {
    const server = new FakeServer()
    for (let n = 1; n <= 4; n += 1) server.create('tasks', task(id(n)))
    const engine = await client(server, U1, { pageSize: 1 })
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const stopped = engine.syncFully({
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'snapshot' && p.received === 2) controller.abort(reason)
      },
    })
    await expect(stopped).rejects.toBe(reason)
    expect(engine.status()).toMatchObject({ syncing: false, error: null })
    expect(engine.progress()).toBeNull()
    await engine.syncFully()
    expect(await engine.count('tasks')).toBe(4)
  })

  it('keeps syncing when an observer throws', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    const engine = await client(server, U1)
    await engine.syncFully({
      onProgress: () => {
        throw new Error('observer')
      },
    })
    expect(await engine.count('tasks')).toBe(1)
  })
})

describe('progress', () => {
  it('is null at rest, and shows any running sync to its subscribers', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    const engine = await client(server, U1)
    expect(engine.progress()).toBeNull()
    const seen: (SyncProgress | null)[] = []
    const unsubscribe = engine.subscribeProgress(() => seen.push(engine.progress()))
    await engine.sync()
    expect(seen).toEqual([{ phase: 'snapshot', scope: null, model: null, received: 1, total: 1 }, null])
    unsubscribe()
    await engine.sync()
    expect(seen).toHaveLength(2)
  })

  it('has no totals the server did not send, and no push phase with nothing to push', async () => {
    const server = new FakeServer()
    const fetch = scripted(server, [
      {
        changes: [{ op: 'snapshot_begin', scope: null, model: null }, up(note(1))],
        cursor: 'c1',
        has_more: true,
      },
      { changes: [{ op: 'snapshot_end', scope: null, model: null }], cursor: 'c2', has_more: true },
      { changes: [up(note(2))], cursor: 'c3', has_more: false },
    ])
    server.grant(U1, `team:${TEAM7}`)
    const engine = await client(server, U1, { fetch })
    const seen: SyncProgress[] = []
    await engine.syncFully({ onProgress: (p) => seen.push(p) })
    expect(seen).toEqual([
      { phase: 'snapshot', scope: null, model: null, received: 1, total: null },
      { phase: 'snapshot', scope: null, model: null, received: 1, total: null },
      { phase: 'pull', received: 1, remaining: null },
    ])
  })

  it('reports the snapshot that ended, among several open', async () => {
    const server = new FakeServer()
    const scope = `team:${TEAM7}`
    const fetch = scripted(server, [
      {
        changes: [
          { op: 'snapshot_begin', scope, model: null, total: 0 },
          { op: 'snapshot_begin', scope: null, model: 'tasks', total: 1 },
          { op: 'upsert', model: 'tasks', id: id(1), etag: '"1"', data: task(id(1)) },
          { op: 'snapshot_end', scope: null, model: 'tasks' },
        ],
        cursor: 'c1',
        has_more: true,
      },
      { changes: [{ op: 'snapshot_end', scope, model: null }], cursor: 'c2', has_more: false },
    ])
    const engine = await client(server, U1, { fetch })
    const seen: SyncProgress[] = []
    await engine.syncFully({ onProgress: (p) => seen.push(p) })
    expect(seen).toEqual([
      { phase: 'snapshot', scope: null, model: 'tasks', received: 1, total: 1 },
      { phase: 'snapshot', scope, model: null, received: 0, total: 0 },
    ])
  })

  it('reports an end it holds no snapshot for as the feed, not a snapshot', async () => {
    const server = new FakeServer()
    const fetch = scripted(server, [
      { changes: [{ op: 'snapshot_end', scope: null, model: 'tasks' }], cursor: 'c1', has_more: false, remaining: 0 },
    ])
    const engine = await client(server, U1, { fetch })
    const seen: SyncProgress[] = []
    await engine.syncFully({ onProgress: (p) => seen.push(p) })
    expect(seen).toEqual([{ phase: 'pull', received: 0, remaining: 0 }])
  })

  it('carries on counting a snapshot a 0.22 client began, which stored no counts', async () => {
    const server = new FakeServer()
    const adapter = createMemoryAdapter()
    const first = await client(server, U1, { adapter })
    first.close()
    const store = await adapter.open(`isik-sync:${U1}`, [{ name: 'meta', indexes: [] }])
    await store.transaction(['meta'], 'readwrite', async (tx) => {
      const state = (await tx.get<Record<string, unknown>>('meta', 'state')) as Record<string, unknown>
      await tx.put('meta', 'state', { ...state, cursor: 'c0', open: [{ scope: null, model: null }] })
    })
    store.close()
    const fetch = scripted(server, [
      { changes: [up(note(1)), { op: 'snapshot_end', scope: null, model: null }], cursor: 'c1', has_more: false },
    ])
    server.grant(U1, `team:${TEAM7}`)
    const engine = await client(server, U1, { adapter, fetch })
    const seen: SyncProgress[] = []
    await engine.syncFully({ onProgress: (p) => seen.push(p) })
    expect(seen).toEqual([{ phase: 'snapshot', scope: null, model: null, received: 1, total: null }])
  })
})
