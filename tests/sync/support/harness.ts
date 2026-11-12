import { openSyncEngine } from '../../../src/sync/engine'
import type { SyncEngineOptions } from '../../../src/sync/engine'
import { createMemoryAdapter } from '../../../src/sync/memory'
import type { StoreAdapter } from '../../../src/sync/store'
import { FakeServer, MODELS } from './server'

export const U1 = '0190a000-0000-7000-8000-a00000000001'
export const U2 = '0190a000-0000-7000-8000-a00000000002'
export const TEAM7 = '0190a000-0000-7000-8000-b00000000007'

export type Task = { id: string; owner: string; title: string; done: boolean; project: string | null }
export type Project = { id: string; owner: string; name: string }
export type Note = { id: string; team: string; body: string }
export type Tables = { tasks: Task; projects: Project; notes: Note }

export interface ClientOptions extends Partial<SyncEngineOptions> {
  as?: () => string | null
}

/** An engine against `server` as `user`, on its own memory store unless given one. */
export async function client(server: FakeServer, user: string = U1, options: ClientOptions = {}) {
  const adapter: StoreAdapter = options.adapter ?? createMemoryAdapter()
  // An explicit `fetch: undefined` leaves the engine its default, the global fetch.
  const fetch = 'fetch' in options ? options.fetch : server.fetchAs(options.as ?? (() => user))
  const engine = await openSyncEngine<Tables>({
    resources: Object.values(MODELS),
    baseUrl: 'http://api.test/',
    locks: null,
    broadcast: false,
    interval: 0,
    debounce: 0,
    ...options,
    adapter,
    user,
    fetch,
  })
  return Object.assign(engine, { adapter })
}

export function task(id: string, fields: Partial<Task> = {}): Task {
  return { id, owner: U1, title: `task ${id.slice(-2)}`, done: false, project: null, ...fields }
}

export const id = (n: number) => `0190b000-0000-7000-8000-${String(n).padStart(12, '0')}`
