import { retryAfterOf } from '../http'
import type { PushEntry, PushResult, Row, XSync } from './protocol'
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from './protocol'

/** What a push strategy is given to reach the server. */
export interface PushContext {
  fetch: typeof fetch
  /** The URL of a sync endpoint, such as `/sync/push`, or a REST path, such as a resource's `path`. */
  url(path: string): string
  resources: ReadonlyMap<string, XSync>
}

/**
 * A push's answer: a result for each entry it settled, in entry order. An entry without a result is
 * uncertain - it may or may not have been written - and is sent again under the same key. `refused`
 * is a refusal of the request as a whole: 413, 429, 401, a protocol mismatch.
 */
export interface PushResponse {
  results: PushResult[]
  refused?: { status: number; body: unknown; retryAfter: number | null }
}

/** How the outbox reaches the server. A project may write its own; it throws on a network failure. */
export type PushStrategy = (entries: PushEntry[], context: PushContext) => Promise<PushResponse>

async function bodyOf(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function refusalOf(response: Response): Promise<PushResponse> {
  return {
    results: [],
    refused: { status: response.status, body: await bodyOf(response), retryAfter: retryAfterOf(response) },
  }
}

/** Every entry in one request to `/sync/push`. */
export const batchPush: PushStrategy = async (entries, context) => {
  const response = await context.fetch(context.url('/sync/push'), {
    method: 'POST',
    headers: { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION), 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  })
  if (response.status !== 200) return refusalOf(response)
  return { results: ((await bodyOf(response)) as { results: PushResult[] }).results }
}

/**
 * Each entry as its own REST request, one after another, for a server without `/sync/push`. A 429 or a
 * protocol refusal stops the run; what ran before it keeps its results.
 */
export const restPush: PushStrategy = async (entries, context) => {
  const results: PushResult[] = []
  for (const entry of entries) {
    const resource = context.resources.get(entry.model)
    if (resource === undefined) {
      results.push({ key: entry.key, status: 404, errors: { code: 'sync_model_unknown' } })
      continue
    }
    const headers: Record<string, string> = { 'Idempotency-Key': entry.key }
    if (entry.if_match !== undefined) headers['If-Match'] = entry.if_match
    let body: string | undefined
    if (entry.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(entry.method === 'POST' ? { ...entry.body, [resource.primary_key]: entry.id } : entry.body)
    }
    const path = entry.method === 'POST' ? resource.path : `${resource.path}${entry.id}/`
    const response = await context.fetch(context.url(path), { method: entry.method, headers, body })
    if (response.status === 429) return { ...(await refusalOf(response)), results }
    const payload = await bodyOf(response)
    const result: PushResult = { key: entry.key, status: response.status }
    const etag = response.headers.get('ETag')
    if (etag !== null) result.etag = etag
    if (response.ok) {
      if (payload !== undefined) result.data = payload as Row
    } else if (response.status === 412) {
      const current = (payload as { current?: Row } | undefined)?.current
      if (current !== undefined) result.current = current
    } else {
      result.errors = payload
    }
    results.push(result)
  }
  return { results }
}
