import { describe, expect, it, vi } from 'vitest'

import type { PushEntry } from '../../src/sync/protocol'
import type { PushContext } from '../../src/sync/push'
import { batchPush, restPush } from '../../src/sync/push'
import { MODELS } from './support/server'

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined }

function contextFor(...responses: (Response | Error)[]) {
  const calls: Call[] = []
  const context: PushContext = {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: init?.headers as Record<string, string>,
        body: init?.body as string | undefined,
      })
      const next = responses.shift() as Response | Error
      if (next instanceof Error) throw next
      return next
    }) as unknown as typeof fetch,
    url: (path) => `https://api.test${path}`,
    resources: new Map(Object.values(MODELS).map((x) => [x.model, x])),
  }
  return { context, calls }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

const create: PushEntry = { key: 'k1', method: 'POST', model: 'tasks', id: 't1', body: { title: 'x' } }
const patch: PushEntry = { key: 'k2', method: 'PATCH', model: 'tasks', id: 't1', body: { done: true }, if_match: '"1"' }
const remove: PushEntry = { key: 'k3', method: 'DELETE', model: 'tasks', id: 't1', if_match: '"2"' }

describe('batchPush', () => {
  it('sends every entry in one request with the protocol version, and returns the results', async () => {
    const results = [{ key: 'k1', status: 201 }]
    const { context, calls } = contextFor(json(200, { results }))
    expect(await batchPush([create], context)).toStrictEqual({ results })
    expect(calls).toStrictEqual([
      {
        url: 'https://api.test/sync/push',
        method: 'POST',
        headers: { 'Isik-Sync-Protocol': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [create] }),
      },
    ])
  })

  it('returns a refusal with its body and Retry-After', async () => {
    const { context } = contextFor(json(429, { detail: 'slow down' }, { 'Retry-After': '7' }))
    expect(await batchPush([create], context)).toStrictEqual({
      results: [],
      refused: { status: 429, body: { detail: 'slow down' }, retryAfter: 7 },
    })
  })

  it('reads an empty or non-JSON refusal body', async () => {
    const empty = contextFor(new Response(null, { status: 502 }))
    expect((await batchPush([create], empty.context)).refused).toEqual({
      status: 502,
      body: undefined,
      retryAfter: null,
    })
    const text = contextFor(new Response('Bad Gateway', { status: 502 }))
    expect((await batchPush([create], text.context)).refused?.body).toBe('Bad Gateway')
  })

  it('throws on a network failure', async () => {
    const { context } = contextFor(new TypeError('fetch failed'))
    await expect(batchPush([create], context)).rejects.toThrow('fetch failed')
  })
})

describe('restPush', () => {
  it("sends each entry to its resource's REST path with its key and etag", async () => {
    const { context, calls } = contextFor(
      json(201, { id: 't1', title: 'x' }, { ETag: '"1"' }),
      json(200, { id: 't1', done: true }, { ETag: '"2"' }),
      new Response(null, { status: 204 })
    )
    expect(await restPush([create, patch, remove], context)).toStrictEqual({
      results: [
        { key: 'k1', status: 201, etag: '"1"', data: { id: 't1', title: 'x' } },
        { key: 'k2', status: 200, etag: '"2"', data: { id: 't1', done: true } },
        { key: 'k3', status: 204 },
      ],
    })
    expect(calls).toStrictEqual([
      {
        url: 'https://api.test/api/tasks/',
        method: 'POST',
        headers: { 'Idempotency-Key': 'k1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x', id: 't1' }),
      },
      {
        url: 'https://api.test/api/tasks/t1/',
        method: 'PATCH',
        headers: { 'Idempotency-Key': 'k2', 'If-Match': '"1"', 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: true }),
      },
      {
        url: 'https://api.test/api/tasks/t1/',
        method: 'DELETE',
        headers: { 'Idempotency-Key': 'k3', 'If-Match': '"2"' },
        body: undefined,
      },
    ])
  })

  it('reads a 412 as the current row and its etag, and other failures as errors', async () => {
    const { context } = contextFor(
      json(412, { detail: 'stale', code: 'precondition_failed', current: { id: 't1' } }, { ETag: '"9"' }),
      json(412, { detail: 'stale' }),
      json(400, { title: ['required'] })
    )
    expect(await restPush([patch, patch, create], context)).toStrictEqual({
      results: [
        { key: 'k2', status: 412, etag: '"9"', current: { id: 't1' } },
        { key: 'k2', status: 412 },
        { key: 'k1', status: 400, errors: { title: ['required'] } },
      ],
    })
  })

  it('reads a 412 with no body as no current row', async () => {
    const { context } = contextFor(new Response(null, { status: 412 }))
    expect(await restPush([patch], context)).toStrictEqual({ results: [{ key: 'k2', status: 412 }] })
  })

  it('answers an unknown model itself, sending nothing', async () => {
    const { context, calls } = contextFor()
    expect(await restPush([{ ...create, model: 'nope' }], context)).toEqual({
      results: [{ key: 'k1', status: 404, errors: { code: 'sync_model_unknown' } }],
    })
    expect(calls).toStrictEqual([])
  })

  it('stops at a 429, keeping what ran before it', async () => {
    const { context, calls } = contextFor(json(201, { id: 't1' }), json(429, {}, { 'Retry-After': '3' }))
    expect(await restPush([create, patch, remove], context)).toStrictEqual({
      results: [{ key: 'k1', status: 201, data: { id: 't1' } }],
      refused: { status: 429, body: {}, retryAfter: 3 },
    })
    expect(calls).toHaveLength(2)
  })

  it('keeps a 2xx with no body as no data', async () => {
    const { context } = contextFor(new Response(null, { status: 200 }))
    expect(await restPush([patch], context)).toStrictEqual({ results: [{ key: 'k2', status: 200 }] })
  })
})
