import { describe, expect, it, vi } from 'vitest'

import { RowExistsError, RowNotFoundError, openSyncEngine } from '../../src/sync/engine'
import { createMemoryAdapter } from '../../src/sync/memory'
import { U1, client, id, task } from './support/harness'
import { FakeServer, MODELS, openAPIDocument } from './support/server'

// What the engine does on the device alone: opening, reading, and writing into the queue.

describe('opening', () => {
  it('reads its resources from an OpenAPI document', async () => {
    const engine = await openSyncEngine({
      adapter: createMemoryAdapter(),
      user: U1,
      document: openAPIDocument(),
      baseUrl: 'http://api.test',
      broadcast: false,
    })
    expect([...engine.resources.keys()].sort()).toEqual(['notes', 'projects', 'tasks'])
  })

  it('refuses a model it does not sync', async () => {
    const engine = await client(new FakeServer())
    await expect(engine.get('nope' as 'tasks', 'x')).rejects.toThrow('sync: nope is not a synced resource')
    await expect(engine.create('nope' as 'tasks', {})).rejects.toThrow('not a synced resource')
    await expect(engine.update('nope' as 'tasks', 'x', {})).rejects.toThrow('not a synced resource')
    await expect(engine.remove('nope' as 'tasks', 'x')).rejects.toThrow('not a synced resource')
    await expect(engine.query('nope' as 'tasks')).rejects.toThrow('not a synced resource')
  })

  it('keeps one database per user', async () => {
    const server = new FakeServer()
    const adapter = createMemoryAdapter()
    const one = await client(server, U1, { adapter })
    await one.create('tasks', task(id(1)))
    const other = await client(server, 'someone-else', { adapter })
    expect(await other.query('tasks')).toEqual([])
    expect(await one.query('tasks')).toHaveLength(1)
  })
})

describe('reading', () => {
  async function seeded() {
    const engine = await client(new FakeServer())
    await engine.create('tasks', task(id(3), { title: 'c', done: true }))
    await engine.create('tasks', task(id(1), { title: 'a' }))
    await engine.create('tasks', task(id(2), { title: 'b', done: true }))
    await engine.create('tasks', task(id(4), { title: 'b' }))
    return engine
  }
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id)

  it('gets a row, or undefined', async () => {
    const engine = await seeded()
    expect(await engine.get('tasks', id(1))).toEqual(task(id(1), { title: 'a' }))
    expect(await engine.get('tasks', id(9))).toBeUndefined()
  })

  it('lists rows by id, paged and reversed', async () => {
    const engine = await seeded()
    expect(ids(await engine.query('tasks'))).toEqual([id(1), id(2), id(3), id(4)])
    expect(ids(await engine.query('tasks', { offset: 1, limit: 2 }))).toEqual([id(2), id(3)])
    expect(ids(await engine.query('tasks', { reverse: true, limit: 1 }))).toEqual([id(4)])
    expect(await engine.count('tasks')).toBe(4)
  })

  it('ranges over an x-sync index by prefix and by bounds', async () => {
    const engine = await seeded()
    const byDone = { index: ['done', 'title'] }
    expect(ids(await engine.query('tasks', byDone))).toEqual([id(1), id(4), id(2), id(3)])
    expect(ids(await engine.query('tasks', { ...byDone, equals: [true] }))).toEqual([id(2), id(3)])
    expect(ids(await engine.query('tasks', { ...byDone, equals: [false, 'b'] }))).toEqual([id(4)])
    expect(await engine.count('tasks', { ...byDone, equals: [true] })).toBe(2)
    expect(ids(await engine.query('tasks', { ...byDone, lower: [false, 'b'] }))).toEqual([id(4), id(2), id(3)])
    expect(ids(await engine.query('tasks', { ...byDone, lower: [false], lowerOpen: true }))).toEqual([id(2), id(3)])
    expect(ids(await engine.query('tasks', { ...byDone, upper: [false] }))).toEqual([id(1), id(4)])
    expect(ids(await engine.query('tasks', { ...byDone, upper: [true], upperOpen: true }))).toEqual([id(1), id(4)])
    expect(ids(await engine.query('tasks', { ...byDone, upper: [false, 'b'], upperOpen: true }))).toEqual([id(1)])
    expect(ids(await engine.query('tasks', { ...byDone, lower: [false, 'b'], upper: [true, 'b'] }))).toEqual([
      id(4),
      id(2),
    ])
    expect(ids(await engine.query('tasks', { ...byDone, reverse: true, limit: 1 }))).toEqual([id(3)])
  })

  it('refuses an index x-sync does not declare', async () => {
    const engine = await seeded()
    await expect(engine.query('tasks', { index: ['title'] })).rejects.toThrow('sync: tasks has no index on title')
    await expect(engine.count('tasks', { index: ['done'] })).rejects.toThrow('no index on done')
  })

  it('leaves a locally deleted row out of every query', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    await engine.remove('tasks', id(1))
    expect(await engine.get('tasks', id(1))).toBeUndefined()
    expect(await engine.query('tasks')).toEqual([])
    expect(await engine.query('tasks', { index: ['owner'] })).toEqual([])
    expect(await engine.pendingCounts()).toMatchObject({ pending: 1 })
  })
})

describe('writing', () => {
  it('creates with a uuid7 id when none is given, and refuses one that exists', async () => {
    const engine = await client(new FakeServer(), U1, { now: () => 0x0190a0000001 })
    const made = await engine.create('tasks', { owner: U1, title: 'x' })
    expect(made.id).toMatch(/^0190a000-0001-7/)
    await expect(engine.create('tasks', { id: made.id, title: 'again' })).rejects.toBeInstanceOf(RowExistsError)
    await expect(engine.create('tasks', { id: made.id })).rejects.toThrow(`sync: tasks ${made.id} already exists`)
  })

  it('takes generateId', async () => {
    const engine = await client(new FakeServer(), U1, { generateId: () => 'given' })
    expect((await engine.create('tasks', { title: 'x' })).id).toBe('given')
  })

  it('refuses to update or remove a row that is not there', async () => {
    const engine = await client(new FakeServer())
    await expect(engine.update('tasks', id(1), { done: true })).rejects.toBeInstanceOf(RowNotFoundError)
    await expect(engine.remove('tasks', id(1))).rejects.toThrow(`sync: there is no tasks ${id(1)} to change`)
  })

  it('folds updates into a queued create, the key aside', async () => {
    const engine = await client(new FakeServer())
    await engine.create('tasks', task(id(1)))
    const updated = await engine.update('tasks', id(1), { id: 'ignored', done: true })
    expect(updated).toEqual(task(id(1), { done: true }))
    const [entry] = await engine.pendingEntries()
    expect(entry).toMatchObject({ method: 'POST', body: task(id(1), { done: true }), base: {} })
    expect(await engine.pendingEntries()).toHaveLength(1)
  })

  it('folds updates into one queued update, each field keeping its first base', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('tasks', task(id(1), { title: 'first' }))
    await engine.sync()
    await engine.update('tasks', id(1), { title: 'second' })
    await engine.update('tasks', id(1), { title: 'third', done: true })
    const entries = await engine.pendingEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      method: 'PATCH',
      body: { title: 'third', done: true },
      base: { title: 'first', done: false },
    })
    expect(await engine.pendingFor('tasks', id(1))).toEqual(entries)
  })

  it('cancels a queued create with a delete, leaving nothing', async () => {
    const engine = await client(new FakeServer())
    await engine.create('tasks', task(id(1)))
    await engine.update('tasks', id(1), { done: true })
    await engine.remove('tasks', id(1))
    expect(await engine.pendingEntries()).toEqual([])
    expect(await engine.get('tasks', id(1))).toBeUndefined()
    await engine.create('tasks', task(id(1)))
  })

  it('turns a queued update into a delete', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('tasks', task(id(1)))
    await engine.sync()
    await engine.update('tasks', id(1), { done: true })
    await engine.remove('tasks', id(1))
    const entries = await engine.pendingEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].method).toBe('DELETE')
    expect(entries[0]).not.toHaveProperty('body')
    await expect(engine.update('tasks', id(1), { done: false })).rejects.toBeInstanceOf(RowNotFoundError)
  })

  it('queues a write of its own behind one already sending', async () => {
    const server = new FakeServer()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const base = server.fetchAs(() => U1)
    let gated = false
    const engine = await client(server, U1, {
      fetch: async (input, init) => {
        if (gated && String(input).endsWith('/sync/push')) await gate
        return base(input, init)
      },
    })
    await engine.create('tasks', task(id(1)))
    await engine.create('tasks', task(id(2)))
    await engine.sync()
    gated = true
    await engine.update('tasks', id(1), { done: true })
    await engine.update('tasks', id(2), { done: true })
    const syncing = engine.sync()
    await vi.waitFor(async () => expect((await engine.pendingCounts()).sending).toBe(2))
    await engine.update('tasks', id(1), { title: 'later' })
    await engine.remove('tasks', id(2))
    const entries = await engine.pendingEntries()
    expect(entries.map((e) => [e.id, e.method, e.state])).toEqual([
      [id(1), 'PATCH', 'sending'],
      [id(2), 'PATCH', 'sending'],
      [id(1), 'PATCH', 'pending'],
      [id(2), 'DELETE', 'pending'],
    ])
    expect(entries[2].base).toEqual({ title: 'task 01' })
    release()
    await syncing
    await engine.sync()
    expect(await engine.pendingEntries()).toEqual([])
    expect(server.rows.get('tasks')?.get(id(1))?.data).toEqual(task(id(1), { done: true, title: 'later' }))
    expect(server.rows.get('tasks')?.has(id(2))).toBe(false)
  })

  it('announces what each write touched', async () => {
    const engine = await client(new FakeServer())
    const events: unknown[] = []
    const unsubscribe = engine.subscribe((event) => events.push(event))
    await engine.create('tasks', task(id(1)))
    unsubscribe()
    await engine.create('tasks', task(id(2)))
    expect(events).toEqual([{ models: ['tasks'], outbox: true }])
  })

  it('says how many writes wait, in its status', async () => {
    const engine = await client(new FakeServer())
    const seen: number[] = []
    const unsubscribe = engine.subscribeStatus(() => seen.push(engine.status().pending))
    await engine.create('tasks', task(id(1)))
    await vi.waitFor(() => expect(engine.status().pending).toBe(1))
    unsubscribe()
    expect(seen).toContain(1)
    expect(MODELS.tasks.model).toBe('tasks')
  })
})
