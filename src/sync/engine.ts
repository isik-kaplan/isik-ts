import { retryAfterOf } from '../http'
import { AFTER_PREFIX, encodeKey } from './keys'
import type { DeadLetter, DeadReason, Entry, ServerCopy } from './outbox'
import { materialize, outcomeOf, referencesOf, rowKeyOf, selectBatch } from './outbox'
import type { Capabilities, Change, ChangesPage, PushEntry, PushResult, PushTooLarge, Row, XSync } from './protocol'
import { PROTOCOL_HEADER, PROTOCOL_VERSION, resourcesOf, scopeOf } from './protocol'
import type { PushStrategy } from './push'
import { batchPush } from './push'
import type { IndexValues, Store, StoreAdapter, StoreTx, TableDef } from './store'
import { createMutex } from './store'
import { uuid7 } from './uuid'

// ------------------------------------------------------------------------------------------ storage

// Stryker disable next-line StringLiteral: a table's name is only its label
const META = 'meta'
// Stryker disable next-line StringLiteral: a table's name is only its label
const OUTBOX = 'outbox'
// Stryker disable next-line StringLiteral: a table's name is only its label
const DEAD = 'dead'
// Stryker disable next-line StringLiteral: a table's name is only its label
const STAGING = 'staging'
const tableOf = (model: string) => `r:${model}`

interface Snapshot {
  scope: string | null
  model: string | null
}

/** The engine's own state, kept as one record. */
interface State {
  cursor: string | null
  /** The ETag of the last answer to `cursor`, for a 304 when nothing changed. */
  feed: { cursor: string | null; etag: string } | null
  open: Snapshot[]
  /** Models whose table must be snapshotted again, after their schema changed. */
  resnapshot: string[]
  hashes: Record<string, string>
  loading: string[]
  seq: number
}

interface RowRecord {
  server: ServerCopy | null
  local: Row | null
}

const seqKey = (seq: number) => String(seq).padStart(15, '0')
const snapshotId = (snapshot: Snapshot) => JSON.stringify([snapshot.scope, snapshot.model])
const stagingKey = (id: string, model: string, row: string) => JSON.stringify([id, model, row])

function initialState(): State {
  return {
    cursor: null,
    feed: null,
    // Stryker disable next-line ArrayDeclaration: nothing reads an open snapshot that no snapshot_begin named
    open: [],
    resnapshot: [],
    hashes: {},
    loading: [],
    seq: 0,
  }
}

// ------------------------------------------------------------------------------------------ public types

export class RowNotFoundError extends Error {
  constructor(model: string, id: string) {
    super(`sync: there is no ${model} ${id} to change`)
    this.name = 'RowNotFoundError'
  }
}

export class RowExistsError extends Error {
  constructor(model: string, id: string) {
    super(`sync: ${model} ${id} already exists`)
    this.name = 'RowExistsError'
  }
}

export class PendingWritesError extends Error {
  readonly pending: number
  constructor(pending: number) {
    super(`sync: ${pending} write(s) have not reached the server; wiping now loses them`)
    this.name = 'PendingWritesError'
    this.pending = pending
  }
}

export type PausedReason = 'unauthorized' | 'unsupported' | 'precondition_required'

export interface SyncStatus {
  /** Whether the last request reached the server. */
  online: boolean
  syncing: boolean
  /** Why syncing has stopped until `resume()`, if it has. */
  paused: PausedReason | null
  lastSyncedAt: number | null
  /** Writes not yet settled, conflicts included. */
  pending: number
  conflicts: number
  dead: number
  /** Scopes granted whose snapshot has not finished arriving. */
  loading: string[]
  error: unknown
}

/** A query over a model's local rows: by primary key, or by one of its `x-sync` indexes. */
export interface LocalQuery {
  /** The fields of one `indexed` entry, in its order. */
  index?: readonly string[]
  /** A prefix of the index's fields: only rows whose leading fields equal these. */
  equals?: readonly unknown[]
  lower?: readonly unknown[]
  upper?: readonly unknown[]
  lowerOpen?: boolean
  upperOpen?: boolean
  offset?: number
  limit?: number
  reverse?: boolean
}

export interface PageQuery {
  offset?: number
  limit?: number
}

export interface PendingCounts {
  pending: number
  sending: number
  conflicts: number
  dead: number
}

export interface SyncEvent {
  models: string[]
  outbox: boolean
}

export interface SyncEngineOptions {
  adapter: StoreAdapter
  /** Whose rows these are. Each user has a database of their own. */
  user: string
  /** The OpenAPI document whose `x-sync` extensions name the resources. Or `resources`. */
  document?: unknown
  resources?: readonly XSync[]
  /** Where `/sync/...` and the resources' paths are resolved: the API's origin and prefix. */
  baseUrl: string
  /** Default: the global fetch, looked up at call time. */
  fetch?: typeof fetch
  /** How the outbox reaches the server. Default `batchPush`. */
  push?: PushStrategy
  /** The most entries one push carries; the server's own limit caps it too. Default: no limit of the client's. */
  batchSize?: number
  /** The feed's `limit`. Default: the server's. */
  pageSize?: number
  /** How long after a local write a sync starts, in ms. Default 500. */
  debounce?: number
  /** How often to sync while in the foreground, in ms. Default 30000; 0 never. */
  interval?: number
  /** The first and the longest wait after a failure, in ms. Default 1000 and 300000. */
  backoff?: { base?: number; max?: number }
  /**
   * Subscribes to the app coming to the foreground, returning an unsubscribe - React Native's
   * `AppState`, say. In a browser, `visibilitychange` and `online` are used without it.
   */
  foreground?: (onForeground: () => void) => () => void
  /** Default: `navigator.locks`, when there is one. `null` keeps the lock to this page. */
  locks?: LockManager | null
  /** Tell other tabs of changes. Default: when `BroadcastChannel` exists. */
  broadcast?: boolean
  generateId?: () => string
  generateKey?: () => string
  now?: () => number
}

// ------------------------------------------------------------------------------------------ helpers

class Fatal extends Error {}

class Offline extends Error {
  readonly retryAfter: number | null
  constructor(cause: unknown, retryAfter: number | null = null) {
    super('sync: the server could not be reached', { cause })
    this.retryAfter = retryAfter
  }
}

class Paused extends Error {
  readonly reason: PausedReason
  constructor(reason: PausedReason) {
    super(`sync: paused (${reason})`)
    this.reason = reason
  }
}

/** The bounds of a local query, as an adapter range. */
function boundsOf(query: LocalQuery) {
  if (query.equals !== undefined) {
    const prefix = encodeKey(query.equals)
    return { lower: prefix, upper: prefix + AFTER_PREFIX }
  }
  const bounds: { lower?: string; upper?: string; lowerOpen?: boolean; upperOpen?: boolean } = {}
  if (query.lower !== undefined) {
    const lower = encodeKey(query.lower)
    // An open lower bound is above every key extending it, too.
    bounds.lower = query.lowerOpen ? lower + AFTER_PREFIX : lower
    bounds.lowerOpen = query.lowerOpen
  }
  if (query.upper !== undefined) {
    const upper = encodeKey(query.upper)
    // A closed upper bound takes in every key extending it.
    bounds.upper = query.upperOpen ? upper : upper + AFTER_PREFIX
    bounds.upperOpen = query.upperOpen
  }
  return bounds
}

// ------------------------------------------------------------------------------------------ the engine

export type SyncEngine<T extends Record<string, Row> = Record<string, Row>> = Awaited<
  ReturnType<typeof openSyncEngine<T>>
>

/**
 * Opens the user's local database and returns the engine over it. Nothing syncs until `start()`.
 */
export async function openSyncEngine<T extends Record<string, Row> = Record<string, Row>>(options: SyncEngineOptions) {
  const resources = new Map<string, XSync>(
    options.resources !== undefined ? options.resources.map((r) => [r.model, r]) : resourcesOf(options.document)
  )
  const now = options.now ?? (() => Date.now())
  const generateId = options.generateId ?? (() => uuid7(now()))
  const generateKey = options.generateKey ?? (() => crypto.randomUUID())
  const baseFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init))
  const strategy = options.push ?? batchPush
  const debounce = options.debounce ?? 500
  const interval = options.interval ?? 30_000
  const backoffBase = options.backoff?.base ?? 1000
  const backoffMax = options.backoff?.max ?? 300_000
  const dbName = `isik-sync:${options.user}`
  const url = (path: string) => options.baseUrl.replace(/\/+$/, '') + path

  const rowTables: TableDef[] = [...resources.values()].map((resource) => ({
    name: tableOf(resource.model),
    indexes: ['all', 'scope', ...resource.indexed.map((_, i) => `i${i}`)],
  }))
  const store: Store = await options.adapter.open(dbName, [
    // Stryker disable next-line ArrayDeclaration: an index on a table nothing ranges by index changes nothing
    { name: META, indexes: [] },
    { name: OUTBOX, indexes: ['row', 'state'] },
    // Stryker disable next-line ArrayDeclaration: an index on a table nothing ranges by index changes nothing
    { name: DEAD, indexes: [] },
    { name: STAGING, indexes: ['snap'] },
    ...rowTables,
  ])
  const allTables = [META, OUTBOX, DEAD, STAGING, ...rowTables.map((t) => t.name)]

  // ---------------------------------------------------------------- events

  const listeners = new Set<(event: SyncEvent) => void>()
  const statusListeners = new Set<() => void>()
  let status: SyncStatus = {
    online: true,
    syncing: false,
    paused: null,
    lastSyncedAt: null,
    pending: 0,
    conflicts: 0,
    dead: 0,
    // Stryker disable next-line ArrayDeclaration: opening reads the stored loading scopes over it before anyone can look
    loading: [],
    error: null,
  }
  const channel =
    (options.broadcast ?? typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(dbName) : undefined

  function setStatus(change: Partial<SyncStatus>) {
    const next = { ...status, ...change }
    if ((Object.keys(next) as (keyof SyncStatus)[]).every((key) => next[key] === status[key])) return
    status = next
    for (const listener of statusListeners) listener()
  }

  async function refreshCounts() {
    const counts = await pendingCounts()
    const state = await read((tx) => stateOf(tx))
    setStatus({
      pending: counts.pending + counts.sending + counts.conflicts,
      conflicts: counts.conflicts,
      dead: counts.dead,
      loading: state.loading,
    })
  }

  function emit(event: SyncEvent, local: boolean) {
    for (const listener of listeners) listener(event)
    if (local) channel?.postMessage(event)
    // Stryker disable next-line ConditionalExpression: counting again after a change the outbox did not see finds the same counts
    if (event.outbox) refreshCounts().catch(() => undefined)
  }
  if (channel !== undefined) channel.onmessage = (message: MessageEvent<SyncEvent>) => emit(message.data, false)

  // ---------------------------------------------------------------- transactions

  /** A read-write transaction over every table, announcing what it touched once it commits. */
  async function write<R>(fn: (tx: StoreTx, touched: SyncEvent) => Promise<R>): Promise<R> {
    const touched: SyncEvent = { models: [], outbox: false }
    const result = await store.transaction(allTables, 'readwrite', (tx) => fn(tx, touched))
    touched.models = [...new Set(touched.models)]
    if (touched.models.length > 0 || touched.outbox) emit(touched, true)
    return result
  }

  function read<R>(fn: (tx: StoreTx) => Promise<R>): Promise<R> {
    return store.transaction(allTables, 'readonly', fn)
  }

  async function stateOf(tx: StoreTx): Promise<State> {
    return (await tx.get<State>(META, 'state')) ?? initialState()
  }

  function resourceOf(model: string): XSync {
    const resource = resources.get(model)
    if (resource === undefined) throw new Error(`sync: ${model} is not a synced resource`)
    return resource
  }

  async function entriesOf(tx: StoreTx, model: string, id: string): Promise<Entry[]> {
    const row = rowKeyOf(model, id)
    return (await tx.range<Entry>(OUTBOX, { index: 'row', lower: row, upper: row })).map((r) => r.value)
  }

  async function putEntry(tx: StoreTx, entry: Entry, touched: SyncEvent) {
    touched.outbox = true
    await tx.put(OUTBOX, seqKey(entry.seq), entry, { row: rowKeyOf(entry.model, entry.id), state: entry.state })
  }

  async function dropEntry(tx: StoreTx, entry: Entry, touched: SyncEvent) {
    touched.outbox = true
    await tx.delete(OUTBOX, seqKey(entry.seq))
  }

  async function bury(
    tx: StoreTx,
    entry: Entry,
    reason: DeadReason,
    status: number,
    errors: unknown,
    touched: SyncEvent
  ) {
    await dropEntry(tx, entry, touched)
    const letter: DeadLetter = { entry: { ...entry, state: 'pending' }, status, errors, reason, at: now() }
    await tx.put(DEAD, seqKey(entry.seq), letter)
  }

  /**
   * Stores a row from its server copy and its queued writes, or forgets it when it has neither. A
   * model no longer synced has no table, and nothing is stored.
   */
  async function saveRow(tx: StoreTx, model: string, id: string, server: ServerCopy | null, touched: SyncEvent) {
    const resource = resources.get(model)
    if (resource === undefined) return null
    const entries = await entriesOf(tx, model, id)
    const local = materialize(server, entries)
    touched.models.push(model)
    // Stryker disable next-line ConditionalExpression,BlockStatement: a record with neither copy is in no index, so no read sees it - only its space differs
    if (server === null && entries.length === 0) {
      await tx.delete(tableOf(model), id)
      return local
    }
    const index: Record<string, string | undefined> = {}
    const scopeRow = server?.data ?? local
    if (scopeRow !== null) index.scope = scopeOf(resource, scopeRow)
    if (local !== null) {
      // Stryker disable next-line StringLiteral: every present row shares the one value, whatever it is
      index.all = ''
      resource.indexed.forEach((fields, i) => {
        index[`i${i}`] = encodeKey(fields.map((field) => local[field]))
      })
    }
    const record: RowRecord = { server, local }
    await tx.put(tableOf(model), id, record, index as IndexValues)
    return local
  }

  async function serverOf(tx: StoreTx, model: string, id: string): Promise<ServerCopy | null> {
    if (!resources.has(model)) return null
    return (await tx.get<RowRecord>(tableOf(model), id))?.server ?? null
  }

  // ---------------------------------------------------------------- opening: schema hashes

  await write(async (tx, touched) => {
    const state = await stateOf(tx)
    for (const resource of resources.values()) {
      const known = state.hashes[resource.model]
      if (known === resource.hash) continue
      // A changed table is dropped - keeping the rows that still have writes queued - and snapshotted
      // again. A table first seen after the first sync needs a snapshot of its own too.
      const records = await tx.range<RowRecord>(tableOf(resource.model))
      for (const { key, value } of records) {
        const entries = await entriesOf(tx, resource.model, key)
        // Kept with its server copy, whose etag its queued write still needs, until the snapshot.
        if (entries.length === 0) await tx.delete(tableOf(resource.model), key)
        else await saveRow(tx, resource.model, key, value.server, touched)
      }
      if (state.cursor !== null && !state.resnapshot.includes(resource.model)) state.resnapshot.push(resource.model)
      state.hashes[resource.model] = resource.hash
    }
    for (const model of Object.keys(state.hashes)) {
      if (!resources.has(model)) delete state.hashes[model]
    }
    await tx.put(META, 'state', state)
  })

  // ---------------------------------------------------------------- reading

  async function get<M extends keyof T & string>(model: M, id: string): Promise<T[M] | undefined> {
    resourceOf(model)
    const record = await read((tx) => tx.get<RowRecord>(tableOf(model), id))
    return (record?.local ?? undefined) as T[M] | undefined
  }

  function rangeOf(model: string, query: LocalQuery) {
    const resource = resourceOf(model)
    const wanted = query.index
    if (wanted === undefined) {
      if (query.equals !== undefined || query.lower !== undefined || query.upper !== undefined) {
        throw new Error(`sync: a query of ${model} by bounds names the index they bound`)
      }
      return { index: 'all' }
    }
    const position = resource.indexed.findIndex(
      (fields) => fields.length === wanted.length && fields.every((field, i) => field === wanted[i])
    )
    if (position === -1) throw new Error(`sync: ${model} has no index on ${wanted.join(', ')}`)
    return { index: `i${position}`, ...boundsOf(query) }
  }

  async function query<M extends keyof T & string>(model: M, query: LocalQuery = {}): Promise<T[M][]> {
    const range = rangeOf(model, query)
    const records = await read((tx) =>
      tx.range<RowRecord>(tableOf(model), {
        ...range,
        offset: query.offset,
        limit: query.limit,
        reverse: query.reverse,
      })
    )
    return records.map((record) => record.value.local as T[M])
  }

  async function count(model: keyof T & string, query: LocalQuery = {}): Promise<number> {
    const range = rangeOf(model, query)
    return read((tx) => tx.count(tableOf(model), range))
  }

  // ---------------------------------------------------------------- writing

  async function enqueue(
    tx: StoreTx,
    touched: SyncEvent,
    entry: Omit<Entry, 'seq' | 'key' | 'protocol' | 'state' | 'attempts' | 'createdAt'>
  ) {
    const state = await stateOf(tx)
    state.seq += 1
    await tx.put(META, 'state', state)
    await putEntry(
      tx,
      {
        ...entry,
        seq: state.seq,
        key: generateKey(),
        protocol: PROTOCOL_VERSION,
        state: 'pending',
        attempts: 0,
        createdAt: now(),
      },
      touched
    )
  }

  /** The row's last entry, when it can still take more: queued and not yet sent. */
  function foldable(entries: Entry[]): Entry | undefined {
    const tail = entries[entries.length - 1]
    return tail?.state === 'pending' ? tail : undefined
  }

  async function create<M extends keyof T & string>(model: M, input: Partial<T[M]>): Promise<T[M]> {
    const resource = resourceOf(model)
    const id = String((input as Row)[resource.primary_key] ?? generateId())
    const row: Row = { ...input, [resource.primary_key]: id }
    const created = await write(async (tx, touched) => {
      const server = await serverOf(tx, model, id)
      if (materialize(server, await entriesOf(tx, model, id)) !== null) throw new RowExistsError(model, id)
      await enqueue(tx, touched, { model, id, method: 'POST', body: row, base: {} })
      return saveRow(tx, model, id, server, touched)
    })
    scheduleSync(debounce)
    return created as T[M]
  }

  async function update<M extends keyof T & string>(model: M, id: string, patch: Partial<T[M]>): Promise<T[M]> {
    const resource = resourceOf(model)
    const changes: Row = { ...patch }
    delete changes[resource.primary_key]
    const updated = await write(async (tx, touched) => {
      const server = await serverOf(tx, model, id)
      const entries = await entriesOf(tx, model, id)
      const local = materialize(server, entries)
      if (local === null) throw new RowNotFoundError(model, id)
      const tail = foldable(entries)
      if (tail !== undefined) {
        // Folded into the queued write: a create takes the fields into its body; an update keeps the
        // base of each field it already changed, and takes the base of each new one from now.
        for (const field of Object.keys(changes)) {
          if (tail.method === 'PATCH' && !(field in tail.body!)) tail.base[field] = local[field]
        }
        tail.body = { ...tail.body, ...changes }
        await putEntry(tx, tail, touched)
      } else {
        const base = Object.fromEntries(Object.keys(changes).map((field) => [field, local[field]]))
        await enqueue(tx, touched, { model, id, method: 'PATCH', body: changes, base })
      }
      return saveRow(tx, model, id, server, touched)
    })
    scheduleSync(debounce)
    return updated as T[M]
  }

  async function remove(model: keyof T & string, id: string): Promise<void> {
    resourceOf(model)
    await write(async (tx, touched) => {
      const server = await serverOf(tx, model, id)
      const entries = await entriesOf(tx, model, id)
      if (materialize(server, entries) === null) throw new RowNotFoundError(model, id)
      const tail = foldable(entries)
      if (tail?.method === 'POST') {
        // Never sent: the create and the delete cancel out.
        await dropEntry(tx, tail, touched)
      } else if (tail !== undefined) {
        tail.method = 'DELETE'
        delete tail.body
        await putEntry(tx, tail, touched)
      } else {
        await enqueue(tx, touched, { model, id, method: 'DELETE', base: {} })
      }
      await saveRow(tx, model, id, server, touched)
    })
    scheduleSync(debounce)
  }

  // ---------------------------------------------------------------- the outbox, read and resolved

  async function pendingCounts(): Promise<PendingCounts> {
    const inState = (tx: StoreTx, state: Entry['state']) =>
      tx.count(OUTBOX, { index: 'state', lower: state, upper: state })
    return read(async (tx) => ({
      pending: await inState(tx, 'pending'),
      sending: await inState(tx, 'sending'),
      conflicts: await inState(tx, 'conflict'),
      dead: await tx.count(DEAD),
    }))
  }

  async function pendingEntries(page: PageQuery & { state?: Entry['state'] } = {}): Promise<Entry[]> {
    const range = page.state === undefined ? {} : { index: 'state', lower: page.state, upper: page.state }
    return read(async (tx) =>
      (await tx.range<Entry>(OUTBOX, { ...range, offset: page.offset, limit: page.limit })).map((r) => r.value)
    )
  }

  async function pendingFor(model: keyof T & string, id: string): Promise<Entry[]> {
    return read((tx) => entriesOf(tx, model, id))
  }

  async function conflictOf(tx: StoreTx, seq: number): Promise<Entry> {
    const entry = await tx.get<Entry>(OUTBOX, seqKey(seq))
    if (entry?.state !== 'conflict') throw new Error(`sync: entry ${seq} is not in conflict`)
    return entry
  }

  /** Resolves a conflict for the server: the row's queued writes are dropped and its row shows theirs. */
  async function takeTheirs(seq: number): Promise<void> {
    await write(async (tx, touched) => {
      const entry = await conflictOf(tx, seq)
      for (const queued of await entriesOf(tx, entry.model, entry.id)) await dropEntry(tx, queued, touched)
      await saveRow(tx, entry.model, entry.id, await serverOf(tx, entry.model, entry.id), touched)
    })
  }

  /** Resolves a conflict for this device: the write goes again, against the server's current version. */
  async function keepMine(seq: number): Promise<void> {
    await write(async (tx, touched) => {
      const entry = await conflictOf(tx, seq)
      const current = (entry.conflict as NonNullable<Entry['conflict']>).current
      for (const field of Object.keys(entry.base)) entry.base[field] = current[field]
      delete entry.conflict
      await putEntry(tx, { ...entry, state: 'pending', key: generateKey() }, touched)
      await saveRow(tx, entry.model, entry.id, await serverOf(tx, entry.model, entry.id), touched)
    })
    scheduleSync(0)
  }

  async function deadLetters(page: PageQuery = {}): Promise<DeadLetter[]> {
    return read(async (tx) =>
      (await tx.range<DeadLetter>(DEAD, { offset: page.offset, limit: page.limit })).map((r) => r.value)
    )
  }

  /** Every dead letter, to save or send somewhere before discarding them. */
  function exportDead(): Promise<DeadLetter[]> {
    return deadLetters()
  }

  async function letterOf(tx: StoreTx, seq: number): Promise<DeadLetter> {
    const letter = await tx.get<DeadLetter>(DEAD, seqKey(seq))
    if (letter === undefined) throw new Error(`sync: there is no dead letter ${seq}`)
    return letter
  }

  /** Puts a dead letter back in the queue, in its old place, under a new key. */
  async function retryDead(seq: number): Promise<void> {
    await write(async (tx, touched) => {
      const letter = await letterOf(tx, seq)
      await tx.delete(DEAD, seqKey(seq))
      await putEntry(tx, { ...letter.entry, state: 'pending', key: generateKey() }, touched)
      await saveRow(
        tx,
        letter.entry.model,
        letter.entry.id,
        await serverOf(tx, letter.entry.model, letter.entry.id),
        touched
      )
    })
    scheduleSync(0)
  }

  async function discardDead(seq: number): Promise<void> {
    await write(async (tx, touched) => {
      await letterOf(tx, seq)
      touched.outbox = true
      await tx.delete(DEAD, seqKey(seq))
    })
  }

  // ---------------------------------------------------------------- the network

  async function request(path: string, init: RequestInit): Promise<Response> {
    try {
      const response = await baseFetch(url(path), init)
      setStatus({ online: true })
      return response
    } catch (error) {
      setStatus({ online: false })
      throw new Offline(error)
    }
  }

  async function refusal(response: Response): Promise<never> {
    // Stryker disable next-line ArrowFunction: a body that is not JSON reads as no code either way
    const body: { code?: unknown } = await response.json().catch(() => ({}))
    if (response.status === 400 && body?.code === 'sync_protocol_unsupported') {
      throw new Paused('unsupported')
    }
    if (response.status === 401 || response.status === 403) throw new Paused('unauthorized')
    if (response.status === 429 || response.status >= 500) throw new Offline(response.status, retryAfterOf(response))
    throw new Fatal(`sync: the server answered ${response.status}`)
  }

  /** The server's push limits, read from its capabilities, or from a 413. */
  let serverLimits: Omit<Capabilities['push'], 'backend'> | undefined

  async function limits() {
    if (serverLimits === undefined && strategy === batchPush) {
      const response = await request('/sync/capabilities', { headers: { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) } })
      if (response.status !== 200) await refusal(response)
      serverLimits = ((await response.json()) as Capabilities).push
    }
    // The smaller of the project's limit and the server's; neither has one by default.
    const caps = [serverLimits?.max_entries, options.batchSize].filter((n): n is number => typeof n === 'number')
    return { maxEntries: Math.min(...caps), maxBytes: serverLimits?.max_bytes ?? Infinity }
  }

  // ---------------------------------------------------------------- pull

  function covering(open: Snapshot[], model: string, scope: string): Snapshot | undefined {
    return open.find(
      (snapshot) =>
        (snapshot.model === null || snapshot.model === model) && (snapshot.scope === null || snapshot.scope === scope)
    )
  }

  /** The server's word on a row: its new copy, or that it is gone. */
  async function applyServer(tx: StoreTx, model: string, id: string, server: ServerCopy | null, touched: SyncEvent) {
    if (server === null) {
      for (const entry of await entriesOf(tx, model, id)) {
        if (entry.method === 'DELETE') await dropEntry(tx, entry, touched)
        // An update to a row that is gone can never land; a create stays, its own answer will tell.
        else if (entry.method === 'PATCH') await bury(tx, entry, 'deleted', 0, null, touched)
      }
    }
    await saveRow(tx, model, id, server, touched)
  }

  async function dropScope(tx: StoreTx, scope: string, touched: SyncEvent) {
    for (const resource of resources.values()) {
      const rows = await tx.range<RowRecord>(tableOf(resource.model), { index: 'scope', lower: scope, upper: scope })
      for (const { key } of rows) {
        for (const entry of await entriesOf(tx, resource.model, key)) await bury(tx, entry, 'revoked', 0, null, touched)
        touched.models.push(resource.model)
        await tx.delete(tableOf(resource.model), key)
      }
    }
  }

  async function dropStaging(tx: StoreTx, snapshot: Snapshot) {
    const id = snapshotId(snapshot)
    for (const { key } of await tx.range(STAGING, { index: 'snap', lower: id, upper: id }))
      await tx.delete(STAGING, key)
  }

  async function swap(tx: StoreTx, snapshot: Snapshot, touched: SyncEvent) {
    const id = snapshotId(snapshot)
    const staged = await tx.range<{ model: string; id: string; etag: string; data: Row }>(STAGING, {
      index: 'snap',
      lower: id,
      upper: id,
    })
    const present = new Set(staged.map(({ value }) => rowKeyOf(value.model, value.id)))
    for (const resource of resources.values()) {
      if (snapshot.model !== null && snapshot.model !== resource.model) continue
      const range = snapshot.scope === null ? {} : { index: 'scope', lower: snapshot.scope, upper: snapshot.scope }
      for (const { key, value } of await tx.range<RowRecord>(tableOf(resource.model), range)) {
        // A row the snapshot does not hold is gone; one only this device has made is not the server's.
        // Stryker disable next-line ConditionalExpression: a row only this device has keeps its create, which shows it either way
        if (value.server !== null && !present.has(rowKeyOf(resource.model, key))) {
          await applyServer(tx, resource.model, key, null, touched)
        }
      }
    }
    for (const { key, value } of staged) {
      await applyServer(tx, value.model, value.id, { etag: value.etag, data: value.data }, touched)
      await tx.delete(STAGING, key)
    }
  }

  async function applyPage(page: ChangesPage, requested: string | null, etag: string | null) {
    await write(async (tx, touched) => {
      const state = await stateOf(tx)
      for (const change of page.changes) await applyChange(tx, state, change, touched)
      state.cursor = page.cursor
      state.feed = etag === null ? null : { cursor: requested, etag }
      await tx.put(META, 'state', state)
    })
  }

  async function applyChange(tx: StoreTx, state: State, change: Change, touched: SyncEvent) {
    switch (change.op) {
      case 'scope_granted':
        if (!state.loading.includes(change.scope)) state.loading.push(change.scope)
        return
      case 'scope_revoked':
        for (const snapshot of state.open.filter((s) => s.scope === change.scope)) await dropStaging(tx, snapshot)
        // Stryker disable next-line MethodExpression,ConditionalExpression: nothing more of a revoked scope arrives, so its snapshot left open stages nothing
        state.open = state.open.filter((s) => s.scope !== change.scope)
        state.loading = state.loading.filter((scope) => scope !== change.scope)
        await dropScope(tx, change.scope, touched)
        return
      case 'snapshot_begin':
        state.open.push({ scope: change.scope, model: change.model })
        state.resnapshot = state.resnapshot.filter((model) => model !== change.model)
        return
      case 'snapshot_end': {
        const snapshot = { scope: change.scope, model: change.model }
        await swap(tx, snapshot, touched)
        state.open = state.open.filter((s) => snapshotId(s) !== snapshotId(snapshot))
        state.loading = state.loading.filter((scope) => scope !== change.scope)
        return
      }
      case 'upsert': {
        const resource = resources.get(change.model)
        if (resource === undefined) return
        const snapshot = covering(state.open, change.model, scopeOf(resource, change.data))
        if (snapshot !== undefined) {
          await tx.put(
            STAGING,
            stagingKey(snapshotId(snapshot), change.model, change.id),
            { model: change.model, id: change.id, etag: change.etag, data: change.data },
            { snap: snapshotId(snapshot) }
          )
          return
        }
        await applyServer(tx, change.model, change.id, { etag: change.etag, data: change.data }, touched)
        return
      }
      case 'delete':
        await applyServer(tx, change.model, change.id, null, touched)
    }
  }

  async function pull() {
    for (;;) {
      const state = await read((tx) => stateOf(tx))
      const params = new URLSearchParams()
      if (state.cursor !== null) params.set('cursor', state.cursor)
      if (options.pageSize !== undefined) params.set('limit', String(options.pageSize))
      for (const model of state.resnapshot) params.append('snapshot', model)
      const headers: Record<string, string> = { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) }
      const quiet = state.resnapshot.length === 0 && state.feed !== null && state.feed.cursor === state.cursor
      if (quiet) headers['If-None-Match'] = (state.feed as NonNullable<State['feed']>).etag
      const response = await request(`/sync/changes?${params}`, { headers })
      if (response.status === 304) return
      if (response.status === 410) {
        // Past retention: start over from a full snapshot, which stages beside what is shown.
        await write(async (tx) => {
          const current = await stateOf(tx)
          for (const snapshot of current.open) await dropStaging(tx, snapshot)
          await tx.put(META, 'state', { ...initialState(), seq: current.seq, hashes: current.hashes })
        })
        continue
      }
      if (response.status !== 200) await refusal(response)
      const page = (await response.json()) as ChangesPage
      await applyPage(page, state.cursor, response.headers.get('ETag'))
      if (!page.has_more) return
    }
  }

  // ---------------------------------------------------------------- push

  async function flush() {
    for (;;) {
      const { maxEntries, maxBytes } = await limits()
      const selected = await write(async (tx, touched) => {
        const entries = (await tx.range<Entry>(OUTBOX)).map((r) => r.value)
        const deadCreates = new Set(
          (await tx.range<DeadLetter>(DEAD))
            .map((r) => r.value.entry)
            .filter((e) => e.method === 'POST')
            .map((e) => e.id)
        )
        const servers = new Map<string, ServerCopy | null>()
        for (const entry of entries)
          servers.set(rowKeyOf(entry.model, entry.id), await serverOf(tx, entry.model, entry.id))
        const { batch, tooLarge } = selectBatch(entries, { maxEntries, maxBytes }, deadCreates, (entry): PushEntry => {
          const wire: PushEntry = { key: entry.key, method: entry.method, model: entry.model, id: entry.id }
          if (entry.body !== undefined) wire.body = entry.body
          const etag = servers.get(rowKeyOf(entry.model, entry.id))?.etag
          if (entry.method !== 'POST' && etag !== undefined) wire.if_match = etag
          return wire
        })
        for (const entry of tooLarge) {
          await bury(tx, entry, 'too_large', 413, null, touched)
          await saveRow(
            tx,
            entry.model,
            entry.id,
            servers.get(rowKeyOf(entry.model, entry.id)) as ServerCopy | null,
            touched
          )
        }
        for (const { entry } of batch) await putEntry(tx, { ...entry, state: 'sending' }, touched)
        return batch
      })
      if (selected.length === 0) return

      let response
      try {
        response = await strategy(
          selected.map((s) => s.wire),
          { fetch: (input, init) => baseFetch(input, init), url, resources }
        )
        setStatus({ online: true })
      } catch (error) {
        setStatus({ online: false })
        await requeue(selected.map((s) => s.entry))
        throw new Offline(error)
      }
      const settled = await settle(
        selected.map((s) => s.entry),
        response.results
      )
      if (response.refused !== undefined) {
        const { status: code, body, retryAfter } = response.refused
        if (code === 413) {
          const tooLarge = body as PushTooLarge
          serverLimits = { max_entries: tooLarge.max_entries, max_bytes: tooLarge.max_bytes }
          continue
        }
        if (code === 400 && (body as { code?: string } | null)?.code === 'sync_protocol_unsupported')
          throw new Paused('unsupported')
        if (code === 401 || code === 403) throw new Paused('unauthorized')
        if (code === 429 || code >= 500) throw new Offline(code, retryAfter)
        throw new Fatal(`sync: the push was refused with ${code}`)
      }
      if (settled.paused !== null) throw new Paused(settled.paused)
      if (settled.retry) throw new Offline('an entry asked to be retried')
    }
  }

  /** Puts entries sent without an answer back in the queue, under their old keys. */
  async function requeue(sent: Entry[]) {
    await write(async (tx, touched) => {
      for (const entry of sent) await putEntry(tx, { ...entry, state: 'pending' }, touched)
    })
  }

  /** Applies each result to its entry; an entry with none goes back to the queue under its old key. */
  async function settle(sent: Entry[], results: PushResult[]) {
    const byKey = new Map(results.map((result) => [result.key, result]))
    const failed = (entry: Entry) => {
      const result = byKey.get(entry.key)
      return result === undefined || result.status >= 300
    }
    const failedCreates = new Set(sent.filter((e) => e.method === 'POST' && failed(e)).map((e) => e.id))
    let paused: PausedReason | null = null
    let retry = false
    await write(async (tx, touched) => {
      for (const entry of sent) {
        const result = byKey.get(entry.key)
        const server = await serverOf(tx, entry.model, entry.id)
        if (result === undefined) {
          // Uncertain: sent again later under the same key, after a backoff - never in a tight loop.
          await putEntry(tx, { ...entry, state: 'pending' }, touched)
          retry = true
          continue
        }
        let outcome = outcomeOf(entry, result)
        const waitedOnFailure = [...referencesOf(entry.body)].some((id) => id !== entry.id && failedCreates.has(id))
        // Stryker disable next-line StringLiteral: the switch's default branch is the retry branch
        if (outcome !== 'done' && waitedOnFailure) outcome = 'retry'
        // Back in the queue under a new key: a definite non-2xx committed nothing.
        const again = () => ({ ...entry, state: 'pending' as const, key: generateKey(), attempts: entry.attempts + 1 })
        switch (outcome) {
          case 'done': {
            await dropEntry(tx, entry, touched)
            let next = server
            if (entry.method === 'DELETE') next = null
            else if (result.data !== undefined) next = { etag: result.etag ?? '', data: result.data }
            await saveRow(tx, entry.model, entry.id, next, touched)
            continue
          }
          case 'rebase':
            await putEntry(tx, again(), touched)
            await saveRow(
              tx,
              entry.model,
              entry.id,
              { etag: result.etag as string, data: result.current as Row },
              touched
            )
            continue
          case 'conflict':
            await putEntry(
              tx,
              {
                ...entry,
                state: 'conflict',
                conflict: { current: result.current as Row, etag: result.etag as string },
              },
              touched
            )
            await saveRow(
              tx,
              entry.model,
              entry.id,
              { etag: result.etag as string, data: result.current as Row },
              touched
            )
            continue
          case 'dead':
            await bury(tx, entry, 'rejected', result.status, result.errors, touched)
            await saveRow(tx, entry.model, entry.id, server, touched)
            continue
          case 'fatal':
            await putEntry(tx, again(), touched)
            paused = 'precondition_required'
            continue
          case 'pause':
            await putEntry(tx, again(), touched)
            paused ??= 'unauthorized'
            continue
          default:
            await putEntry(tx, again(), touched)
            retry = true
        }
      }
    })
    return { paused, retry }
  }

  // ---------------------------------------------------------------- scheduling

  const localLock = createMutex()
  const locks = options.locks === undefined ? (globalThis.navigator?.locks ?? null) : options.locks
  let running: Promise<void> | null = null
  let queued: Promise<void> | null = null
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let started = false
  let closed = false

  function exclusive(task: () => Promise<void>): Promise<void> {
    if (locks !== null) return locks.request(dbName, () => task()).then(() => undefined)
    return localLock(task)
  }

  async function cycle() {
    setStatus({ syncing: true, error: null })
    try {
      // A push the server is throttling, or failing, still lets the feed come in.
      const pushed = await flush().then(
        () => null,
        (error: unknown) => {
          if (error instanceof Offline && status.online) return error
          throw error
        }
      )
      await pull()
      if (pushed !== null) throw pushed
      await flush()
      failures = 0
      setStatus({ lastSyncedAt: now() })
    } catch (error) {
      if (error instanceof Paused) setStatus({ paused: error.reason, error })
      else if (error instanceof Offline) {
        failures += 1
        const delay =
          error.retryAfter !== null ? error.retryAfter * 1000 : Math.min(backoffMax, backoffBase * 2 ** (failures - 1))
        setStatus({ error })
        scheduleSync(delay)
      } else {
        setStatus({ error })
        throw error
      }
    } finally {
      setStatus({ syncing: false })
      await refreshCounts()
    }
  }

  /** Syncs now: pushes the queue, pulls the feed, pushes again. Resolves when that is done. */
  function sync(): Promise<void> {
    if (closed || status.paused !== null) return Promise.resolve()
    // A sync asked for while one runs may have missed what prompted it: one more follows, shared.
    if (running !== null) {
      queued ??= running
        .catch(() => undefined)
        .then(() => {
          queued = null
          return sync()
        })
      return queued
    }
    running = exclusive(cycle).finally(() => {
      running = null
    })
    return running
  }

  function scheduleSync(delay: number) {
    if (!started || closed) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      sync().catch(() => undefined)
    }, delay)
  }

  const unsubscribers: (() => void)[] = []

  /** Starts syncing: now, and on every trigger after. */
  function start() {
    if (started || closed) return
    started = true
    const onTrigger = () => scheduleSync(0)
    const doc = globalThis.document
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', onTrigger)
      unsubscribers.push(() => window.removeEventListener('online', onTrigger))
    }
    if (doc !== undefined) {
      const onVisible = () => {
        if (doc.visibilityState === 'visible') onTrigger()
      }
      doc.addEventListener('visibilitychange', onVisible)
      unsubscribers.push(() => doc.removeEventListener('visibilitychange', onVisible))
    }
    if (options.foreground !== undefined) unsubscribers.push(options.foreground(onTrigger))
    if (interval > 0) {
      const poll = setInterval(() => {
        if (doc === undefined || doc.visibilityState === 'visible') sync().catch(() => undefined)
      }, interval)
      unsubscribers.push(() => clearInterval(poll))
    }
    globalThis.navigator?.storage?.persist?.().catch(() => undefined)
    scheduleSync(0)
  }

  function stop() {
    started = false
    clearTimeout(timer)
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  }

  /** Lifts a pause - after a fresh login, or an app update - and syncs. */
  function resume() {
    setStatus({ paused: null, error: null })
    scheduleSync(0)
  }

  function close() {
    stop()
    closed = true
    channel?.close()
    store.close()
  }

  /**
   * Deletes the user's local database - on an explicit logout, never on an expired session. Refuses
   * with `PendingWritesError` while writes are unsent, unless `force`: warn the user, then force.
   */
  async function wipe(wipeOptions: { force?: boolean } = {}) {
    const counts = await pendingCounts()
    const unsent = counts.pending + counts.sending + counts.conflicts + counts.dead
    if (unsent > 0 && !wipeOptions.force) throw new PendingWritesError(unsent)
    close()
    await options.adapter.deleteDatabase(dbName)
  }

  await refreshCounts()

  return {
    resources: resources as ReadonlyMap<string, XSync>,
    get,
    query,
    count,
    create,
    update,
    remove,
    pendingCounts,
    pendingEntries,
    pendingFor,
    takeTheirs,
    keepMine,
    deadLetters,
    exportDead,
    retryDead,
    discardDead,
    status: () => status,
    subscribe(listener: (event: SyncEvent) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeStatus(listener: () => void) {
      statusListeners.add(listener)
      return () => {
        statusListeners.delete(listener)
      }
    },
    sync,
    start,
    stop,
    resume,
    close,
    wipe,
  }
}
