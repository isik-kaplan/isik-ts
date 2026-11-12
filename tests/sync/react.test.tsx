import { act, renderHook, waitFor } from '@testing-library/react'

import { describe, expect, it } from 'vitest'

import type { SyncEngine } from '../../src/sync/engine'
import type { Row } from '../../src/sync/protocol'
import { useLiveQuery, usePendingWrites, useSyncStatus, useSyncedWrite } from '../../src/sync/react'
import { U1, client, id, task } from './support/harness'
import { FakeServer } from './support/server'

type Engine = SyncEngine<Record<string, Row>>

async function engineFor(server = new FakeServer()) {
  return (await client(server)) as unknown as Engine & Awaited<ReturnType<typeof client>>
}

describe('useLiveQuery', () => {
  it('reads, and reads again when the local store changes', async () => {
    const engine = await engineFor()
    const { result } = renderHook(() => useLiveQuery(engine, (e) => e.query('tasks'), []))
    expect(result.current).toEqual({ data: undefined, error: undefined, loading: true })
    await waitFor(() => expect(result.current).toEqual({ data: [], error: undefined, loading: false }))
    await act(() => engine.create('tasks', task(id(1))))
    await waitFor(() => expect(result.current.data).toEqual([task(id(1))]))
  })

  it('reruns only for the models it watches', async () => {
    const engine = await engineFor()
    let reads = 0
    const { result } = renderHook(() =>
      useLiveQuery(
        engine,
        async (e) => {
          reads += 1
          return e.count('tasks')
        },
        [],
        { models: ['tasks'] }
      )
    )
    await waitFor(() => expect(result.current.data).toBe(0))
    await act(() => engine.create('projects', { id: id(9), owner: U1, name: 'p' }))
    await act(() => engine.create('tasks', task(id(1))))
    await waitFor(() => expect(result.current.data).toBe(1))
    expect(reads).toBe(2)
  })

  it('reads again when its deps change, and keeps the last data beside an error', async () => {
    const engine = await engineFor()
    await engine.create('tasks', task(id(1)))
    const { result, rerender } = renderHook(
      ({ which }) =>
        useLiveQuery(
          engine,
          (e): Promise<unknown> => (which === 'bad' ? e.query('tasks', { index: ['nope'] }) : e.get('tasks', id(1))),
          [which]
        ),
      {
        initialProps: { which: 'good' },
      }
    )
    await waitFor(() => expect(result.current.data).toEqual(task(id(1))))
    rerender({ which: 'bad' })
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    expect(result.current).toMatchObject({ data: task(id(1)), loading: false })
  })

  it('drops a stale answer, and any answer once unmounted', async () => {
    const engine = await engineFor()
    const answers: ((value: number) => void)[] = []
    const failures: ((error: Error) => void)[] = []
    const { result, rerender, unmount } = renderHook(
      ({ dep }) =>
        useLiveQuery(
          engine,
          () =>
            new Promise<number>((resolve, reject) => {
              answers.push(resolve)
              failures.push(reject)
            }),
          [dep]
        ),
      { initialProps: { dep: 1 } }
    )
    rerender({ dep: 2 })
    await act(async () => answers[1](2))
    await act(async () => answers[0](1))
    expect(result.current.data).toBe(2)
    await act(() => engine.create('tasks', task(id(1))))
    await waitFor(() => expect(answers).toHaveLength(3))
    unmount()
    await act(async () => {
      answers[2](3)
      failures[2](new Error('late'))
    })
    expect(result.current.data).toBe(2)
    const { result: failing, rerender: refail } = renderHook(
      ({ dep }) =>
        useLiveQuery(
          engine,
          () =>
            new Promise<number>((_resolve, reject) => {
              failures.push(reject)
            }),
          [dep]
        ),
      { initialProps: { dep: 1 } }
    )
    refail({ dep: 2 })
    await act(async () => failures[failures.length - 2](new Error('stale')))
    expect(failing.current.error).toBeUndefined()
  })
})

describe('useSyncedWrite', () => {
  it("is the engine's writes, the same across renders", async () => {
    const engine = await engineFor()
    const { result, rerender } = renderHook(() => useSyncedWrite(engine))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    await act(() => result.current.create('tasks', task(id(1))))
    expect(await engine.get('tasks', id(1))).toEqual(task(id(1)))
  })
})

describe('usePendingWrites', () => {
  it('pages the queue, the conflicts and the dead letters, reloading as the outbox changes', async () => {
    const server = new FakeServer()
    const engine = await engineFor(server)
    await engine.create('tasks', task(id(1)))
    await engine.create('tasks', task(id(2)))
    await engine.sync()
    server.update('tasks', id(1), { title: 'theirs' })
    await engine.update('tasks', id(1), { title: 'mine' })
    await engine.update('tasks', id(2), { title: '' })
    await engine.sync()
    await engine.create('tasks', task(id(3)))

    const { result } = renderHook(() => usePendingWrites(engine, { limit: 1 }))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.counts).toEqual({ pending: 1, sending: 0, conflicts: 1, dead: 1 })
    expect(result.current.entries.map((e) => e.id)).toEqual([id(1)])
    expect(result.current.conflicts.map((e) => e.id)).toEqual([id(1)])
    expect(result.current.dead.map((d) => d.entry.id)).toEqual([id(2)])

    await act(() => result.current.takeTheirs(result.current.conflicts[0].seq))
    await waitFor(() => expect(result.current.counts.conflicts).toBe(0))
    await act(() => result.current.discardDead(result.current.dead[0].entry.seq))
    await waitFor(() => expect(result.current.counts.dead).toBe(0))
    expect(await result.current.exportDead()).toEqual([])
    expect(result.current.keepMine).toBe(engine.keepMine)
    expect(result.current.retryDead).toBe(engine.retryDead)
  })

  it('ignores changes that leave the outbox alone, and loads that finish after unmounting', async () => {
    const server = new FakeServer()
    server.create('tasks', task(id(1)))
    const engine = await engineFor(server)
    const { result, unmount } = renderHook(() => usePendingWrites(engine))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = result.current
    await act(() => engine.sync())
    expect(result.current).toBe(before)
    const pending = engine.create('tasks', task(id(2)))
    unmount()
    await pending
  })

  it('drops a load that a later one overtook', async () => {
    const engine = await engineFor()
    const { result } = renderHook(() => usePendingWrites(engine))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => Promise.all([engine.create('tasks', task(id(1))), engine.create('tasks', task(id(2)))]))
    await waitFor(() => expect(result.current.counts.pending).toBe(2))
  })

  it('swallows a load that fails', async () => {
    const engine = await engineFor()
    engine.close()
    const { result } = renderHook(() => usePendingWrites(engine))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(result.current.loading).toBe(true)
  })
})

describe('useSyncStatus', () => {
  it('re-renders with the status', async () => {
    const server = new FakeServer()
    const engine = await engineFor(server)
    const { result } = renderHook(() => useSyncStatus(engine))
    expect(result.current.lastSyncedAt).toBeNull()
    await act(() => engine.sync())
    expect(result.current.lastSyncedAt).not.toBeNull()
  })
})

describe('the hooks, at their edges', () => {
  it('reruns for a change that touches a watched model among others', async () => {
    const server = new FakeServer()
    server.grant(U1, 'team:x')
    const engine = await engineFor(server)
    let reads = 0
    const { result } = renderHook(() =>
      useLiveQuery(
        engine,
        async (e) => {
          reads += 1
          return e.count('tasks')
        },
        [],
        { models: ['tasks', 'projects'] }
      )
    )
    await waitFor(() => expect(result.current.data).toBe(0))
    server.create('tasks', task(id(1)))
    server.create('notes', { id: id(2), team: 'x', body: 'b' })
    await act(() => engine.sync())
    await waitFor(() => expect(result.current.data).toBe(1))
    expect(reads).toBe(2)
  })

  it('keeps the latest read when an earlier one of the same effect answers last', async () => {
    const engine = await engineFor()
    const answers: ((value: number) => void)[] = []
    const failures: ((error: Error) => void)[] = []
    const { result } = renderHook(() =>
      useLiveQuery(
        engine,
        () =>
          new Promise<number>((resolve, reject) => {
            answers.push(resolve)
            failures.push(reject)
          }),
        []
      )
    )
    await act(() => engine.create('tasks', task(id(1))))
    await waitFor(() => expect(answers).toHaveLength(2))
    await act(async () => answers[1](2))
    await act(async () => {
      answers[0](1)
      failures[0](new Error('stale'))
    })
    expect(result.current).toEqual({ data: 2, error: undefined, loading: false })
  })

  it('gives new writes for a new engine', async () => {
    const one = await engineFor()
    const two = await engineFor()
    const { result, rerender } = renderHook(({ engine }) => useSyncedWrite(engine), { initialProps: { engine: one } })
    const first = result.current
    rerender({ engine: two })
    expect(result.current).not.toBe(first)
    expect(result.current.create).toBe(two.create)
  })

  it('starts at zero counts, pages dead letters too, and reloads when the page changes', async () => {
    const engine = await engineFor()
    await engine.create('tasks', { id: id(1), owner: U1 } as never)
    await engine.create('tasks', { id: id(2), owner: U1 } as never)
    await engine.sync()
    const { result, rerender } = renderHook(({ offset }) => usePendingWrites(engine, { offset, limit: 1 }), {
      initialProps: { offset: 0 },
    })
    expect(result.current.counts).toEqual({ pending: 0, sending: 0, conflicts: 0, dead: 0 })
    await waitFor(() => expect(result.current.dead.map((d) => d.entry.id)).toEqual([id(1)]))
    rerender({ offset: 1 })
    await waitFor(() => expect(result.current.dead.map((d) => d.entry.id)).toEqual([id(2)]))
  })

  it("drops a page's load that a newer one overtook, and one finishing after cleanup", async () => {
    const real = await engineFor()
    const counts: ((value: Awaited<ReturnType<Engine['pendingCounts']>>) => void)[] = []
    const engine = {
      ...real,
      pendingCounts: () => new Promise<Awaited<ReturnType<Engine['pendingCounts']>>>((resolve) => counts.push(resolve)),
    } as Engine
    const zero = { pending: 0, sending: 0, conflicts: 0, dead: 0 }
    const { result, rerender, unmount } = renderHook(({ limit }) => usePendingWrites(engine, { limit }), {
      initialProps: { limit: 1 },
    })
    rerender({ limit: 2 })
    await waitFor(() => expect(counts).toHaveLength(2))
    await act(async () => counts[1]({ ...zero, pending: 2 }))
    await waitFor(() => expect(result.current.counts.pending).toBe(2))
    await act(async () => counts[0]({ ...zero, pending: 1 }))
    expect(result.current.counts.pending).toBe(2)
    await act(() => real.create('tasks', task(id(1))))
    await waitFor(() => expect(counts).toHaveLength(3))
    unmount()
    await act(async () => counts[2]({ ...zero, pending: 9 }))
    expect(result.current.counts.pending).toBe(2)
  })

  it('ignores a read that answers after cleanup', async () => {
    const engine = await engineFor()
    const answers: ((value: number) => void)[] = []
    const { result, unmount } = renderHook(() =>
      useLiveQuery(engine, () => new Promise<number>((resolve) => answers.push(resolve)), [])
    )
    unmount()
    await act(async () => answers[0](1))
    expect(result.current.data).toBeUndefined()
  })
})
