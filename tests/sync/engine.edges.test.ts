import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PendingWritesError, RowExistsError, RowNotFoundError } from '../../src/sync/engine'
import { createIndexedDBAdapter } from '../../src/sync/idb'
import type { Change, PushEntry, PushResult } from '../../src/sync/protocol'
import type { PushStrategy } from '../../src/sync/push'
import { createSQLiteAdapter } from '../../src/sync/sqlite'
import { TEAM7, U1, client, id, task } from './support/harness'
import { FakeServer, MODELS } from './support/server'
import { sqlJsOptions } from './support/sqljs'

// The engine at its edges: each case here pins one behaviour a mutation test found unpinned.

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const TEAM8 = '0190a000-0000-7000-8000-b00000000008'
const note = (n: number, team = TEAM7) => ({ id: id(n), team, body: `note ${n}` })
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Isik-Sync-Protocol': '1', ...headers } })
const page = (changes: Change[], cursor = 'c', more = false) => json(200, { changes, cursor, has_more: more })
const up = (model: string, data: { id: string } & Record<string, unknown>, etag = `"${data.id}"`): Change => ({
  op: 'upsert',
  model,
  id: data.id,
  etag,
  data,
})
const begin = (scope: string | null, model: string | null): Change => ({ op: 'snapshot_begin', scope, model })
const end = (scope: string | null, model: string | null): Change => ({ op: 'snapshot_end', scope, model })

/** A fetch whose feed answers come from `pages` in order - quiet once they run out - and the rest from `server`. */
function feedOf(server: FakeServer, pages: Response[], push?: (body: unknown) => Response | undefined) {
  const base = server.fetchAs(() => U1)
  const feed: { query: URLSearchParams; headers: Headers }[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/sync/changes') {
      feed.push({ query: url.searchParams, headers: new Headers(init?.headers) })
      return pages.shift() ?? page([], url.searchParams.get('cursor') ?? 'c')
    }
    if (url.pathname === '/sync/push' && push !== undefined) {
      const answer = push(JSON.parse(String(init?.body)))
      if (answer !== undefined) return answer
    }
    return base(input, init)
  }
  return { fetch, feed }
}

function answering(results: (entries: PushEntry[], call: number) => PushResult[]) {
  const handed: PushEntry[][] = []
  const strategy: PushStrategy = async (entries) => {
    handed.push(entries)
    return { results: results(entries, handed.length) }
  }
  return { strategy, handed }
}

describe('errors', () => {
  it('name themselves', async () => {
    const engine = await client(new FakeServer())
    expect(await engine.update('tasks', id(1), {}).catch((e: unknown) => e)).toMatchObject({ name: 'RowNotFoundError' })
    expect(new RowNotFoundError('tasks', 'x').name).toBe('RowNotFoundError')
    expect(new RowExistsError('tasks', 'x').name).toBe('RowExistsError')
    expect(new PendingWritesError(1).name).toBe('PendingWritesError')
  })

  it('say why the engine paused, and why it is offline, with the cause', async () => {
    const server = new FakeServer()
    const failure = new TypeError('fetch failed')
    const offline = await client(server, U1, {
      fetch: async () => {
        throw failure
      },
    })
    await offline.sync()
    expect(offline.status().error).toMatchObject({ message: 'sync: the server could not be reached', cause: failure })

    const { fetch } = feedOf(server, [json(401, {})])
    const paused = await client(server, U1, { fetch })
    await paused.sync()
    expect(paused.status().error).toMatchObject({ message: 'sync: paused (unauthorized)' })

    const { strategy } = answering((entries) => entries.map((e) => ({ key: e.key, status: 503 })))
    const retried = await client(server, U1, { push: strategy })
    await retried.create('tasks', task(id(1)))
    await retried.sync()
    expect(retried.status().error).toMatchObject({
      message: 'sync: the server could not be reached',
      cause: 'an entry asked to be retried',
    })
  })
})

describe('the queue', () => {
  it('keeps its order past nine entries', async () => {
    const engine = await client(new FakeServer())
    for (let n = 1; n <= 12; n += 1) await engine.create('tasks', task(id(n)))
    expect((await engine.pendingEntries()).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect((await engine.pendingEntries()).map((e) => e.id)).toEqual(Array.from({ length: 12 }, (_, i) => id(i + 1)))
  })

  it('stamps entries and syncs with the clock by default', async () => {
    const engine = await client(new FakeServer(), U1, { now: undefined })
    const before = Date.now()
    await engine.create('tasks', task(id(1)))
    expect((await engine.pendingEntries())[0].createdAt).toBeGreaterThanOrEqual(before)
    await engine.sync()
    expect(engine.status().lastSyncedAt).toBeGreaterThanOrEqual(before)
  })

  it('lists one state only when asked, and puts a dead letter back as pending', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('tasks', task(id(1)))
    await engine.create('tasks', task(id(2)))
    await engine.sync()
    server.update('tasks', id(1), { title: 'theirs' })
    await engine.update('tasks', id(1), { title: 'mine' })
    await engine.update('tasks', id(2), { title: '' })
    await engine.sync()
    await engine.create('tasks', task(id(3)))
    expect((await engine.pendingEntries({ state: 'conflict' })).map((e) => e.id)).toEqual([id(1)])
    expect((await engine.pendingEntries({ state: 'pending' })).map((e) => e.id)).toEqual([id(3)])
    expect(await engine.pendingEntries({ state: 'sending' })).toEqual([])
    await engine.retryDead((await engine.deadLetters())[0].entry.seq)
    expect(await engine.pendingCounts()).toEqual({ pending: 2, sending: 0, conflicts: 1, dead: 0 })
    await vi.waitFor(() => expect(engine.status().pending).toBe(3))
  })

  it('holds a queued create with the base it needs, and nothing it does not', async () => {
    const engine = await client(new FakeServer())
    await engine.create('tasks', { id: id(1), owner: U1, title: 't' })
    await engine.update('tasks', id(1), { done: true })
    expect((await engine.pendingEntries())[0].base).toStrictEqual({})
  })

  it('keeps a row whose create is out and whose delete is queued, showing nothing', async () => {
    const server = new FakeServer()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const base = server.fetchAs(() => U1)
    const engine = await client(server, U1, {
      fetch: async (input, init) => {
        if (String(input).endsWith('/sync/push')) await gate
        return base(input, init)
      },
    })
    await engine.create('tasks', task(id(1)))
    const syncing = engine.sync()
    await vi.waitFor(async () => expect((await engine.pendingCounts()).sending).toBe(1))
    await engine.remove('tasks', id(1))
    expect(await engine.get('tasks', id(1))).toBeUndefined()
    await vi.waitFor(() => expect(engine.status().pending).toBe(2))
    await expect(engine.wipe()).rejects.toMatchObject({ pending: 2 })
    release()
    await syncing
    await engine.sync()
    expect(server.rows.get('tasks')?.size).toBe(0)
  })

  it('counts conflicts as unsent when wiping', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    server.update('tasks', id(1), { title: 'theirs' })
    await engine.update('tasks', id(1), { title: 'mine' })
    await engine.sync()
    expect(await engine.pendingCounts()).toMatchObject({ pending: 0, conflicts: 1 })
    await expect(engine.wipe()).rejects.toMatchObject({ pending: 1 })
  })
})

describe('local queries', () => {
  it('matches an index by every field, in order, and names them all when none does', async () => {
    const engine = await client(new FakeServer())
    await expect(engine.query('tasks', { index: ['owner', 'title'] })).rejects.toThrow(
      'sync: tasks has no index on owner, title'
    )
    await expect(engine.query('tasks', { index: ['done', 'x'] })).rejects.toThrow('no index on done, x')
    await expect(engine.query('tasks', { index: ['title', 'done'] })).rejects.toThrow('no index on title, done')
  })

  it('refuses bounds without the index they bound', async () => {
    const engine = await client(new FakeServer())
    const message = 'sync: a query of tasks by bounds names the index they bound'
    await expect(engine.query('tasks', { equals: [1] })).rejects.toThrow(message)
    await expect(engine.query('tasks', { lower: [1] })).rejects.toThrow(message)
    await expect(engine.count('tasks', { upper: [1] })).rejects.toThrow(message)
  })
})

describe('the network', () => {
  it('resolves paths against a base URL with any number of trailing slashes', async () => {
    const server = new FakeServer()
    const paths: string[] = []
    const base = server.fetchAs(() => U1)
    const engine = await client(server, U1, {
      baseUrl: 'http://api.test/v1//',
      fetch: async (input, init) => {
        paths.push(new URL(String(input)).pathname)
        return base(String(input).replace('/v1', ''), init)
      },
    })
    await engine.sync()
    expect(paths).toEqual(['/v1/sync/capabilities', '/v1/sync/changes'])
  })

  it('starts with its status at rest, and says when it is syncing', async () => {
    const engine = await client(new FakeServer())
    expect(engine.status()).toStrictEqual({
      online: true,
      syncing: false,
      paused: null,
      lastSyncedAt: null,
      pending: 0,
      conflicts: 0,
      dead: 0,
      loading: [],
      error: null,
    })
    const seen: boolean[] = []
    const unsubscribe = engine.subscribeStatus(() => seen.push(engine.status().syncing))
    await engine.sync()
    expect(seen[0]).toBe(true)
    expect(engine.status().syncing).toBe(false)
    unsubscribe()
    const after = seen.length
    await engine.sync()
    expect(seen).toHaveLength(after)
  })

  it('comes back online on the next request that reaches the server, feed or push', async () => {
    const server = new FakeServer()
    let down = true
    const base = server.fetchAs(() => U1)
    const flaky: typeof fetch = async (input, init) => {
      if (down) throw new TypeError('fetch failed')
      return base(input, init)
    }
    const engine = await client(server, U1, { fetch: flaky })
    await engine.sync()
    expect(engine.status().online).toBe(false)
    down = false
    await engine.sync()
    expect(engine.status().online).toBe(true)

    let strategyDown = true
    const pushing = await client(server, U1, {
      fetch: flaky,
      push: async (entries) => {
        if (strategyDown) throw new TypeError('fetch failed')
        return { results: entries.map((e) => ({ key: e.key, status: 201, data: e.body })) }
      },
    })
    await pushing.create('tasks', task(id(5)))
    await pushing.sync()
    expect(pushing.status().online).toBe(false)
    strategyDown = false
    down = true
    // The push reaches the server while the feed is still down: the push alone says it is back.
    const results: boolean[] = []
    pushing.subscribeStatus(() => results.push(pushing.status().online))
    await pushing.sync()
    expect(results).toContain(true)
  })

  it('reads the feed refusing in every way', async () => {
    const server = new FakeServer()
    const cases: [Response, string | null][] = [
      [new Response('not json', { status: 400 }), 'fatal'],
      [new Response('null', { status: 400 }), 'fatal'],
      [json(409, { code: 'sync_protocol_unsupported' }), 'fatal'],
      [json(429, {}, { 'Retry-After': '3' }), 'offline'],
    ]
    for (const [response, kind] of cases) {
      const { fetch } = feedOf(server, [response])
      const engine = await client(server, U1, { fetch })
      if (kind === 'fatal') await expect(engine.sync()).rejects.toThrow(/answered/)
      else {
        await engine.sync()
        expect(engine.status().error).toMatchObject({ retryAfter: 3 })
      }
    }
  })

  it('reads the push refusing in every way', async () => {
    const cases: [Response, string][] = [
      [new Response('not json', { status: 400 }), 'fatal'],
      [json(400, { code: 'other' }), 'fatal'],
      [json(409, { code: 'sync_protocol_unsupported' }), 'fatal'],
      [new Response('null', { status: 400 }), 'fatal'],
      [new Response(null, { status: 500 }), 'offline'],
    ]
    for (const [response, kind] of cases) {
      const server = new FakeServer()
      const { fetch } = feedOf(server, [], () => response.clone())
      const engine = await client(server, U1, { fetch })
      await engine.create('tasks', task(id(1)))
      if (kind === 'fatal') await expect(engine.sync()).rejects.toThrow('sync: the push was refused with')
      else {
        await engine.sync()
        expect(engine.status()).toMatchObject({ paused: null, error: { retryAfter: null } })
      }
    }
  })

  it('holds the Web Lock across the whole sync, which then runs', async () => {
    const locks = {
      request: vi.fn(async (_: string, callback: () => Promise<unknown>) => callback()),
    } as unknown as LockManager
    const engine = await client(new FakeServer(), U1, { locks })
    await engine.sync()
    expect(engine.status().lastSyncedAt).not.toBeNull()
  })

  it('does nothing while paused', async () => {
    const server = new FakeServer()
    const { fetch, feed } = feedOf(server, [json(401, {})])
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    const asked = feed.length
    await engine.sync()
    expect(feed).toHaveLength(asked)
  })
})

describe('pushing, precisely', () => {
  it('sends a create with no etag even once the feed has echoed it, and a delete with no body', async () => {
    const server = new FakeServer()
    let dropped = false
    const base = server.fetchAs(() => U1)
    const sent: PushEntry[][] = []
    const engine = await client(server, U1, {
      fetch: async (input, init) => {
        const response = await base(input, init)
        if (String(input).endsWith('/sync/push')) {
          sent.push(JSON.parse(String(init?.body)).entries)
          if (!dropped) {
            dropped = true
            throw new TypeError('fetch failed')
          }
        }
        return response
      },
    })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    expect((await engine.pendingEntries())[0].method).toBe('POST')
    await engine.sync()
    expect(sent[1][0]).toStrictEqual({
      key: sent[0][0].key,
      method: 'POST',
      model: 'tasks',
      id: id(1),
      body: task(id(1)),
    })
    await engine.remove('tasks', id(1))
    await engine.sync()
    expect(sent[2][0]).toStrictEqual({
      key: sent[2][0].key,
      method: 'DELETE',
      model: 'tasks',
      id: id(1),
      if_match: server.etagOf('tasks', id(1)) ?? sent[2][0].if_match,
    })
    expect(Object.keys(sent[2][0])).not.toContain('body')
  })

  it('hands a strategy a delete with no body, and a create echoed back with no etag', async () => {
    const server = new FakeServer()
    let calls = 0
    const { strategy, handed } = answering((entries) => {
      calls += 1
      // The first answer never comes, though the server took the create: the feed echoes it.
      const results = entries.map((e) => server.pushEntry(U1, e))
      return calls === 1 ? [] : results
    })
    const engine = await client(server, U1, { push: strategy })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    await engine.sync()
    expect(handed[1][0]).toStrictEqual({
      key: handed[0][0].key,
      method: 'POST',
      model: 'tasks',
      id: id(1),
      body: task(id(1)),
    })
    await engine.remove('tasks', id(1))
    await engine.sync()
    expect(handed[2][0]).toStrictEqual({
      key: handed[2][0].key,
      method: 'DELETE',
      model: 'tasks',
      id: id(1),
      if_match: handed[2][0].if_match,
    })
    expect(handed[2][0].if_match).toMatch(/^"/)
  })

  it('shows the server row under my side of a conflict, and takes it whole for theirs', async () => {
    const server = new FakeServer()
    const { fetch } = feedOf(server, [page([begin(null, null), up('tasks', task(id(1))), end(null, null)])])
    const current = task(id(1), { title: 'theirs', done: true })
    const { strategy } = answering((entries) => entries.map((e) => ({ key: e.key, status: 412, etag: '"t"', current })))
    const engine = await client(server, U1, { fetch, push: strategy })
    await engine.sync()
    await engine.update('tasks', id(1), { title: 'mine' })
    await engine.sync()
    expect(await engine.get('tasks', id(1))).toEqual({ ...current, title: 'mine' })
    await engine.takeTheirs((await engine.pendingEntries({ state: 'conflict' }))[0].seq)
    expect(await engine.get('tasks', id(1))).toEqual(current)
  })

  it('tells no one of a status that did not change', async () => {
    const engine = await client(new FakeServer())
    let told = 0
    engine.subscribeStatus(() => {
      told += 1
    })
    engine.resume()
    expect(told).toBe(0)
  })

  it('sends no etag for a row it has no server copy of', async () => {
    const server = new FakeServer()
    server.grant(U1, `team:${TEAM7}`)
    const engine = await client(server)
    await engine.create('notes', note(1))
    await engine.sync()
    engine.close()
    const { strategy, handed } = answering((entries) => entries.map((e) => ({ key: e.key, status: 404 })))
    const raw = await client(server, U1, { adapter: engine.adapter })
    await raw.update('notes', id(1), { body: 'x' })
    raw.close()
    const fewer = await client(server, U1, { adapter: engine.adapter, resources: [MODELS.tasks], push: strategy })
    await fewer.sync()
    expect(handed[0][0]).not.toHaveProperty('if_match')
  })

  it('buries a child whose parent was created in the same batch, and requeues one whose parent failed - a 300 included', async () => {
    const cases: [number, number, string][] = [
      [201, 400, 'dead'],
      [300, 400, 'requeued'],
      [400, 201, 'done'],
    ]
    for (const [parentStatus, childStatus, fate] of cases) {
      const { strategy } = answering((entries) =>
        entries.map((e, i) =>
          i === 0
            ? { key: e.key, status: parentStatus, ...(parentStatus < 300 ? { data: e.body } : {}) }
            : { key: e.key, status: childStatus, ...(childStatus < 300 ? { data: e.body } : {}) }
        )
      )
      const engine = await client(new FakeServer(), U1, { push: strategy })
      await engine.create('projects', { id: id(100), owner: U1, name: 'p' })
      await engine.create('tasks', task(id(1), { project: id(100) }))
      await engine.sync()
      const dead = (await engine.deadLetters()).map((letter) => letter.entry.id)
      const queued = (await engine.pendingEntries()).map((e) => e.id)
      if (fate === 'dead') expect(dead).toEqual([id(1)])
      if (fate === 'requeued') expect(queued).toEqual([id(1)])
      if (fate === 'done') expect(queued).not.toContain(id(1))
    }
  })

  it('buries a child that names a row whose update - not create - failed beside it', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('projects', { id: id(100), owner: U1, name: 'p' })
    await engine.sync()
    await engine.update('projects', id(100), { name: '' })
    await engine.create('tasks', task(id(1), { title: '', project: id(100) }))
    await engine.sync()
    expect((await engine.deadLetters()).map((letter) => letter.entry.id).sort()).toEqual([id(100), id(1)].sort())
  })

  it('lets a reference to a row whose update is dead go', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('projects', { id: id(100), owner: U1, name: 'p' })
    await engine.sync()
    await engine.update('projects', id(100), { name: '' })
    await engine.sync()
    await engine.create('tasks', task(id(1), { project: id(100) }))
    await engine.sync()
    expect(server.rows.get('tasks')?.has(id(1))).toBe(true)
  })

  it('keeps an empty etag from a write answered without one, and sends it as such', async () => {
    const { strategy, handed } = answering((entries) =>
      entries.map((e) => ({ key: e.key, status: 200, data: { ...task(e.id), ...e.body } }))
    )
    const server = new FakeServer()
    const { fetch } = feedOf(server, [page([begin(null, null), up('tasks', task(id(1))), end(null, null)])])
    const engine = await client(server, U1, { push: strategy, fetch })
    await engine.sync()
    await engine.update('tasks', id(1), { done: true })
    await engine.sync()
    await engine.update('tasks', id(1), { title: 'x' })
    await engine.sync()
    expect(handed[1][0].if_match).toBe('')
  })

  it('sends a rebased update against the etag the 412 carried, the row showing theirs and mine', async () => {
    let call = 0
    let shownBetween: unknown
    const server = new FakeServer()
    const { fetch } = feedOf(server, [page([begin(null, null), up('tasks', task(id(1))), end(null, null)])])
    const engine = await client(server, U1, {
      fetch,
      push: async (entries) => {
        call += 1
        if (call === 1)
          return {
            results: [
              { key: entries[0].key, status: 412, etag: '"theirs"', current: task(id(1), { title: 'theirs' }) },
            ],
          }
        shownBetween = await engine.get('tasks', id(1))
        return {
          results: [
            { key: entries[0].key, status: 200, etag: '"both"', data: task(id(1), { title: 'theirs', done: true }) },
          ],
        }
      },
    })
    await engine.sync()
    await engine.update('tasks', id(1), { done: true })
    await engine.sync()
    expect(shownBetween).toEqual(task(id(1), { title: 'theirs', done: true }))
  })

  it('takes a deleted row out at once, before any pull', async () => {
    const server = new FakeServer()
    const { fetch } = feedOf(server, [page([begin(null, null), up('tasks', task(id(1))), end(null, null)])])
    const { strategy } = answering((entries) => entries.map((e) => ({ key: e.key, status: 204 })))
    const engine = await client(server, U1, { fetch, push: strategy })
    await engine.sync()
    await engine.remove('tasks', id(1))
    await engine.sync()
    expect(await engine.query('tasks')).toEqual([])
  })

  it('takes a 2xx even for a child whose parent failed beside it', async () => {
    const { strategy } = answering((entries) =>
      entries.map((e, i) => (i === 0 ? { key: e.key, status: 400 } : { key: e.key, status: 201, data: e.body }))
    )
    const engine = await client(new FakeServer(), U1, { push: strategy })
    await engine.create('projects', { id: id(100), owner: U1, name: 'p' })
    await engine.create('tasks', task(id(1), { project: id(100) }))
    await engine.sync()
    expect((await engine.pendingEntries()).map((e) => e.id)).toEqual([])
  })
})

describe('the feed, precisely', () => {
  it('announces the models a pull changed', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    const engine = await client(server)
    const events: unknown[] = []
    engine.subscribe((event) => events.push(event))
    await engine.sync()
    expect(events).toContainEqual({ models: ['tasks'], outbox: false })
  })

  it('applies a change outside every open snapshot at once, and stages one inside', async () => {
    const server = new FakeServer()
    const { fetch } = feedOf(server, [
      page([begin(null, null), end(null, null)], 'c0', true),
      page(
        [
          begin(null, 'projects'),
          begin(`team:${TEAM7}`, null),
          up('tasks', task(id(1))),
          up('notes', note(2, TEAM8)),
          up('notes', note(3)),
          up('projects', { id: id(4), owner: U1, name: 'p' }),
        ],
        'c1',
        true
      ),
      page([end(`team:${TEAM7}`, null), up('projects', { id: id(5), owner: U1, name: 'q' })], 'c2', true),
      page([end(null, 'projects')], 'c3'),
    ])
    // Each page waits for the reads the last one prompted, so a slow read never sees a later page.
    let reads: Promise<unknown> = Promise.resolve()
    const paced: typeof fetch = async (input, init) => {
      await reads
      return fetch(input, init)
    }
    const engine = await client(server, U1, { fetch: paced })
    const seen: string[][] = []
    engine.subscribe(() => {
      reads = (async () => {
        seen.push([
          ...(await engine.query('tasks')).map((r) => r.id),
          ...(await engine.query('notes')).map((r) => r.id),
          ...(await engine.query('projects')).map((r) => r.id),
        ])
      })()
    })
    await engine.sync()
    await reads
    expect(seen[0]).toEqual([id(1), id(2)])
    expect(seen[1]).toEqual([id(1), id(2), id(3)])
    expect(seen[2]).toEqual([id(1), id(2), id(3), id(4), id(5)])
  })

  it("keeps another snapshot's staging when a scope is revoked, and swaps it in at its end", async () => {
    const server = new FakeServer()
    const { fetch } = feedOf(server, [
      page([begin(null, null), end(null, null)], 'c0', true),
      page(
        [
          begin(null, 'projects'),
          up('projects', { id: id(4), owner: U1, name: 'p' }),
          { op: 'scope_granted', scope: `team:${TEAM7}` },
          begin(`team:${TEAM7}`, null),
          up('notes', note(3)),
        ],
        'c1',
        true
      ),
      page([{ op: 'scope_revoked', scope: `team:${TEAM7}` }, end(null, 'projects')], 'c2'),
    ])
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    expect((await engine.query('projects')).map((r) => r.id)).toEqual([id(4)])
    expect(await engine.query('notes')).toEqual([])
  })

  it('forgets what a revoked scope staged, should it be granted again', async () => {
    const server = new FakeServer()
    const grant: Change = { op: 'scope_granted', scope: `team:${TEAM7}` }
    const { fetch } = feedOf(server, [
      page([begin(null, null), end(null, null)], 'c0', true),
      page([grant, begin(`team:${TEAM7}`, null), up('notes', note(3))], 'c1', true),
      page(
        [
          { op: 'scope_revoked', scope: `team:${TEAM7}` },
          grant,
          begin(`team:${TEAM7}`, null),
          up('notes', note(4)),
          end(`team:${TEAM7}`, null),
        ],
        'c2'
      ),
    ])
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    expect((await engine.query('notes')).map((r) => r.id)).toEqual([id(4)])
  })

  it('keeps staging what another open snapshot covers after a revoke', async () => {
    const server = new FakeServer()
    const { fetch } = feedOf(server, [
      page([begin(null, null), end(null, null)], 'c0', true),
      page(
        [begin(null, 'projects'), { op: 'scope_granted', scope: `team:${TEAM7}` }, begin(`team:${TEAM7}`, null)],
        'c1',
        true
      ),
      page(
        [{ op: 'scope_revoked', scope: `team:${TEAM7}` }, up('projects', { id: id(4), owner: U1, name: 'p' })],
        'c2',
        true
      ),
      page([end(null, 'projects')], 'c3'),
    ])
    const seen: number[] = []
    const watching: Awaited<ReturnType<typeof client>> = await client(server, U1, {
      fetch: async (input, init) => {
        // The page after the revoke has been applied: the project it brought must still be staged.
        if (String(input).includes('cursor=c2')) seen.push(await watching.count('projects'))
        return fetch(input, init)
      },
    })
    await watching.sync()
    expect(seen).toEqual([0])
    expect(await watching.count('projects')).toBe(1)
  })

  it('swaps a model snapshot over that model only, and a scope snapshot over that scope only', async () => {
    const server = new FakeServer()
    const { fetch } = feedOf(server, [
      page(
        [
          begin(null, null),
          up('notes', note(1)),
          up('notes', note(2, TEAM8)),
          up('projects', { id: id(4), owner: U1, name: 'p' }),
          up('tasks', task(id(5))),
          up('tasks', task(id(6))),
          end(null, null),
        ],
        'c0',
        true
      ),
      page([begin(null, 'tasks'), up('tasks', task(id(6), { title: 'again' })), end(null, 'tasks')], 'c1', true),
      page([begin(`team:${TEAM7}`, null), end(`team:${TEAM7}`, null)], 'c2'),
    ])
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    expect((await engine.query('tasks')).map((r) => [r.id, r.title])).toEqual([[id(6), 'again']])
    expect((await engine.query('notes')).map((r) => r.id)).toEqual([id(2)])
    expect(await engine.count('projects')).toBe(1)
  })

  it("keeps a row's queued update through a snapshot that has the row, and a create only this device has", async () => {
    const server = new FakeServer()
    let push = false
    const { fetch } = feedOf(
      server,
      [
        page([begin(null, null), up('tasks', task(id(1))), end(null, null)], 'c0'),
        json(410, { code: 'sync_cursor_expired' }),
        page([begin(null, null), up('tasks', task(id(1))), end(null, null)], 'c1'),
      ],
      () => (push ? undefined : new Response(null, { status: 503 }))
    )
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    await engine.update('tasks', id(1), { done: true })
    await engine.create('tasks', task(id(2)))
    await engine.sync()
    expect(await engine.deadLetters()).toEqual([])
    expect((await engine.pendingEntries()).map((e) => e.id)).toEqual([id(1), id(2)])
    expect((await engine.query('tasks')).map((r) => r.id)).toEqual([id(1), id(2)])
    push = true
  })

  it('keeps loading the scopes still loading, and stops for one revoked before its snapshot ended', async () => {
    const server = new FakeServer()
    const { fetch } = feedOf(server, [
      page(
        [
          { op: 'scope_granted', scope: `team:${TEAM7}` },
          { op: 'scope_granted', scope: `team:${TEAM8}` },
          begin(`team:${TEAM7}`, null),
          end(`team:${TEAM7}`, null),
        ],
        'c0'
      ),
    ])
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    expect(engine.status().loading).toEqual([`team:${TEAM8}`])
    const revoked = feedOf(server, [
      page(
        [
          { op: 'scope_granted', scope: `team:${TEAM7}` },
          { op: 'scope_granted', scope: `team:${TEAM8}` },
          { op: 'scope_revoked', scope: `team:${TEAM7}` },
        ],
        'c0'
      ),
    ])
    const other = await client(server, U1, { fetch: revoked.fetch, adapter: undefined })
    await other.sync()
    expect(other.status().loading).toEqual([`team:${TEAM8}`])
  })

  it('asks for every table still to snapshot until each begins', async () => {
    const server = new FakeServer()
    const { fetch, feed } = feedOf(server, [
      page([begin(null, null), end(null, null)], 'c0'),
      page([begin(null, 'tasks'), end(null, 'tasks')], 'c1', true),
      page([begin(null, 'projects'), end(null, 'projects')], 'c2'),
      page([], 'c3'),
    ])
    const engine = await client(server, U1, { fetch, resources: [MODELS.notes] })
    await engine.sync()
    engine.close()
    const more = await client(server, U1, { fetch, adapter: engine.adapter })
    await more.sync()
    expect(feed.map((r) => r.query.getAll('snapshot').join())).toEqual(['', 'tasks,projects', 'projects'])
  })

  it('sends If-None-Match only for an answer that had an ETag, and never beside a snapshot request', async () => {
    const server = new FakeServer()
    const { fetch, feed } = feedOf(server, [
      page([begin(null, null), end(null, null)], 'c0'),
      page([], 'c0'),
      json(200, { changes: [], cursor: 'c0', has_more: false }, { ETag: '"quiet"' }),
      json(200, { changes: [], cursor: 'c0', has_more: false }, { ETag: '"quiet"' }),
      page([begin(null, 'projects'), end(null, 'projects')], 'c0'),
    ])
    const engine = await client(server, U1, { fetch, resources: [MODELS.tasks] })
    await engine.sync()
    await engine.sync()
    await engine.sync()
    await engine.sync()
    expect(feed.map((r) => r.headers.get('If-None-Match'))).toEqual([null, null, null, '"quiet"'])
    engine.close()
    const more = await client(server, U1, {
      fetch,
      adapter: engine.adapter,
      resources: [MODELS.tasks, MODELS.projects],
    })
    await more.sync()
    expect(feed[4].headers.get('If-None-Match')).toBeNull()
    expect(feed[4].query.getAll('snapshot')).toEqual(['projects'])
  })

  it('starts over clean after a 410: no snapshot asked for, nothing loading', async () => {
    const server = new FakeServer()
    const first = feedOf(server, [
      page([begin(null, null), end(null, null)], 'c0'),
      page([{ op: 'scope_granted', scope: `team:${TEAM7}` }], 'c1'),
    ])
    const engine = await client(server, U1, { fetch: first.fetch, resources: [MODELS.tasks] })
    await engine.sync()
    await engine.sync()
    expect(engine.status().loading).toEqual([`team:${TEAM7}`])
    engine.close()
    const { fetch, feed } = feedOf(server, [
      json(410, { code: 'sync_cursor_expired' }),
      page([begin(null, null), end(null, null)], 'c2'),
    ])
    const more = await client(server, U1, { fetch, adapter: engine.adapter })
    await more.sync()
    expect(feed.map((r) => r.query.getAll('snapshot').join())).toEqual(['projects,notes', ''])
    expect(feed[1].query.has('cursor')).toBe(false)
    expect(more.status().loading).toEqual([])
  })
})

describe('starting and stopping', () => {
  it('starts where window has no addEventListener, navigator is missing, or storage cannot persist', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', undefined)
    const one = await client(new FakeServer())
    one.start()
    one.close()
    vi.stubGlobal('navigator', { storage: {} })
    const two = await client(new FakeServer())
    two.start()
    two.close()
  })

  it('removes its listeners when stopped, and stops syncing on writes', async () => {
    vi.useFakeTimers()
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    const server = new FakeServer()
    const engine = await client(server, U1, { debounce: 10 })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    engine.stop()
    expect(removeWindow).toHaveBeenCalledWith('online', expect.any(Function))
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    await engine.create('tasks', task(id(1)))
    await vi.advanceTimersByTimeAsync(1000)
    expect(server.rows.get('tasks')?.size ?? 0).toBe(0)
  })

  it('waits the default debounce, not a moment less', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const engine = await client(server, U1, { debounce: undefined })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    await engine.create('tasks', task(id(1)))
    await vi.advanceTimersByTimeAsync(499)
    expect(server.rows.get('tasks')?.size ?? 0).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(server.rows.get('tasks')?.size).toBe(1)
    engine.close()
  })
})

describe('on every adapter', () => {
  const adapters = [
    ['indexeddb', () => createIndexedDBAdapter({ indexedDB: new IDBFactory() })],
    ['sqlite', () => createSQLiteAdapter(sqlJsOptions())],
  ] as const

  it.each(adapters)('syncs, queues, conflicts and starts over on %s', async (_, make) => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    const engine = await client(server, U1, { adapter: make() })
    await engine.sync()
    await engine.create('tasks', task(id(2)))
    await engine.update('tasks', id(1), { done: true })
    await engine.sync()
    expect(server.rows.get('tasks')?.get(id(1))?.data.done).toBe(true)
    server.update('tasks', id(2), { title: 'theirs' })
    await engine.update('tasks', id(2), { title: 'mine' })
    await engine.sync()
    expect(await engine.pendingCounts()).toMatchObject({ conflicts: 1 })
    server.delete('tasks', id(1))
    server.expire()
    await engine.sync()
    expect((await engine.query('tasks', { index: ['done', 'title'] })).map((r) => r.id)).toEqual([id(2)])
  })
})
