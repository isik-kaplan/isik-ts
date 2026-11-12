import { describe, expect, it, vi } from 'vitest'

import type { PushEntry, PushResult } from '../../src/sync/protocol'
import type { PushStrategy } from '../../src/sync/push'
import { restPush } from '../../src/sync/push'
import { U1, client, id, task } from './support/harness'
import { FakeServer, MODELS } from './support/server'

// How the engine pushes its queue, and what it does with every answer.

type Override = (path: string, body: unknown) => Response | undefined | Promise<Response | undefined>

/** A fetch that reaches `server`, unless `override` answers first. Records every path and body. */
function scripted(server: FakeServer, override: Override = () => undefined) {
  const base = server.fetchAs(() => U1)
  const sent: { path: string; body: unknown }[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    sent.push({ path, body })
    return (await override(path, body)) ?? base(input, init)
  }
  const pushes = () =>
    sent.filter((s) => s.path === '/sync/push').map((s) => (s.body as { entries: PushEntry[] }).entries)
  return { fetch, sent, pushes }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Isik-Sync-Protocol': '1', ...headers } })

/** A strategy that answers with `results(entries)` and records what it was handed. */
function answering(results: (entries: PushEntry[]) => PushResult[]) {
  const handed: PushEntry[][] = []
  const strategy: PushStrategy = async (entries) => {
    handed.push(entries)
    return { results: results(entries) }
  }
  return { strategy, handed }
}

describe('pushing', () => {
  it('sends creates, updates and deletes with their keys and etags, and keeps what the server answers', async () => {
    const server = new FakeServer()
    const { fetch, pushes } = scripted(server)
    const engine = await client(server, U1, {
      fetch,
      generateKey: (() => {
        let n = 0
        return () => `key-${(n += 1)}`
      })(),
    })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    expect(pushes()[0]).toEqual([{ key: 'key-1', method: 'POST', model: 'tasks', id: id(1), body: task(id(1)) }])
    const etag = server.etagOf('tasks', id(1))
    await engine.update('tasks', id(1), { done: true })
    await engine.sync()
    expect(pushes()[1]).toEqual([
      { key: 'key-2', method: 'PATCH', model: 'tasks', id: id(1), body: { done: true }, if_match: etag },
    ])
    await engine.remove('tasks', id(1))
    await engine.sync()
    expect(pushes()[2]).toEqual([
      {
        key: 'key-3',
        method: 'DELETE',
        model: 'tasks',
        id: id(1),
        if_match: server.etagOf('tasks', id(1)) ?? pushes()[2][0].if_match,
      },
    ])
    expect(server.rows.get('tasks')?.size).toBe(0)
    expect(await engine.query('tasks')).toEqual([])
    expect(await engine.pendingCounts()).toEqual({ pending: 0, sending: 0, conflicts: 0, dead: 0 })
  })

  it('reads the server push limits once, and sends no more than the smaller of them and batchSize', async () => {
    const server = new FakeServer()
    server.push.max_entries = 3
    const { fetch, sent, pushes } = scripted(server)
    const engine = await client(server, U1, { fetch, batchSize: 2 })
    for (let n = 1; n <= 5; n += 1) await engine.create('tasks', task(id(n)))
    await engine.sync()
    expect(pushes().map((batch) => batch.length)).toEqual([2, 2, 1])
    expect(sent.filter((s) => s.path === '/sync/capabilities')).toHaveLength(1)

    const roomy = await client(new FakeServer(), U1, { fetch: scripted(server).fetch, batchSize: 10 })
    for (let n = 6; n <= 9; n += 1) await roomy.create('tasks', task(id(n)))
    const second = scripted(server)
    const capped = await client(server, U1, { fetch: second.fetch })
    for (let n = 10; n <= 14; n += 1) await capped.create('tasks', task(id(n)))
    await capped.sync()
    expect(second.pushes().map((batch) => batch.length)).toEqual([3, 2])
  })

  it('splits to the limits a 413 names, and resends', async () => {
    const server = new FakeServer()
    const { fetch, pushes } = scripted(server)
    const engine = await client(server, U1, { fetch })
    server.push.max_entries = null
    for (let n = 1; n <= 3; n += 1) await engine.create('tasks', task(id(n)))
    // The capabilities said no limit; the server has one since.
    await engine.sync()
    server.push.max_entries = 1
    for (let n = 4; n <= 6; n += 1) await engine.create('tasks', task(id(n)))
    await engine.sync()
    expect(pushes().map((batch) => batch.length)).toEqual([3, 3, 1, 1, 1])
    expect(server.rows.get('tasks')?.size).toBe(6)
  })

  it('pauses on a push answered 401 or 403, keeping the queue, until resume', async () => {
    for (const status of [401, 403]) {
      const server = new FakeServer()
      let refuse = true
      const { fetch } = scripted(server, (path) => (refuse && path === '/sync/push' ? json(status, {}) : undefined))
      const engine = await client(server, U1, { fetch })
      await engine.create('tasks', task(id(1)))
      await engine.sync()
      expect(engine.status().paused).toBe('unauthorized')
      expect(await engine.pendingCounts()).toMatchObject({ pending: 1, sending: 0 })
      await engine.sync()
      refuse = false
      engine.resume()
      expect(engine.status().paused).toBeNull()
      await engine.sync()
      expect(server.rows.get('tasks')?.size).toBe(1)
    }
  })

  it('stops for good on a protocol refusal', async () => {
    const server = new FakeServer()
    const { fetch } = scripted(server, (path) =>
      path === '/sync/push' ? json(400, { code: 'sync_protocol_unsupported', supported: [2] }) : undefined
    )
    const engine = await client(server, U1, { fetch })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    expect(engine.status().paused).toBe('unsupported')
  })

  it('backs off on a 429 or a 5xx push, honouring Retry-After', async () => {
    const server = new FakeServer()
    const { fetch } = scripted(server, (path) =>
      path === '/sync/push' ? json(429, {}, { 'Retry-After': '9' }) : undefined
    )
    const engine = await client(server, U1, { fetch })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    expect(engine.status().error).toMatchObject({ retryAfter: 9 })
    expect(await engine.pendingCounts()).toMatchObject({ pending: 1 })

    const failing = await client(server, U1, {
      fetch: scripted(server, (path) => (path === '/sync/push' ? json(503, {}) : undefined)).fetch,
      adapter: undefined,
    })
    await failing.create('tasks', task(id(2)))
    await failing.sync()
    expect(failing.status().error).toMatchObject({ retryAfter: null })
  })

  it('fails loudly on any other refusal of the push', async () => {
    const server = new FakeServer()
    const { fetch } = scripted(server, (path) => (path === '/sync/push' ? json(418, {}) : undefined))
    const engine = await client(server, U1, { fetch })
    await engine.create('tasks', task(id(1)))
    await expect(engine.sync()).rejects.toThrow('sync: the push was refused with 418')
    expect(engine.status().error).toBeInstanceOf(Error)
  })

  it('keeps the keys of a push it never heard back from, and marks itself offline', async () => {
    const server = new FakeServer()
    let cut = true
    const { fetch, pushes } = scripted(server, (path) => {
      if (cut && path === '/sync/push') throw new TypeError('fetch failed')
      return undefined
    })
    const engine = await client(server, U1, { fetch })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    expect(engine.status().online).toBe(false)
    expect(await engine.pendingCounts()).toMatchObject({ pending: 1, sending: 0 })
    cut = false
    await engine.sync()
    expect(engine.status().online).toBe(true)
    expect(pushes()[0][0].key).toBe(pushes()[1][0].key)
  })

  it('applies a 204 to an update as the write landing, the server copy kept', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    const { strategy } = answering((entries) => entries.map((e) => ({ key: e.key, status: 204 })))
    const quiet = await client(server, U1, { adapter: engine.adapter, push: strategy })
    engine.close()
    await quiet.update('tasks', id(1), { done: true })
    await quiet.sync()
    expect(await quiet.pendingEntries()).toEqual([])
    expect(await quiet.get('tasks', id(1))).toEqual(task(id(1)))
  })

  it('rebases an update nobody else touched the fields of, and sends it again under a new key', async () => {
    const server = new FakeServer()
    const { fetch, pushes } = scripted(server)
    const engine = await client(server, U1, { fetch })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    server.update('tasks', id(1), { title: 'theirs' })
    await engine.update('tasks', id(1), { done: true })
    await engine.sync()
    const [, stale, again] = pushes()
    expect(stale[0].if_match).not.toBe(again[0].if_match)
    expect(stale[0].key).not.toBe(again[0].key)
    expect(server.rows.get('tasks')?.get(id(1))?.data).toEqual(task(id(1), { title: 'theirs', done: true }))
    expect(await engine.get('tasks', id(1))).toEqual(task(id(1), { title: 'theirs', done: true }))
  })

  it('freezes a conflicting update with the server row beside it, and resolves it either way', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('tasks', task(id(1)))
    await engine.create('tasks', task(id(2)))
    await engine.sync()
    server.update('tasks', id(1), { title: 'theirs' })
    server.update('tasks', id(2), { title: 'theirs' })
    await engine.update('tasks', id(1), { title: 'mine' })
    await engine.update('tasks', id(2), { title: 'mine' })
    await engine.sync()
    const conflicts = await engine.pendingEntries({ state: 'conflict' })
    expect(conflicts).toHaveLength(2)
    expect(conflicts[0].conflict).toEqual({
      current: task(id(1), { title: 'theirs' }),
      etag: server.etagOf('tasks', id(1)),
    })
    expect(engine.status()).toMatchObject({ conflicts: 2, pending: 2 })
    // The device still shows its own side until the conflict is resolved; a later edit queues behind it.
    expect((await engine.get('tasks', id(1)))?.title).toBe('mine')
    await engine.update('tasks', id(1), { done: true })
    await engine.sync()
    expect(await engine.pendingCounts()).toMatchObject({ conflicts: 2, pending: 1 })

    await engine.takeTheirs(conflicts[0].seq)
    expect(await engine.get('tasks', id(1))).toEqual(task(id(1), { title: 'theirs' }))
    expect(await engine.pendingFor('tasks', id(1))).toEqual([])

    await engine.keepMine(conflicts[1].seq)
    const [kept] = await engine.pendingFor('tasks', id(2))
    expect(kept).toMatchObject({ state: 'pending', base: { title: 'theirs' } })
    expect(kept).not.toHaveProperty('conflict')
    expect(kept.key).not.toBe(conflicts[1].key)
    await engine.sync()
    expect(server.rows.get('tasks')?.get(id(2))?.data.title).toBe('mine')
    await expect(engine.takeTheirs(conflicts[1].seq)).rejects.toThrow(
      `sync: entry ${conflicts[1].seq} is not in conflict`
    )
    await expect(engine.keepMine(999)).rejects.toThrow('not in conflict')
  })

  it('reads a delete refused with 412 as a conflict', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    server.update('tasks', id(1), { title: 'theirs' })
    await engine.remove('tasks', id(1))
    await engine.sync()
    const [conflict] = await engine.pendingEntries({ state: 'conflict' })
    expect(conflict.method).toBe('DELETE')
    await engine.keepMine(conflict.seq)
    await engine.sync()
    expect(server.rows.get('tasks')?.size).toBe(0)
  })

  it('buries a refused write with its errors, rolls the row back, and offers it back', async () => {
    const server = new FakeServer()
    const engine = await client(server, U1, { now: () => 42 })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    await engine.update('tasks', id(1), { title: '' })
    await engine.create('tasks', { id: id(2), owner: U1, done: false, project: null } as never)
    await engine.sync()
    const dead = await engine.deadLetters()
    expect(dead.map((letter) => [letter.entry.id, letter.status, letter.reason, letter.at])).toEqual([
      [id(1), 400, 'rejected', 42],
      [id(2), 400, 'rejected', 42],
    ])
    expect(dead[0].errors).toEqual({ title: ['This field may not be blank.'] })
    expect(dead[0].entry.state).toBe('pending')
    expect(await engine.get('tasks', id(1))).toEqual(task(id(1)))
    expect(await engine.get('tasks', id(2))).toBeUndefined()
    expect(engine.status().dead).toBe(2)
    expect(await engine.exportDead()).toEqual(dead)
    expect(await engine.deadLetters({ offset: 1, limit: 1 })).toEqual([dead[1]])

    server.update('tasks', id(1), { title: 'fixed elsewhere' })
    await engine.retryDead(dead[1].entry.seq)
    expect(await engine.get('tasks', id(2))).toMatchObject({ id: id(2) })
    await engine.discardDead(dead[0].entry.seq)
    expect(await engine.deadLetters()).toEqual([])
    await expect(engine.discardDead(dead[0].entry.seq)).rejects.toThrow(
      `sync: there is no dead letter ${dead[0].entry.seq}`
    )
    await expect(engine.retryDead(12345)).rejects.toThrow('no dead letter')
  })

  it("holds a child back while its parent's create waits, sends both together, and holds it for good behind a dead parent", async () => {
    const server = new FakeServer()
    server.push.max_entries = 1
    const { fetch, pushes } = scripted(server)
    const engine = await client(server, U1, { fetch })
    await engine.create('projects', { id: id(100), owner: U1, name: 'p' })
    await engine.create('tasks', task(id(1), { project: id(100) }))
    await engine.sync()
    expect(pushes().map((batch) => batch.map((e) => e.id))).toEqual([[id(100)], [id(1)]])

    await engine.create('projects', { id: id(101), owner: U1, name: '' })
    await engine.create('tasks', task(id(2), { project: id(101) }))
    await engine.sync()
    expect(await engine.pendingFor('tasks', id(2))).toHaveLength(1)
    expect((await engine.deadLetters()).map((letter) => letter.entry.id)).toEqual([id(101)])
  })

  it('requeues a child whose parent failed in the same batch, rather than burying it', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('projects', { id: id(100), owner: U1, name: '' })
    await engine.create('tasks', task(id(1), { project: id(100) }))
    await engine.sync()
    expect((await engine.deadLetters()).map((letter) => letter.entry.id)).toEqual([id(100)])
    const [child] = await engine.pendingFor('tasks', id(1))
    expect(child.attempts).toBe(1)
  })

  it('keeps a key when its result never came back', async () => {
    const server = new FakeServer()
    const { strategy, handed } = answering(() => [])
    const engine = await client(server, U1, { push: strategy })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    await engine.sync()
    expect(handed[0][0].key).toBe(handed[1][0].key)
    expect(handed).toHaveLength(2)
  })

  it('pauses on an entry answered 401, and stops on one answered 428', async () => {
    for (const [status, reason] of [
      [401, 'unauthorized'],
      [428, 'precondition_required'],
    ] as const) {
      const { strategy } = answering((entries) => entries.map((e) => ({ key: e.key, status })))
      const engine = await client(new FakeServer(), U1, { push: strategy })
      await engine.create('tasks', task(id(1)))
      await engine.sync()
      expect(engine.status().paused).toBe(reason)
      expect(await engine.pendingCounts()).toMatchObject({ pending: 1 })
    }
  })

  it('pauses for a 428 even when another entry asked for a 401', async () => {
    const statuses = [428, 401]
    const { strategy } = answering((entries) => entries.map((e, i) => ({ key: e.key, status: statuses[i] })))
    const engine = await client(new FakeServer(), U1, { push: strategy })
    await engine.create('tasks', task(id(1)))
    await engine.create('tasks', task(id(2)))
    await engine.sync()
    expect(engine.status().paused).toBe('precondition_required')
  })

  it('retries an entry answered 5xx under a new key, after backing off', async () => {
    const server = new FakeServer()
    let fail = true
    const { strategy, handed } = answering((entries) =>
      entries.map((e) => (fail ? { key: e.key, status: 500 } : server.pushEntry(U1, e)))
    )
    const engine = await client(server, U1, { push: strategy })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    expect(engine.status().error).toBeInstanceOf(Error)
    fail = false
    await engine.sync()
    expect(handed[0][0].key).not.toBe(handed[1][0].key)
    expect(server.rows.get('tasks')?.size).toBe(1)
  })

  it('buries an entry too big to ever send', async () => {
    const server = new FakeServer()
    server.push.max_bytes = 300
    const engine = await client(server)
    await engine.create('tasks', task(id(1), { title: 'x'.repeat(400) }))
    await engine.create('tasks', task(id(2)))
    await engine.sync()
    expect((await engine.deadLetters()).map((letter) => [letter.entry.id, letter.reason, letter.status])).toEqual([
      [id(1), 'too_large', 413],
    ])
    expect(await engine.get('tasks', id(1))).toBeUndefined()
    expect(server.rows.get('tasks')?.has(id(2))).toBe(true)
  })

  it('pushes through REST, one request an entry, without reading capabilities', async () => {
    const server = new FakeServer()
    const sent: string[] = []
    const engine = await client(server, U1, {
      push: restPush,
      fetch: async (input, init) => {
        sent.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`)
        const url = new URL(String(input))
        if (!url.pathname.startsWith('/api/')) return server.fetchAs(() => U1)(input, init)
        const method = (init?.method ?? 'GET') as PushEntry['method']
        const headers = new Headers(init?.headers)
        const segments = url.pathname.split('/').filter(Boolean)
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
        const result = server.pushEntry(U1, {
          key: headers.get('Idempotency-Key') as string,
          method,
          model: segments[1],
          id: method === 'POST' ? body.id : segments[2],
          body,
          if_match: headers.get('If-Match') ?? undefined,
        })
        const payload = result.data ?? (result.current !== undefined ? { current: result.current } : result.errors)
        return new Response(payload === undefined ? null : JSON.stringify(payload), {
          status: result.status,
          headers: result.etag === undefined ? {} : { ETag: result.etag },
        })
      },
    })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    await engine.update('tasks', id(1), { done: true })
    await engine.sync()
    expect(sent.filter((line) => !line.includes('/sync/changes'))).toEqual([
      'POST /api/tasks/',
      `PATCH /api/tasks/${id(1)}/`,
    ])
    expect(server.rows.get('tasks')?.get(id(1))?.data.done).toBe(true)
  })

  it('buries an entry for a model it no longer syncs when the server does not know it', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('notes', { id: id(1), team: 'x', body: 'b' })
    engine.close()
    const fewer = await client(server, U1, { adapter: engine.adapter, resources: [MODELS.tasks] })
    const { strategy } = answering((entries) =>
      entries.map((e) => ({ key: e.key, status: 404, errors: { code: 'sync_model_unknown' } }))
    )
    const unknown = await client(server, U1, { adapter: fewer.adapter, resources: [MODELS.tasks], push: strategy })
    fewer.close()
    await unknown.sync()
    expect((await unknown.deadLetters()).map((letter) => letter.entry.model)).toEqual(['notes'])
    const { strategy: accepting } = answering((entries) => entries.map((e) => ({ key: e.key, status: 201, data: {} })))
    const again = await client(server, U1, { adapter: unknown.adapter, resources: [MODELS.tasks], push: accepting })
    unknown.close()
    await again.retryDead((await again.deadLetters())[0].entry.seq).catch(() => undefined)
    await again.sync()
    expect(await again.pendingEntries()).toEqual([])
  })

  it('keeps a written row whose answer carries no etag, and fetches with the global fetch by default', async () => {
    const server = new FakeServer()
    vi.stubGlobal(
      'fetch',
      server.fetchAs(() => U1)
    )
    const { strategy } = answering((entries) =>
      entries.map((e) => {
        const { etag, ...result } = server.pushEntry(U1, e)
        expect(etag).toBeDefined()
        return result
      })
    )
    const engine = await client(server, U1, { push: strategy, fetch: undefined })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    vi.unstubAllGlobals()
    expect(await engine.get('tasks', id(1))).toEqual(task(id(1)))
    expect(await engine.pendingEntries()).toEqual([])
  })

  it('buries a too-big entry of a model it no longer syncs', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('notes', { id: id(1), team: 'x', body: 'b'.repeat(500) })
    engine.close()
    server.push.max_bytes = 300
    const fewer = await client(server, U1, { adapter: engine.adapter, resources: [MODELS.tasks] })
    await fewer.sync()
    expect((await fewer.deadLetters()).map((letter) => letter.reason)).toEqual(['too_large'])
  })

  it('reads the capabilities refusal like any other', async () => {
    const server = new FakeServer()
    const { fetch } = scripted(server, (path) => (path === '/sync/capabilities' ? json(401, {}) : undefined))
    const engine = await client(server, U1, { fetch })
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    expect(engine.status().paused).toBe('unauthorized')
    expect(vi.isMockFunction(fetch)).toBe(false)
  })
})
