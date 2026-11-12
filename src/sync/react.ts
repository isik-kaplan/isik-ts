import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { PageQuery, PendingCounts, SyncEngine, SyncEvent, SyncStatus } from './engine'
import type { DeadLetter, Entry } from './outbox'
import type { Row } from './protocol'

// The engine reaches components through these. Each takes the engine as its first argument: there is
// no provider, so where the engine lives - module scope, a context of the app's own - is the app's call.

type AnyEngine = SyncEngine<Record<string, Row>>

export interface LiveQuery<R> {
  data: R | undefined
  error: unknown
  loading: boolean
}

/**
 * Runs `read` against the local store, and again whenever a model it names changes - from this tab, from
 * another, or from a pull. `models` limits which changes rerun it; by default, any.
 *
 *     const { data: tasks } = useLiveQuery(engine, (e) => e.query('tasks', { index: ['project'], equals: [id] }), [id])
 */
export function useLiveQuery<E extends AnyEngine, R>(
  engine: E,
  read: (engine: E) => Promise<R>,
  deps: readonly unknown[],
  options: { models?: readonly string[] } = {}
): LiveQuery<R> {
  const [state, setState] = useState<LiveQuery<R>>({ data: undefined, error: undefined, loading: true })
  const readRef = useRef(read)
  readRef.current = read
  const models = options.models?.join('\u0001')

  useEffect(() => {
    // Only the latest read of a live effect may land: an older one, or one after cleanup, is stale.
    let latest: object | null = null
    const run = () => {
      const mine = {}
      latest = mine
      readRef.current(engine).then(
        (data) => {
          if (mine === latest) setState({ data, error: undefined, loading: false })
        },
        (error: unknown) => {
          if (mine === latest) setState((previous) => ({ data: previous.data, error, loading: false }))
        }
      )
    }
    run()
    const watched = models === undefined ? undefined : new Set(models.split('\u0001'))
    const unsubscribe = engine.subscribe((event: SyncEvent) => {
      if (watched === undefined || event.models.some((model) => watched.has(model))) run()
    })
    return () => {
      latest = null
      unsubscribe()
    }
  }, [engine, models, ...deps])

  return state
}

/** The engine's writes, stable across renders. Each writes locally at once and queues for the server. */
export function useSyncedWrite<E extends AnyEngine>(engine: E): Pick<E, 'create' | 'update' | 'remove'> {
  return useMemo(() => ({ create: engine.create, update: engine.update, remove: engine.remove }), [engine])
}

export interface PendingWrites {
  counts: PendingCounts
  /** One page of queued writes, in queue order. */
  entries: Entry[]
  /** One page of conflicts. */
  conflicts: Entry[]
  /** One page of dead letters. */
  dead: DeadLetter[]
  loading: boolean
  takeTheirs(seq: number): Promise<void>
  keepMine(seq: number): Promise<void>
  retryDead(seq: number): Promise<void>
  discardDead(seq: number): Promise<void>
  /** Every dead letter at once, to save before discarding. */
  exportDead(): Promise<DeadLetter[]>
}

const NO_COUNTS: PendingCounts = { pending: 0, sending: 0, conflicts: 0, dead: 0 }

/**
 * What has not reached the server: counts, and a page each of queued writes, conflicts and dead letters
 * - never all of them at once - with the actions that resolve them.
 */
export function usePendingWrites(engine: AnyEngine, page: PageQuery = {}): PendingWrites {
  const { offset, limit } = page
  const [state, setState] = useState({
    counts: NO_COUNTS,
    entries: [] as Entry[],
    conflicts: [] as Entry[],
    dead: [] as DeadLetter[],
    loading: true,
  })

  useEffect(() => {
    let latest: object | null = null
    const load = () => {
      const mine = {}
      latest = mine
      Promise.all([
        engine.pendingCounts(),
        engine.pendingEntries({ offset, limit }),
        engine.pendingEntries({ state: 'conflict', offset, limit }),
        engine.deadLetters({ offset, limit }),
      ]).then(
        ([counts, entries, conflicts, dead]) => {
          if (mine === latest) setState({ counts, entries, conflicts, dead, loading: false })
        },
        () => undefined
      )
    }
    load()
    const unsubscribe = engine.subscribe((event) => {
      if (event.outbox) load()
    })
    return () => {
      latest = null
      unsubscribe()
    }
  }, [engine, offset, limit])

  return {
    ...state,
    takeTheirs: engine.takeTheirs,
    keepMine: engine.keepMine,
    retryDead: engine.retryDead,
    discardDead: engine.discardDead,
    exportDead: engine.exportDead,
  }
}

/** The engine's status - online, syncing, paused, the counts - re-rendering when it changes. */
export function useSyncStatus(engine: AnyEngine): SyncStatus {
  return useSyncExternalStore(engine.subscribeStatus, engine.status, engine.status)
}
