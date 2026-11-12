// The wire protocol's shapes and names, version 1. The prose that governs them is
// protocol/sync/v1/PROTOCOL.md in this repository; a server pins the same directory.

export const PROTOCOL_VERSION = 1
export const PROTOCOL_HEADER = 'Isik-Sync-Protocol'

export type ColumnType = 'string' | 'integer' | 'number' | 'boolean' | 'uuid' | 'datetime' | 'date' | 'json'

/** A resource's `x-sync` OpenAPI extension: all a client needs to keep a table of it. */
export interface XSync {
  protocol: number
  model: string
  path: string
  primary_key: string
  scope: { kind: string; field: string }
  columns: Record<string, ColumnType>
  indexed: string[][]
  hash: string
}

export type Row = Record<string, unknown>

export type Change =
  | { op: 'upsert'; model: string; id: string; etag: string; data: Row }
  | { op: 'delete'; model: string; id: string }
  | { op: 'scope_granted' | 'scope_revoked'; scope: string }
  | { op: 'snapshot_begin' | 'snapshot_end'; scope: string | null; model: string | null }

export interface ChangesPage {
  changes: Change[]
  cursor: string
  has_more: boolean
}

export interface Capabilities {
  protocol: number
  push: { backend: string; max_entries: number | null; max_bytes: number | null }
}

export type PushMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface PushEntry {
  key: string
  method: PushMethod
  model: string
  id: string
  body?: Row
  if_match?: string
}

export interface PushResult {
  key: string
  status: number
  etag?: string
  data?: Row
  current?: Row
  errors?: unknown
}

export interface PushTooLarge {
  code: 'sync_push_too_large'
  max_entries: number | null
  max_bytes: number | null
}

/** The scope a row of this resource lives in: `kind:value`. */
export function scopeOf(resource: XSync, row: Row): string {
  return `${resource.scope.kind}:${String(row[resource.scope.field])}`
}

/** Every resource an OpenAPI document marks with `x-sync`, by model name. */
export function resourcesOf(document: unknown): Map<string, XSync> {
  const schemas = (document as { components?: { schemas?: Record<string, { 'x-sync'?: XSync }> } })?.components?.schemas
  const resources = new Map<string, XSync>()
  for (const schema of Object.values(schemas ?? {})) {
    const xSync = schema['x-sync']
    if (xSync === undefined) continue
    if (xSync.protocol !== PROTOCOL_VERSION) {
      throw new Error(
        `sync: ${xSync.model} speaks sync protocol ${xSync.protocol}, and this client speaks ${PROTOCOL_VERSION}`
      )
    }
    resources.set(xSync.model, xSync)
  }
  return resources
}
