import modelsJson from '../../../protocol/sync/v1/models.json'
import type { Change, PushEntry, PushResult, Row, XSync } from '../../../src/sync/protocol'
import { PROTOCOL_HEADER, scopeOf } from '../../../src/sync/protocol'

// An in-process sync server for the client's tests, built to the protocol fixtures (it must pass every
// one of them, see server.test.ts) and simple enough to trust: one log, cursors kept server-side by id.
//
// Its models are the fixtures' three. On a create, every `string` column is required, a `uuid` column
// other than the key and the scope names a row of the model of that name plus "s", a `boolean` defaults
// to false and a `uuid` to null.

export const MODELS = Object.fromEntries(
  Object.entries(modelsJson).map(([name, x]) => [name, { ...x, hash: `${name}-1` } as XSync])
) as Record<string, XSync>

export function openAPIDocument(models: Record<string, XSync> = MODELS) {
  return {
    openapi: '3.1.0',
    components: { schemas: Object.fromEntries(Object.values(models).map((x) => [x.model, { 'x-sync': x }])) },
  }
}

interface LogEntry {
  pos: number
  kind: 'row'
  model: string
  id: string
  scopes: string[]
}

interface MembershipEntry {
  pos: number
  kind: 'grant' | 'revoke'
  user: string
  scope: string
}

type Logged = LogEntry | MembershipEntry

interface Snapshot {
  scope: string | null
  model: string | null
  begun: boolean
  remaining: { model: string; id: string; etag: string; data: Row }[]
  deferred: number[]
}

interface CursorState {
  pos: number
  snapshots: Snapshot[]
  issued: number
}

interface StoredRow {
  data: Row
  version: number
}

export interface ServerResponse {
  status: number
  headers: Record<string, string>
  body?: unknown
}

export interface ServerRequest {
  method: string
  path: string
  query?: Record<string, string | string[]>
  headers?: Record<string, string>
  body?: unknown
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function byModelThenId(a: { model: string; id: string }, b: { model: string; id: string }) {
  const left = `${a.model}\u0001${a.id}`
  const right = `${b.model}\u0001${b.id}`
  if (left === right) return 0
  return left < right ? -1 : 1
}

export class FakeServer {
  readonly models: Record<string, XSync>
  readonly rows = new Map<string, Map<string, StoredRow>>()
  readonly memberships = new Map<string, Set<string>>()
  readonly log: Logged[] = []
  readonly claims = new Map<string, PushResult>()
  /** Every entry a push wrote, replays aside. */
  readonly applied: PushEntry[] = []
  readonly cursors = new Map<string, CursorState>()
  push = { max_entries: null as number | null, max_bytes: null as number | null }
  /** Requests served, by path. */
  readonly served: string[] = []
  private expiredBefore = 0
  private issued = 0

  constructor(models: Record<string, XSync> = MODELS) {
    this.models = models
    for (const name of Object.keys(models)) this.rows.set(name, new Map())
  }

  // ---------------------------------------------------------------- the world

  scopesOf(user: string): Set<string> {
    const scopes = new Set(this.memberships.get(user) ?? [])
    scopes.add(`user:${user}`)
    return scopes
  }

  private position(): number {
    return this.log.length
  }

  private record(model: string, id: string, scopes: string[]) {
    this.log.push({ pos: this.position() + 1, kind: 'row', model, id, scopes })
  }

  etagOf(model: string, id: string): string | undefined {
    const row = this.rows.get(model)?.get(id)
    return row === undefined ? undefined : `"${id}-v${row.version}"`
  }

  create(model: string, row: Row) {
    const id = String(row[this.models[model].primary_key])
    this.rows.get(model)?.set(id, { data: clone(row), version: 1 })
    this.record(model, id, [scopeOf(this.models[model], row)])
  }

  update(model: string, id: string, set: Row) {
    const stored = this.rows.get(model)?.get(id) as StoredRow
    const before = scopeOf(this.models[model], stored.data)
    stored.data = { ...stored.data, ...clone(set) }
    stored.version += 1
    const after = scopeOf(this.models[model], stored.data)
    this.record(model, id, before === after ? [after] : [before, after])
  }

  delete(model: string, id: string) {
    const stored = this.rows.get(model)?.get(id) as StoredRow
    this.rows.get(model)?.delete(id)
    this.record(model, id, [scopeOf(this.models[model], stored.data)])
  }

  grant(user: string, scope: string) {
    const scopes = this.memberships.get(user) ?? new Set()
    scopes.add(scope)
    this.memberships.set(user, scopes)
    this.log.push({ pos: this.position() + 1, kind: 'grant', user, scope })
  }

  revoke(user: string, scope: string) {
    this.memberships.get(user)?.delete(scope)
    this.log.push({ pos: this.position() + 1, kind: 'revoke', user, scope })
  }

  /** Every cursor issued so far is past retention. */
  expire() {
    this.expiredBefore = this.issued
  }

  // ---------------------------------------------------------------- requests

  handle(user: string | null, request: ServerRequest): ServerResponse {
    this.served.push(request.path)
    const version = request.headers?.[PROTOCOL_HEADER]
    if (version !== '1') {
      return { status: 400, headers: {}, body: { code: 'sync_protocol_unsupported', supported: [1] } }
    }
    const headers = { [PROTOCOL_HEADER]: '1' }
    if (user === null)
      return { status: 401, headers, body: { detail: 'Authentication credentials were not provided.' } }
    if (request.method === 'GET' && request.path === '/sync/capabilities') {
      return { status: 200, headers, body: { protocol: 1, push: { backend: 'fake', ...this.push } } }
    }
    if (request.method === 'GET' && request.path === '/sync/changes') return this.changes(user, request, headers)
    if (request.method === 'POST' && request.path === '/sync/push') return this.pushBatch(user, request, headers)
    return { status: 404, headers, body: { detail: 'Not found.' } }
  }

  private visible(user: string, model: string, id: string): StoredRow | undefined {
    const stored = this.rows.get(model)?.get(id)
    if (stored === undefined) return undefined
    return this.scopesOf(user).has(scopeOf(this.models[model], stored.data)) ? stored : undefined
  }

  private snapshotRows(user: string, scope: string | null, model: string | null) {
    const scopes = this.scopesOf(user)
    const rows: Snapshot['remaining'] = []
    for (const [name, table] of this.rows) {
      if (model !== null && name !== model) continue
      for (const [id, stored] of table) {
        const rowScope = scopeOf(this.models[name], stored.data)
        if (!scopes.has(rowScope) || (scope !== null && rowScope !== scope)) continue
        rows.push({ model: name, id, etag: this.etagOf(name, id) as string, data: clone(stored.data) })
      }
    }
    return rows.sort(byModelThenId)
  }

  private covers(snapshot: Snapshot, entry: LogEntry) {
    return (
      (snapshot.model === null || snapshot.model === entry.model) &&
      (snapshot.scope === null || entry.scopes.includes(snapshot.scope))
    )
  }

  private issue(state: CursorState): string {
    this.issued += 1
    const id = `c${this.issued}`
    this.cursors.set(id, { ...clone(state), issued: this.issued })
    return id
  }

  private changes(user: string, request: ServerRequest, headers: Record<string, string>): ServerResponse {
    const query = request.query ?? {}
    const cursorId = query.cursor as string | undefined
    const limit = Number(query.limit ?? 100)
    const requested = ([] as string[]).concat(query.snapshot ?? [])
    let state: CursorState
    if (cursorId === undefined) {
      state = {
        pos: this.position(),
        snapshots: [
          { scope: null, model: null, begun: false, remaining: this.snapshotRows(user, null, null), deferred: [] },
        ],
        issued: 0,
      }
    } else {
      const found = this.cursors.get(cursorId)
      if (found === undefined || found.issued <= this.expiredBefore) {
        return { status: 410, headers, body: { code: 'sync_cursor_expired' } }
      }
      state = clone(found)
    }
    for (const model of requested) {
      if (!state.snapshots.some((s) => s.model === model && s.scope === null)) {
        state.snapshots.push({
          scope: null,
          model,
          begun: false,
          remaining: this.snapshotRows(user, null, model),
          deferred: [],
        })
      }
    }

    const page: Change[] = []
    const live = new Map<string, Change>()
    let counted = 0
    const flushLive = () => {
      page.push(...live.values())
      live.clear()
    }

    const emitLive = (entry: LogEntry) => {
      const scopes = this.scopesOf(user)
      if (!entry.scopes.some((scope) => scopes.has(scope))) return
      const key = `${entry.model}/${entry.id}`
      if (!live.has(key)) counted += 1
      live.delete(key)
      const stored = this.visible(user, entry.model, entry.id)
      live.set(
        key,
        stored === undefined
          ? { op: 'delete', model: entry.model, id: entry.id }
          : {
              op: 'upsert',
              model: entry.model,
              id: entry.id,
              etag: this.etagOf(entry.model, entry.id) as string,
              data: clone(stored.data),
            }
      )
    }

    const endSnapshot = (snapshot: Snapshot) => {
      page.push({ op: 'snapshot_end', scope: snapshot.scope, model: snapshot.model })
      state.snapshots = state.snapshots.filter((s) => s !== snapshot)
      for (const pos of snapshot.deferred) this.process(user, state, this.log[pos - 1], emitLive, page, flushLive)
      flushLive()
    }

    // The live log first, up to the limit; then the open snapshots' rows.
    while (state.pos < this.position()) {
      const entry = this.log[state.pos]
      const key = entry.kind === 'row' ? `${entry.model}/${entry.id}` : ''
      if (entry.kind === 'row' && counted >= limit && !live.has(key)) break
      state.pos += 1
      this.process(user, state, entry, emitLive, page, flushLive)
    }
    flushLive()
    for (const snapshot of [...state.snapshots]) {
      if (!snapshot.begun) {
        page.push({ op: 'snapshot_begin', scope: snapshot.scope, model: snapshot.model })
        snapshot.begun = true
      }
      while (snapshot.remaining.length > 0 && counted < limit) {
        const row = snapshot.remaining.shift() as Snapshot['remaining'][number]
        page.push({ op: 'upsert', ...row })
        counted += 1
      }
      if (snapshot.remaining.length === 0) endSnapshot(snapshot)
    }

    const hasMore = state.pos < this.position() || state.snapshots.length > 0
    const unchanged =
      cursorId !== undefined &&
      page.length === 0 &&
      JSON.stringify({ ...state, issued: 0 }) === JSON.stringify({ ...this.cursors.get(cursorId), issued: 0 })
    const cursor = unchanged ? (cursorId as string) : this.issue(state)
    const body = { changes: page, cursor, has_more: hasMore }
    const etag = `"feed:${cursorId ?? ''}:${JSON.stringify(body).length}:${cursor}"`
    if (request.headers?.['If-None-Match'] === etag) return { status: 304, headers }
    return { status: 200, headers: { ...headers, ETag: etag }, body }
  }

  private process(
    user: string,
    state: CursorState,
    entry: Logged,
    emitLive: (entry: LogEntry) => void,
    page: Change[],
    flushLive: () => void
  ) {
    if (entry.kind === 'row') {
      const holder = state.snapshots.find((snapshot) => this.covers(snapshot, entry))
      if (holder !== undefined) holder.deferred.push(entry.pos)
      else emitLive(entry)
      return
    }
    if (entry.user !== user) return
    flushLive()
    if (entry.kind === 'grant') {
      page.push({ op: 'scope_granted', scope: entry.scope })
      state.snapshots.push({
        scope: entry.scope,
        model: null,
        begun: false,
        remaining: this.snapshotRows(user, entry.scope, null),
        deferred: [],
      })
      return
    }
    page.push({ op: 'scope_revoked', scope: entry.scope })
    const dropped = state.snapshots.filter((snapshot) => snapshot.scope === entry.scope)
    state.snapshots = state.snapshots.filter((snapshot) => snapshot.scope !== entry.scope)
    for (const snapshot of dropped) {
      for (const pos of snapshot.deferred) this.process(user, state, this.log[pos - 1], emitLive, page, flushLive)
    }
  }

  // ---------------------------------------------------------------- push

  private pushBatch(user: string, request: ServerRequest, headers: Record<string, string>): ServerResponse {
    const entries = (request.body as { entries: PushEntry[] }).entries
    const bytes = new TextEncoder().encode(JSON.stringify(request.body)).length
    if (
      (this.push.max_entries !== null && entries.length > this.push.max_entries) ||
      (this.push.max_bytes !== null && bytes > this.push.max_bytes)
    ) {
      return { status: 413, headers, body: { code: 'sync_push_too_large', ...this.push } }
    }
    return { status: 200, headers, body: { results: entries.map((entry) => this.pushEntry(user, entry)) } }
  }

  pushEntry(user: string, entry: PushEntry): PushResult {
    const claim = `${user}/${entry.key}`
    const stored = this.claims.get(claim)
    if (stored !== undefined) return clone(stored)
    const result = { key: entry.key, ...this.write(user, entry) }
    // Only a 2xx commits, its claim included.
    if (result.status < 300) {
      this.claims.set(claim, clone(result))
      this.applied.push(clone(entry))
    }
    return result
  }

  private write(user: string, entry: PushEntry): Omit<PushResult, 'key'> {
    const resource = this.models[entry.model]
    if (resource === undefined) return { status: 404, errors: { code: 'sync_model_unknown' } }
    const scopes = this.scopesOf(user)
    const existing = this.rows.get(entry.model)?.get(entry.id)

    if (entry.method === 'POST') {
      if (existing !== undefined) return { status: 409, errors: { detail: 'A row with this id already exists.' } }
      const body = entry.body ?? {}
      const row: Row = {}
      const errors: Record<string, string[]> = {}
      for (const [column, type] of Object.entries(resource.columns)) {
        const value = column === resource.primary_key ? entry.id : body[column]
        if (type === 'string' && (typeof value !== 'string' || value === ''))
          errors[column] = ['This field is required.']
        else if (type === 'boolean') row[column] = value ?? false
        else if (type === 'uuid' && column !== resource.primary_key && column !== resource.scope.field) {
          if (value !== undefined && value !== null && this.visible(user, `${column}s`, String(value)) === undefined) {
            errors[column] = [`Invalid pk "${String(value)}" - object does not exist.`]
          }
          row[column] = value ?? null
        } else row[column] = value
      }
      if (Object.keys(errors).length > 0) return { status: 400, errors }
      if (!scopes.has(scopeOf(resource, row)))
        return { status: 403, errors: { detail: 'You do not have permission to perform this action.' } }
      this.create(entry.model, row)
      return { status: 201, etag: this.etagOf(entry.model, entry.id), data: clone(row) }
    }

    if (existing === undefined || !scopes.has(scopeOf(resource, existing.data))) {
      return { status: 404, errors: { detail: 'No such row.' } }
    }
    if (entry.if_match === undefined) return { status: 428, errors: { detail: 'If-Match is required.' } }
    const etag = this.etagOf(entry.model, entry.id) as string
    if (entry.if_match !== etag) return { status: 412, etag, current: clone(existing.data) }
    if (entry.method === 'DELETE') {
      this.delete(entry.model, entry.id)
      return { status: 204 }
    }
    const set: Row = {}
    for (const [column, value] of Object.entries(entry.body ?? {})) {
      if (column === resource.primary_key || !(column in resource.columns)) continue
      if (resource.columns[column] === 'string' && (typeof value !== 'string' || value === '')) {
        return { status: 400, errors: { [column]: ['This field may not be blank.'] } }
      }
      set[column] = value
    }
    const moved = { ...existing.data, ...set }
    if (!scopes.has(scopeOf(resource, moved)))
      return { status: 403, errors: { detail: 'You do not have permission to perform this action.' } }
    this.update(entry.model, entry.id, set)
    return {
      status: 200,
      etag: this.etagOf(entry.model, entry.id),
      data: clone(this.rows.get(entry.model)?.get(entry.id)?.data as Row),
    }
  }

  // ---------------------------------------------------------------- fetch

  /** A fetch that reaches this server as `user`, as a client's base fetch. */
  fetchAs(user: () => string | null): typeof fetch {
    return async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const query: Record<string, string | string[]> = {}
      for (const [key, value] of url.searchParams) {
        const previous = query[key]
        query[key] = previous === undefined ? value : ([] as string[]).concat(previous, value)
      }
      const headers: Record<string, string> = {}
      request.headers.forEach((value, key) => {
        const names: Record<string, string> = {
          [PROTOCOL_HEADER.toLowerCase()]: PROTOCOL_HEADER,
          'if-none-match': 'If-None-Match',
        }
        headers[names[key.toLowerCase()] ?? key] = value
      })
      const text = await request.text()
      const response = this.handle(user(), {
        method: request.method,
        path: url.pathname,
        query,
        headers,
        body: text === '' ? undefined : JSON.parse(text),
      })
      return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
        status: response.status,
        headers: response.headers,
      })
    }
  }
}
