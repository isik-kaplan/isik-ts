import { describe, expect, it } from 'vitest'

import type { Change } from '../../src/sync/protocol'
import { TEAM7, U1, client, id, task } from './support/harness'
import { FakeServer, MODELS } from './support/server'

// How the engine pulls the feed and applies it.

const TEAM8 = '0190a000-0000-7000-8000-b00000000008'
const note = (n: number, team = TEAM7, body = `note ${n}`) => ({ id: id(n), team, body })

function recording(
  server: FakeServer,
  override?: (path: string, query: URLSearchParams, init?: RequestInit) => Response | undefined
) {
  const base = server.fetchAs(() => U1)
  const requests: { path: string; query: URLSearchParams; headers: Headers }[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    requests.push({ path: url.pathname, query: url.searchParams, headers: new Headers(init?.headers) })
    return override?.(url.pathname, url.searchParams, init) ?? base(input, init)
  }
  const feed = () => requests.filter((r) => r.path === '/sync/changes')
  return { fetch, requests, feed }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Isik-Sync-Protocol': '1', ...headers } })

describe('pulling', () => {
  it('takes a first snapshot in pages, then the live feed, and asks with If-None-Match once quiet', async () => {
    const server = new FakeServer()
    for (let n = 1; n <= 5; n += 1) server.create('tasks', task(id(n)))
    const { fetch, feed } = recording(server)
    const engine = await client(server, U1, { fetch, pageSize: 2 })
    await engine.sync()
    expect(await engine.count('tasks')).toBe(5)
    expect(feed().map((r) => r.query.get('limit'))).toEqual(['2', '2', '2'])
    expect(feed()[0].query.has('cursor')).toBe(false)
    expect(feed()[1].query.get('cursor')).toBeTruthy()
    expect(feed()[0].headers.get('Isik-Sync-Protocol')).toBe('1')

    await engine.sync()
    await engine.sync()
    const last = feed().slice(-2)
    expect(last[0].headers.get('If-None-Match')).toBeNull()
    expect(last[1].headers.get('If-None-Match')).toMatch(/^"feed:/)

    server.update('tasks', id(1), { title: 'changed' })
    await engine.sync()
    expect((await engine.get('tasks', id(1)))?.title).toBe('changed')
  })

  it('shows the rows it had until a snapshot is complete, then swaps it in', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    server.create('tasks', task(id(2)))
    let stop = false
    const { fetch } = recording(server, (path, query) =>
      stop && path === '/sync/changes' && query.has('cursor') ? new Response(null, { status: 503 }) : undefined
    )
    const engine = await client(server, U1, { fetch, pageSize: 1 })
    await engine.sync()
    server.delete('tasks', id(1))
    server.expire()
    // After a 410, the full snapshot arrives a row a page; cut it after its first page.
    stop = true
    const original = await engine.query('tasks')
    await engine.sync()
    expect(await engine.query('tasks')).toEqual(original)
    stop = false
    await engine.sync()
    expect((await engine.query('tasks')).map((row) => row.id)).toEqual([id(2)])
  })

  it('keeps a row only this device has made through a full snapshot', async () => {
    const server = new FakeServer()
    let refuse = true
    const { fetch } = recording(server, (path) =>
      refuse && path === '/sync/push' ? new Response(null, { status: 503 }) : undefined
    )
    const engine = await client(server, U1, { fetch })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    expect(await engine.get('tasks', id(1))).toBeDefined()
    refuse = false
  })

  it('applies a delete, burying a queued update of that row and settling a queued delete', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    server.create('tasks', task(id(2)))
    server.create('tasks', task(id(3)))
    let push = false
    const { fetch } = recording(server, (path) =>
      !push && path === '/sync/push' ? new Response(null, { status: 503 }) : undefined
    )
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    await engine.update('tasks', id(1), { done: true })
    await engine.remove('tasks', id(2))
    server.delete('tasks', id(1))
    server.delete('tasks', id(2))
    server.delete('tasks', id(3))
    push = true
    // Push first would 404 the update; pull with the push still failing.
    push = false
    await engine.sync()
    expect(await engine.query('tasks')).toEqual([])
    expect(await engine.pendingEntries()).toEqual([])
    expect((await engine.deadLetters()).map((letter) => [letter.entry.id, letter.reason, letter.status])).toEqual([
      [id(1), 'deleted', 0],
    ])
  })

  it('keeps a queued create through a delete the feed reports for it', async () => {
    const server = new FakeServer()
    const changes: Change[] = [{ op: 'delete', model: 'tasks', id: id(1) }]
    const answers: Record<string, () => Response> = {
      '/sync/changes': () => json(200, { changes, cursor: 'c', has_more: false }),
      '/sync/push': () => new Response(null, { status: 503 }),
    }
    const { fetch } = recording(server, (path) => answers[path]?.())
    const engine = await client(server, U1, { fetch })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    expect(await engine.pendingFor('tasks', id(1))).toHaveLength(1)
    expect(await engine.get('tasks', id(1))).toEqual(task(id(1)))
  })

  it("keeps a row's own queued change on top of what the feed brings", async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    let push = false
    const { fetch } = recording(server, (path) =>
      !push && path === '/sync/push' ? new Response(null, { status: 503 }) : undefined
    )
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    await engine.update('tasks', id(1), { done: true })
    server.update('tasks', id(1), { title: 'theirs' })
    await engine.sync()
    expect(await engine.get('tasks', id(1))).toEqual(task(id(1), { title: 'theirs', done: true }))
    push = true
    await engine.sync()
    expect(server.rows.get('tasks')?.get(id(1))?.data).toEqual(task(id(1), { title: 'theirs', done: true }))
  })

  it('takes a granted scope as a snapshot, saying it is loading until it ends', async () => {
    const server = new FakeServer()
    server.create('notes', note(1))
    server.create('notes', note(2))
    const engine = await client(server, U1, { pageSize: 1 })
    await engine.sync()
    server.grant(U1, `team:${TEAM7}`)
    const loading: string[][] = []
    engine.subscribeStatus(() => loading.push(engine.status().loading))
    await engine.sync()
    expect(await engine.count('notes')).toBe(2)
    expect(engine.status().loading).toEqual([])
  })

  it('reports a granted scope as loading while its snapshot is unfinished', async () => {
    const server = new FakeServer()
    const changes: Change[] = [
      { op: 'scope_granted', scope: `team:${TEAM7}` },
      { op: 'scope_granted', scope: `team:${TEAM7}` },
    ]
    const { fetch } = recording(server, (path) =>
      path === '/sync/changes' ? json(200, { changes, cursor: 'c', has_more: false }) : undefined
    )
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    expect(engine.status().loading).toEqual([`team:${TEAM7}`])
  })

  it('drops a revoked scope, burying what was queued in it and discarding its unfinished snapshot', async () => {
    const server = new FakeServer()
    server.grant(U1, `team:${TEAM7}`)
    server.create('notes', note(1))
    server.create('notes', note(2))
    server.create('tasks', task(id(3)))
    let push = false
    const { fetch } = recording(server, (path) =>
      !push && path === '/sync/push' ? new Response(null, { status: 503 }) : undefined
    )
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    await engine.update('notes', id(1), { body: 'mine' })
    await engine.create('notes', note(4))
    server.revoke(U1, `team:${TEAM7}`)
    await engine.sync()
    expect(await engine.query('notes')).toEqual([])
    expect(await engine.count('tasks')).toBe(1)
    expect((await engine.deadLetters()).map((letter) => [letter.entry.id, letter.reason])).toEqual([
      [id(1), 'revoked'],
      [id(4), 'revoked'],
    ])

    server.grant(U1, `team:${TEAM7}`)
    const paged = await client(server, U1, { pageSize: 1 })
    await paged.sync()
    server.revoke(U1, `team:${TEAM7}`)
    server.grant(U1, `team:${TEAM7}`)
    const partial = await client(server, U1, { pageSize: 1, adapter: paged.adapter })
    paged.close()
    await partial.sync()
    expect(await partial.count('notes')).toBe(2)
    push = true
  })

  it('discards the staging of a scope revoked mid-snapshot', async () => {
    const server = new FakeServer()
    const pages: { changes: Change[]; cursor: string; has_more: boolean }[] = [
      {
        changes: [
          { op: 'snapshot_begin', scope: null, model: null },
          { op: 'snapshot_end', scope: null, model: null },
          { op: 'scope_granted', scope: `team:${TEAM7}` },
          { op: 'snapshot_begin', scope: `team:${TEAM7}`, model: null },
          { op: 'upsert', model: 'notes', id: id(1), etag: '"1"', data: note(1) },
        ],
        cursor: 'c1',
        has_more: true,
      },
      {
        changes: [
          { op: 'scope_revoked', scope: `team:${TEAM7}` },
          { op: 'snapshot_begin', scope: `team:${TEAM8}`, model: null },
          { op: 'upsert', model: 'notes', id: id(2), etag: '"2"', data: note(2, TEAM8) },
          { op: 'snapshot_end', scope: `team:${TEAM8}`, model: null },
        ],
        cursor: 'c2',
        has_more: false,
      },
    ]
    const { fetch } = recording(server, (path) => (path === '/sync/changes' ? json(200, pages.shift()) : undefined))
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    expect((await engine.query('notes')).map((row) => row.id)).toEqual([id(2)])
  })

  it('drops an unfinished snapshot when its cursor expires, and takes the full one that follows', async () => {
    const server = new FakeServer()
    const responses = [
      json(200, {
        changes: [
          { op: 'snapshot_begin', scope: `team:${TEAM7}`, model: null },
          { op: 'upsert', model: 'notes', id: id(1), etag: '"1"', data: note(1) },
        ],
        cursor: 'c1',
        has_more: true,
      }),
      json(410, { code: 'sync_cursor_expired' }),
      json(200, {
        changes: [
          { op: 'snapshot_begin', scope: null, model: null },
          { op: 'upsert', model: 'notes', id: id(2), etag: '"2"', data: note(2) },
          { op: 'snapshot_end', scope: null, model: null },
        ],
        cursor: 'c2',
        has_more: false,
      }),
    ]
    const { fetch, feed } = recording(server, (path) => (path === '/sync/changes' ? responses.shift() : undefined))
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    expect((await engine.query('notes')).map((row) => row.id)).toEqual([id(2)])
    expect(feed().map((r) => r.query.get('cursor'))).toEqual([null, 'c1', null])
  })

  it('applies a row moving out of sight, into sight, and between scopes it sees', async () => {
    const server = new FakeServer()
    server.grant(U1, `team:${TEAM7}`)
    server.create('notes', note(1))
    server.create('notes', note(2))
    server.create('notes', note(3, TEAM8))
    const engine = await client(server)
    await engine.sync()
    server.update('notes', id(1), { team: TEAM8 })
    await engine.sync()
    expect((await engine.query('notes')).map((row) => row.id)).toEqual([id(2)])
    server.grant(U1, `team:${TEAM8}`)
    await engine.sync()
    server.update('notes', id(2), { team: TEAM8 })
    await engine.sync()
    expect(await engine.get('notes', id(2))).toEqual(note(2, TEAM8))
    expect(await engine.count('notes')).toBe(3)
  })

  it('ignores changes to a model it does not sync', async () => {
    const server = new FakeServer()
    server.create('notes', note(1, `${U1}`))
    server.grant(U1, `team:${U1}`)
    server.create('tasks', task(id(2)))
    const engine = await client(server, U1, { resources: [MODELS.tasks] })
    await engine.sync()
    server.delete('notes', id(1))
    await engine.sync()
    expect(await engine.count('tasks')).toBe(1)
  })

  it('snapshots again only the table whose schema changed, keeping rows with queued writes', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    server.create('tasks', task(id(2)))
    server.create('projects', { id: id(10), owner: U1, name: 'p' })
    let push = false
    const { fetch, feed } = recording(server, (path) =>
      !push && path === '/sync/push' ? new Response(null, { status: 503 }) : undefined
    )
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    await engine.update('tasks', id(1), { done: true })
    engine.close()

    const changed = { ...MODELS, tasks: { ...MODELS.tasks, hash: 'tasks-2' } }
    const reopened = await client(server, U1, { fetch, adapter: engine.adapter, resources: Object.values(changed) })
    expect((await reopened.query('tasks')).map((row) => row.id)).toEqual([id(1)])
    expect(await reopened.count('projects')).toBe(1)
    push = true
    await reopened.sync()
    const asked = feed().map((r) => r.query.getAll('snapshot').join())
    expect(asked.filter((models) => models !== '')).toEqual(['tasks'])
    await reopened.sync()
    expect(feed()[feed().length - 1].query.getAll('snapshot')).toEqual([])
    expect((await reopened.query('tasks')).map((row) => row.done)).toEqual([true, false])
    expect(server.rows.get('tasks')?.get(id(1))?.data.done).toBe(true)
  })

  it('snapshots a table it starts syncing after its first sync, and forgets a table it stops syncing', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    server.create('projects', { id: id(10), owner: U1, name: 'p' })
    const { fetch, feed } = recording(server)
    const engine = await client(server, U1, { fetch, resources: [MODELS.tasks] })
    await engine.sync()
    engine.close()
    const more = await client(server, U1, { fetch, adapter: engine.adapter })
    await more.sync()
    expect(
      feed()
        .map((r) => r.query.getAll('snapshot').join())
        .filter(Boolean)
    ).toEqual(['projects,notes'])
    expect(await more.count('projects')).toBe(1)
    more.close()
    const fewer = await client(server, U1, { fetch, adapter: engine.adapter, resources: [MODELS.projects] })
    expect(await fewer.count('projects')).toBe(1)
    fewer.close()
    // Coming back after being forgotten, its hash is unknown again: snapshotted again.
    const back = await client(server, U1, { fetch, adapter: engine.adapter })
    await back.sync()
    expect(
      feed()
        .map((r) => r.query.getAll('snapshot').join())
        .filter(Boolean)
    ).toEqual(['projects,notes', 'tasks,notes'])
  })

  it('pauses on a feed answered 401 or 403, stops on a protocol refusal, and backs off on a 5xx', async () => {
    for (const [status, body, paused] of [
      [401, {}, 'unauthorized'],
      [403, {}, 'unauthorized'],
      [400, { code: 'sync_protocol_unsupported', supported: [2] }, 'unsupported'],
    ] as const) {
      const server = new FakeServer()
      const { fetch } = recording(server, (path) => (path === '/sync/changes' ? json(status, body) : undefined))
      const engine = await client(server, U1, { fetch })
      await engine.sync()
      expect(engine.status().paused).toBe(paused)
    }
    const server = new FakeServer()
    const { fetch } = recording(server, (path) =>
      path === '/sync/changes' ? new Response('', { status: 500 }) : undefined
    )
    const engine = await client(server, U1, { fetch })
    await engine.sync()
    expect(engine.status()).toMatchObject({ paused: null, online: true })
    expect(engine.status().error).toBeInstanceOf(Error)
    const odd = await client(server, U1, {
      fetch: recording(server, (path) => (path === '/sync/changes' ? json(400, { code: 'other' }) : undefined)).fetch,
    })
    await expect(odd.sync()).rejects.toThrow('sync: the server answered 400')
  })

  it('marks itself offline when the feed cannot be reached', async () => {
    const server = new FakeServer()
    const engine = await client(server, U1, {
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
      push: async () => ({ results: [] }),
    })
    await engine.sync()
    expect(engine.status().online).toBe(false)
  })
})
