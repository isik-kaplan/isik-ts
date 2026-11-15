import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { APIResult } from '../../src/hooks'
import { createClient as declaredClient } from './generated/client.declared'
import { type Result, createClient } from './generated/client.every-write'
import { createClient as mintedClient } from './generated/client.minted'
import { createClient as prefixedClient } from './generated/client.prefixed'

// What the generated client does at runtime, and what its types allow - against the committed output
// for tests/codegen/fixture.yml.

type Sent = { url: string; method: string; headers: Record<string, string>; body: BodyInit | null | undefined }

function json(body: unknown, status = 200, type = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } })
}

function server(answer: (sent: Sent) => Response = () => json({})) {
  const sent: Sent[] = []
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body,
    }
    sent.push(call)
    return answer(call)
  })
  return { fetch: spy as unknown as typeof fetch, sent, spy }
}

const task = { id: 't1', title: 'Write', status: 'open' as const }
const key = { idempotencyKey: 'k' }

function client(answer?: (sent: Sent) => Response, headers?: HeadersInit | (() => HeadersInit)) {
  const fake = server(answer)
  return { api: createClient({ baseUrl: 'https://api.test/', fetch: fake.fetch, headers }), ...fake }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a generated resource', () => {
  it('lists with a query, arrays repeated and empties left out', async () => {
    const { api, sent } = client(() => json({ count: 1, results: [task] }))
    const result = await api.tasks.list({ query: { page: 2, status: ['open', 'done'] } })
    expect(sent[0]).toMatchObject({ url: 'https://api.test/v0/tasks/?page=2&status=open&status=done', method: 'GET' })
    expect(sent[0].headers).toEqual({})
    expect(result.data).toEqual({ count: 1, results: [task] })
    await api.tasks.list()
    expect(sent[1].url).toBe('https://api.test/v0/tasks/')
  })

  it('creates with a JSON body and the key it is given, or none for a reason', async () => {
    const { api, sent } = client(() => json(task, 201))
    expect(await api.tasks.create({ title: 'Write' }, key)).toMatchObject({ data: task })
    expect(sent[0]).toMatchObject({ method: 'POST', body: '{"title":"Write"}' })
    expect(sent[0].headers).toEqual({ 'idempotency-key': 'k', 'content-type': 'application/json' })
    await api.tasks.create({ title: 'Again' }, { idempotencyKey: { none: 'a script, run once' } })
    expect(sent[1].headers['idempotency-key']).toBeUndefined()
  })

  it('gets, updates and removes by id, encoding it', async () => {
    const { api, sent } = client((call) =>
      call.method === 'DELETE' ? new Response(null, { status: 204 }) : json(task)
    )
    expect((await api.tasks.get('a/b', { query: { expand: 'project' } })).data).toEqual(task)
    expect(sent[0]).toMatchObject({ url: 'https://api.test/v0/tasks/a%2Fb/?expand=project', method: 'GET' })
    expect(sent[0].body).toBeUndefined()
    await api.tasks.update('t1', { status: 'done' }, { etag: '"v1"', ...key, headers: { 'X-Request-Source': 'web' } })
    expect(sent[1]).toMatchObject({ method: 'PATCH', body: '{"status":"done"}' })
    expect(sent[1].headers).toMatchObject({ 'if-match': '"v1"', 'idempotency-key': 'k', 'x-request-source': 'web' })
    expect(await api.tasks.remove('t1', { etag: '*', ...key })).toEqual({
      data: undefined,
      response: expect.any(Response),
    })
    expect(sent[2]).toMatchObject({ method: 'DELETE', url: 'https://api.test/v0/tasks/t1/' })
  })

  it('names its actions: one method bare, several by verb, a clash by verb too', async () => {
    const { api, sent } = client()
    await api.tasks.archive('t1', key)
    await api.tasks.getPreferences('t1')
    await api.tasks.postPreferences('t1', { muted: true }, key)
    await api.tasks.stats('t1')
    await api.tasks.getStats()
    await api.tasks.getList()
    await api.users.getMe()
    await api.users.patchMe({ name: 'n' }, key)
    expect(sent.map((s) => `${s.method} ${s.url.replace('https://api.test', '')}`)).toEqual([
      'POST /v0/tasks/t1/archive/',
      'GET /v0/tasks/t1/preferences/',
      'POST /v0/tasks/t1/preferences/',
      'GET /v0/tasks/t1/stats/',
      'GET /v0/tasks/stats/',
      'GET /v0/tasks/list/',
      'GET /v0/users/me/',
      'PATCH /v0/users/me/',
    ])
  })

  it("passes a nested route's parent first, and the rest of a path's parameters in options", async () => {
    const { api, sent } = client(() => new Response('a,b', { headers: { 'Content-Type': 'text/csv' } }))
    await api.projectsMembers.list(7)
    await api.projectsMembers.remove(7, 3, key)
    const report = await api.teams.kindPeriodReport(1, {
      path: { kind: 'weekly', period: 2 },
      query: { since: '2026-01-01' },
    })
    expect(report.data).toBe('a,b')
    expect(sent.map((s) => s.url)).toEqual([
      'https://api.test/v0/projects/7/members/',
      'https://api.test/v0/projects/7/members/3/',
      'https://api.test/v0/teams/1/weekly-2-report/?since=2026-01-01',
    ])
  })

  it('names the methods of a path with no detail by their verbs, slash or not', async () => {
    const { api, sent } = client(() => json([]))
    await api.accountEmail.get()
    await api.accountEmail.post({ email: 'a@b.c' }, key)
    await api.accountEmail.delete({ email: 'a@b.c' }, key)
    await api.features.get()
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      'GET https://api.test/v0/account/email',
      'POST https://api.test/v0/account/email',
      'DELETE https://api.test/v0/account/email',
      'GET https://api.test/v0/features/',
    ])
  })

  it('sends declared headers and raw bodies as they are', async () => {
    const { api, sent } = client(() => json({ slug: 's' }))
    await api.things.list()
    await api.things.get('s', { headers: { 'X-Tenant': 'acme' } })
    expect(sent[0]).toMatchObject({ url: 'https://api.test/v0/things' })
    expect(sent[1]).toMatchObject({ url: 'https://api.test/v0/things/s' })
    expect(sent[1].headers['x-tenant']).toBe('acme')
    const form = new FormData()
    form.append('file', new Blob(['x']), 'x.png')
    await api.things.thumbnail('s', form as never, key)
    expect(sent[2]).toMatchObject({ url: 'https://api.test/v0/things/s/thumbnail', method: 'PUT', body: form })
    expect(sent[2].headers['content-type']).toBeUndefined()
  })
})

describe('the generated runtime', () => {
  it('answers an error with its body, and keeps what is not JSON as text', async () => {
    const answers = [
      json({ title: ['Required.'] }, 400),
      new Response('Bad gateway', { status: 502, headers: { 'Content-Type': 'text/html' } }),
      new Response('', { status: 500 }),
      new Response('{nope', { status: 200, headers: { 'Content-Type': 'application/problem+json' } }),
      json({ ok: 1 }, 200, 'application/vnd.api+json; charset=utf-8'),
      new Response(null, { status: 205 }),
    ]
    const { api } = client(() => answers.shift() as Response)
    const failed = await api.tasks.create({ title: '' }, key)
    expect(failed).toMatchObject({ error: { title: ['Required.'] } })
    expect(failed.response.status).toBe(400)
    expect((await api.tasks.list()).error).toBe('Bad gateway')
    expect((await api.tasks.list()).error).toBe('')
    expect((await api.tasks.list()).data).toBe('{nope')
    expect((await api.tasks.list()).data).toEqual({ ok: 1 })
    expect(await api.tasks.list()).toEqual({ data: undefined, response: expect.any(Response) })
  })

  it('keeps a body with no Content-Type as text', async () => {
    const { api } = client(() => {
      const response = new Response('{"a":1}')
      response.headers.delete('Content-Type')
      return response
    })
    expect((await api.features.get()).data).toBe('{"a":1}')
  })

  it('refuses a missing path parameter', async () => {
    const { api } = client()
    await expect(api.tasks.get(undefined as never)).rejects.toThrow('/v0/tasks/{id}/ needs its "id"')
    await expect(api.tasks.get(null as never)).rejects.toThrow('needs its "id"')
  })

  it('sends dates as ISO strings, leaves out undefined and null, and passes the signal', async () => {
    const { api, sent, spy } = client()
    const controller = new AbortController()
    const query = { page: new Date(0), status: [undefined, null], other: undefined } as never
    await api.tasks.list({ query, signal: controller.signal })
    expect(sent[0].url).toBe('https://api.test/v0/tasks/?page=1970-01-01T00%3A00%3A00.000Z')
    expect(spy.mock.calls[0][1]?.signal).toBe(controller.signal)
  })

  it('sends every kind of raw body as it is, and JSON where there is no ReadableStream', async () => {
    const { api, sent } = client()
    const bodies = [
      new URLSearchParams('a=1'),
      new Blob(['b']),
      new ArrayBuffer(1),
      new Uint8Array(1),
      new ReadableStream(),
    ]
    for (const body of bodies) await api.accountEmail.post(body as never, key)
    expect(sent.map((s) => s.body)).toEqual(bodies)
    // The answer is built first: this runtime's own Response needs ReadableStream.
    const answer = json([])
    const bare = client(() => answer)
    vi.stubGlobal('ReadableStream', undefined)
    const sending = bare.api.accountEmail.post({ email: 'a' }, key)
    vi.unstubAllGlobals()
    await sending
    expect(bare.sent[0].body).toBe('{"email":"a"}')
  })

  it("keeps a caller's own Content-Type", async () => {
    const { api, sent } = client()
    await api.accountEmail.post({ email: 'a' }, { ...key, headers: { 'Content-Type': 'application/merge-patch+json' } })
    expect(sent[0].headers['content-type']).toBe('application/merge-patch+json')
  })

  it('sends its headers, from a function per request', async () => {
    let token = 'one'
    const { api, sent } = client(undefined, () => ({ Authorization: `Bearer ${token}` }))
    await api.features.get()
    token = 'two'
    await api.features.get()
    expect(sent.map((s) => s.headers.authorization)).toEqual(['Bearer one', 'Bearer two'])
    const fixed = client(undefined, { 'Accept-Language': 'tr' })
    await fixed.api.features.get()
    expect(fixed.sent[0].headers['accept-language']).toBe('tr')
  })

  it('uses the global fetch, looked up per call, with no base URL', async () => {
    const first = server()
    vi.stubGlobal('fetch', first.fetch)
    const api = createClient()
    await api.features.get()
    const second = server()
    vi.stubGlobal('fetch', second.fetch)
    await api.features.get()
    expect([first.sent[0].url, second.sent.length]).toEqual(['/v0/features/', 1])
  })
})

describe('a parameter in the shared prefix', () => {
  it('is filled from the client, and a call can still name its own', async () => {
    const fake = server()
    const api = prefixedClient({ fetch: fake.fetch, pathParams: { client: 'browser' }, generateKey: null })
    await api.login.post({ email: 'a', password: 'b' })
    await api.session.get()
    await api.session.delete()
    expect(fake.sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      'POST /_allauth/browser/v1/auth/login',
      'GET /_allauth/browser/v1/auth/session',
      'DELETE /_allauth/browser/v1/auth/session',
    ])
    // @ts-expect-error - the client must be told it
    expect(() => prefixedClient({ fetch: fake.fetch })).not.toThrow()
  })
})

describe('the key rules', () => {
  const message = "DELETE /v0/tasks/{id}/ names no idempotencyKey - pass one, or { none: 'the reason' }"

  it('every-write: refuses a write that names no key, or a malformed opt-out, before sending', async () => {
    const { api, sent } = client()
    for (const idempotencyKey of [undefined, false, null, {}, { none: 1 }, { none: '  ' }]) {
      await expect(api.tasks.remove('t1', { etag: '*', idempotencyKey } as never)).rejects.toThrow(message)
    }
    expect(sent).toHaveLength(0)
  })

  it('declared: lets an undeclared write go without a key, and holds a declared one to it', async () => {
    const fake = server()
    const api = declaredClient({ fetch: fake.fetch })
    await api.tasks.postPreferences('t1', { muted: true })
    await api.accountEmail.post({ email: 'a' }, { idempotencyKey: 'k' })
    expect(fake.sent.map((s) => s.headers['idempotency-key'])).toEqual([undefined, 'k'])
    await expect(api.tasks.remove('t1', { etag: '*' } as never)).rejects.toThrow(message)
    await expect(api.accountEmail.post({ email: 'a' }, { idempotencyKey: false } as never)).rejects.toThrow(
      'names no idempotencyKey'
    )
  })

  it('minted: mints a key for a write that names none, and sends none when told', async () => {
    const fake = server()
    let n = 0
    const api = mintedClient({ fetch: fake.fetch, generateKey: () => `key-${++n}` })
    await api.tasks.create({ title: 't' })
    await api.tasks.create({ title: 't' }, { idempotencyKey: 'mine' })
    await api.tasks.create({ title: 't' }, { idempotencyKey: false })
    await api.tasks.create({ title: 't' }, { idempotencyKey: { none: 'why' } })
    await api.tasks.list()
    await mintedClient({ fetch: fake.fetch, generateKey: null }).tasks.create({ title: 't' })
    expect(fake.sent.map((s) => s.headers['idempotency-key'])).toEqual([
      'key-1',
      'mine',
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('minted: a v4 UUID by default, from getRandomValues where randomUUID is missing', async () => {
    const fake = server()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('0-0-0-0-0')
    await mintedClient({ fetch: fake.fetch }).tasks.create({ title: 't' })
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff) })
    await mintedClient({ fetch: fake.fetch }).tasks.create({ title: 't' })
    vi.stubGlobal('crypto', {})
    await expect(mintedClient({ fetch: fake.fetch }).tasks.create({ title: 't' })).rejects.toThrow(
      /^this runtime has neither crypto.randomUUID nor crypto.getRandomValues/
    )
    expect(fake.sent.map((s) => s.headers['idempotency-key'])).toEqual([
      '0-0-0-0-0',
      'ffffffff-ffff-4fff-bfff-ffffffffffff',
    ])
  })
})

describe('the generated types', () => {
  const api = createClient()

  it('are read off the document', () => {
    expectTypeOf(api.tasks.get).parameter(0).toEqualTypeOf<string>()
    expectTypeOf<Awaited<ReturnType<typeof api.tasks.get>>['data']>().toEqualTypeOf<
      { readonly id: string; title: string; status: 'open' | 'done' } | undefined
    >()
    expectTypeOf(api.users.get).parameter(0).toEqualTypeOf<number>()
    expectTypeOf(api.tasks).not.toHaveProperty('replace')
    expectTypeOf(api.users).not.toHaveProperty('list')
    expectTypeOf<Result<'/v0/tasks/', 'post'>>().toMatchTypeOf<APIResult>()
    expectTypeOf<Awaited<ReturnType<typeof api.features.get>>['error']>().toEqualTypeOf<unknown>()
    expectTypeOf<Awaited<ReturnType<typeof api.things.get>>['error']>().toEqualTypeOf<{ message: string } | undefined>()
  })

  it('refuse what the document does not allow', () => {
    const declared = declaredClient()
    const minted = mintedClient()
    const refused = [
      // @ts-expect-error - a status the schema does not list
      () => api.tasks.create({ title: 'x', status: 'archived' }, key),
      // @ts-expect-error - title is required
      () => api.tasks.create({}, key),
      // @ts-expect-error - every-write: a create without its key
      () => api.tasks.create({ title: 'x' }),
      // @ts-expect-error - a bare false, with no reason
      () => api.tasks.create({ title: 'x' }, { idempotencyKey: false }),
      // @ts-expect-error - the etag is required, since the document requires If-Match
      () => api.tasks.update('t1', {}, key),
      // @ts-expect-error - a number id for a string one
      () => api.tasks.get(1),
      // @ts-expect-error - a query parameter it does not take
      () => api.tasks.list({ query: { nope: 1 } }),
      // @ts-expect-error - a nested route needs its parent
      () => api.projectsMembers.remove(3, key),
      // @ts-expect-error - the declared header is required
      () => api.things.get('s'),
      // @ts-expect-error - the rest of the path, and the required query
      () => api.teams.kindPeriodReport(1),
      // @ts-expect-error - declared: the create declares the header, so its key is required
      () => declared.tasks.create({ title: 'x' }),
      // @ts-expect-error - declared: still no bare false
      () => declared.tasks.postPreferences('t1', { muted: true }, { idempotencyKey: false }),
      // @ts-expect-error - minted: a GET takes no key at all
      () => minted.tasks.list({ idempotencyKey: 'k' }),
    ]
    expect(refused).toHaveLength(13)
  })
})
