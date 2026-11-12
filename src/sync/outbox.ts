import type { PushMethod, PushResult, Row } from './protocol'

// The outbox's rules, as pure functions over entries: how a write folds into what is already queued,
// what goes into the next batch, and what each result means. The engine does the storing.

export type EntryState = 'pending' | 'sending' | 'conflict'

/** A queued write. */
export interface Entry {
  /** Its place in the queue, and its key there. */
  seq: number
  model: string
  id: string
  method: Exclude<PushMethod, 'PUT'>
  /** The fields to write: the whole row for a create, the changed fields for an update. */
  body?: Row
  /** For an update, each changed field's value before this entry changed it: the 412 check's base. */
  base: Row
  /** The Idempotency-Key, set before the first send and kept until a result settles it. */
  key: string
  /** The protocol version the entry was queued under. */
  protocol: number
  state: EntryState
  /** For a conflict: the server's row and its etag. */
  conflict?: { current: Row; etag: string }
  attempts: number
  createdAt: number
}

export type DeadReason = 'rejected' | 'revoked' | 'deleted' | 'too_large'

/** A write the server refused, or that can no longer be sent: kept, never silently dropped. */
export interface DeadLetter {
  entry: Entry
  /** The entry's result status; 0 when no server answered (revoked, deleted, too large). */
  status: number
  errors: unknown
  reason: DeadReason
  at: number
}

/** What a stored row knows: the server's last word on it, and the row as the user sees it. */
export interface ServerCopy {
  etag: string
  data: Row
}

/** The row as the user sees it: the server's copy with the queued writes applied in order. */
export function materialize(server: ServerCopy | null, entries: readonly Entry[]): Row | null {
  let row: Row | null = server === null ? null : server.data
  for (const entry of entries) {
    if (entry.method === 'DELETE') row = null
    else if (entry.method === 'POST' || row !== null) row = { ...row, ...entry.body }
  }
  return row
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return aKeys.length === bKeys.length && aKeys.every((key) => deepEqual((a as Row)[key], (b as Row)[key]))
}

/**
 * Whether an update the server refused with 412 can go again against the new version on its own:
 * yes when nobody touched the fields it changes - each is still what it was when the entry changed it.
 */
export function rebasable(entry: Entry, current: Row): boolean {
  return (
    entry.method === 'PATCH' &&
    Object.keys(entry.body ?? {}).every((field) => deepEqual(current[field], entry.base[field]))
  )
}

/** Every string a body holds at its top level or one level down: the ids it may refer to. */
export function referencesOf(body: Row | undefined): Set<string> {
  const found = new Set<string>()
  const visit = (value: unknown, depth: number) => {
    if (typeof value === 'string') found.add(value)
    else if (depth < 2 && value !== null && typeof value === 'object') {
      for (const inner of Object.values(value)) visit(inner, depth + 1)
    }
  }
  visit(body, 0)
  return found
}

export function rowKeyOf(model: string, id: string): string {
  return `${model}\u0001${id}`
}

/** The most entries, and bytes, a batch may hold: `Infinity` for no limit. */
export interface BatchLimits {
  maxEntries: number
  maxBytes: number
}

/** `{"entries":[]}`, the envelope every batch pays for. */
const ENVELOPE_BYTES = 14

export interface Selection<W> {
  batch: { entry: Entry; wire: W }[]
  /** Entries bigger on their own than the server takes: never sendable. */
  tooLarge: Entry[]
}

/**
 * The next batch, in queue order. A row sends one entry per batch, the first it has; a row with a
 * conflict sends nothing until it is resolved. An entry naming a row whose create is still queued
 * waits until that create is in the same batch, earlier; one naming a dead create waits for good.
 */
export function selectBatch<W>(
  entries: readonly Entry[],
  limits: BatchLimits,
  deadCreates: ReadonlySet<string>,
  wireOf: (entry: Entry) => W
): Selection<W> {
  const creates = new Map(entries.filter((entry) => entry.method === 'POST').map((entry) => [entry.id, entry.seq]))
  const seenRows = new Set<string>()
  const inBatch = new Set<number>()
  const batch: Selection<W>['batch'] = []
  const tooLarge: Entry[] = []
  const encoder = new TextEncoder()
  let bytes = ENVELOPE_BYTES

  for (const entry of entries) {
    const row = rowKeyOf(entry.model, entry.id)
    if (seenRows.has(row)) continue
    seenRows.add(row)
    if (entry.state === 'conflict') continue
    const waiting = [...referencesOf(entry.body)].some((id) => {
      if (id === entry.id) return false
      if (deadCreates.has(id)) return true
      const create = creates.get(id)
      return create !== undefined && !inBatch.has(create)
    })
    if (waiting) continue
    const wire = wireOf(entry)
    // Its own bytes and the comma before it.
    const size = encoder.encode(JSON.stringify(wire)).length + 1
    if (ENVELOPE_BYTES + size > limits.maxBytes) {
      tooLarge.push(entry)
      continue
    }
    if (batch.length >= limits.maxEntries) break
    if (bytes + size > limits.maxBytes) break
    batch.push({ entry, wire })
    inBatch.add(entry.seq)
    bytes += size
  }
  return { batch, tooLarge }
}

export type Outcome = 'done' | 'rebase' | 'conflict' | 'dead' | 'retry' | 'pause' | 'fatal'

/** What a result means for its entry. */
export function outcomeOf(entry: Entry, result: PushResult): Outcome {
  const { status } = result
  if (status >= 200 && status < 300) return 'done'
  // Deleting what is already gone has done what it set out to.
  if (entry.method === 'DELETE' && (status === 404 || status === 410)) return 'done'
  // A 412 without the current row breaks the protocol; nothing can be rebased on or shown against it.
  if (status === 412 && result.current === undefined) return 'dead'
  if (status === 412) return rebasable(entry, result.current as Row) ? 'rebase' : 'conflict'
  if (status === 401) return 'pause'
  if (status === 428) return 'fatal'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry'
  return 'dead'
}
