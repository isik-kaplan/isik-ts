import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { type APIResult } from '../../src/hooks'
import { type RestResult, createRestClient, createStrictRestClient } from '../../src/rest'
import type { paths } from './paths'

type Sent = { url: string; method: string; headers: Record<string, string>; body: BodyInit | null | undefined }

function server(answer: (sent: Sent) => Response = () => json({})) {
  const sent: Sent[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body,
    }
    sent.push(call)
    return answer(call)
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent, spy: fetch }
}

function json(body: unknown, status = 200, type = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } })
}

const task = { id: 't1', title: 'Write', status: 'open' as const }

function client(answer?: (sent: Sent) => Response, options: Parameters<typeof createRestClient>[0] = {}) {
  const fake = server(answer)
  let n = 0
  const rest = createRestClient<paths>({
    baseUrl: 'https://api.test/',
    fetch: fake.fetch,
    generateKey: () => `key-${++n}`,
    ...options,
  })
  return { rest, ...fake }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a resource', () => {
  it('lists with a query, arrays repeated and empties left out', async () => {
    const { rest, sent } = client(() => json({ count: 1, results: [task] }))
    const tasks = rest.resource('/v0/tasks/{id}/')
    const result = await tasks.list({ query: { page: 2, status: ['open', 'done'] } })
    expect(sent[0]).toMatchObject({ url: 'https://api.test/v0/tasks/?page=2&status=open&status=done', method: 'GET' })
    expect(sent[0].headers['idempotency-key']).toBeUndefined()
    expect(result.data).toEqual({ count: 1, results: [task] })
    await tasks.list()
    expect(sent[1].url).toBe('https://api.test/v0/tasks/')
  })

  it('creates with a JSON body and a fresh key, or the key it is given', async () => {
    const { rest, sent } = client(() => json(task, 201))
    const tasks = rest.resource('/v0/tasks/{id}/')
    const created = await tasks.create({ title: 'Write' })
    expect(sent[0]).toMatchObject({ method: 'POST', body: '{"title":"Write"}' })
    expect(sent[0].headers).toMatchObject({ 'idempotency-key': 'key-1', 'content-type': 'application/json' })
    expect(created).toMatchObject({ data: task })
    await tasks.create({ title: 'Again' }, { idempotencyKey: 'mine' })
    expect(sent[1].headers['idempotency-key']).toBe('mine')
    await tasks.create({ title: 'Bare' }, { idempotencyKey: false })
    expect(sent[2].headers['idempotency-key']).toBeUndefined()
    await tasks.create({ title: 'Said' }, { idempotencyKey: { none: 'a script, run once' } })
    expect(sent[3].headers['idempotency-key']).toBeUndefined()
  })

  it('gets, updates, replaces and removes by id, encoding it', async () => {
    const { rest, sent } = client((call) =>
      call.method === 'DELETE' ? new Response(null, { status: 204 }) : json(task)
    )
    const tasks = rest.resource('/v0/tasks/{id}/')
    expect((await tasks.get('a/b', { query: { expand: 'project' } })).data).toEqual(task)
    expect(sent[0]).toMatchObject({ url: 'https://api.test/v0/tasks/a%2Fb/?expand=project', method: 'GET' })
    // A read sends no If-Match, no body and no Content-Type unless asked.
    expect(sent[0].headers).toEqual({})
    expect(sent[0].body).toBeUndefined()
    await tasks.update('t1', { status: 'done' }, { etag: '"v1"' })
    expect(sent[1]).toMatchObject({ method: 'PATCH', body: '{"status":"done"}' })
    expect(sent[1].headers).toMatchObject({ 'if-match': '"v1"', 'idempotency-key': 'key-1' })
    const removed = await tasks.remove('t1', { etag: '*', idempotencyKey: 'k' })
    expect(sent[2]).toMatchObject({ method: 'DELETE', url: 'https://api.test/v0/tasks/t1/' })
    expect(sent[2].headers).toMatchObject({ 'if-match': '*', 'idempotency-key': 'k' })
    expect(removed).toEqual({ data: undefined, response: expect.any(Response) })
    // No document declares PUT here, but the runtime has it for the ones that do.
    await (tasks as unknown as { replace: (id: string, body: unknown) => Promise<unknown> }).replace('t1', task)
    expect(sent[3]).toMatchObject({ method: 'PUT', url: 'https://api.test/v0/tasks/t1/' })
    expect(sent[3].headers['idempotency-key']).toBe('key-2')
  })

  it('runs actions on a row and on the collection', async () => {
    const { rest, sent } = client(() => json(task))
    const tasks = rest.resource('/v0/tasks/{id}/')
    await tasks.action('t1', 'post', 'archive/')
    expect(sent[0]).toMatchObject({ method: 'POST', url: 'https://api.test/v0/tasks/t1/archive/' })
    expect(sent[0].headers['idempotency-key']).toBe('key-1')
    await tasks.collectionAction('get', 'stats/')
    expect(sent[1]).toMatchObject({ method: 'GET', url: 'https://api.test/v0/tasks/stats/' })
  })

  it("binds a nested route's parent and takes the last parameter as the id", async () => {
    const { rest, sent } = client(() => json([]))
    const members = rest.resource('/v0/projects/{project}/members/{user}/', { project: 7 })
    await members.list()
    await members.remove(3)
    expect(sent.map((s) => s.url)).toEqual([
      'https://api.test/v0/projects/7/members/',
      'https://api.test/v0/projects/7/members/3/',
    ])
  })

  it('handles routes without a trailing slash, raw bodies and declared headers', async () => {
    const { rest, sent } = client(() => json({ slug: 's' }))
    const things = rest.resource('/v0/things/{slug}')
    await things.get('s', { headers: { 'X-Tenant': 'acme' } })
    expect(sent[0]).toMatchObject({ url: 'https://api.test/v0/things/s' })
    expect(sent[0].headers['x-tenant']).toBe('acme')
    const form = new FormData()
    form.append('file', new Blob(['x']), 'x.png')
    await things.action('s', 'put', 'thumbnail', { body: form })
    expect(sent[1]).toMatchObject({ url: 'https://api.test/v0/things/s/thumbnail', method: 'PUT', body: form })
    expect(sent[1].headers['content-type']).toBeUndefined()
    await (things as unknown as { list: () => Promise<unknown> }).list()
    expect(sent[2].url).toBe('https://api.test/v0/things')
    await (things as unknown as { collectionAction: (m: string, a: string) => Promise<unknown> }).collectionAction(
      'get',
      'recent'
    )
    expect(sent[3].url).toBe('https://api.test/v0/things/recent')
  })

  it('refuses a path that does not end in a parameter', () => {
    const { rest } = client()
    const loose = rest as unknown as { resource: (path: string) => unknown }
    expect(() => loose.resource('/v0/tasks/')).toThrow('rest: /v0/tasks/ does not end in a parameter')
    expect(() => loose.resource('/v0/tasks/{id}/archive/')).toThrow('does not end in a parameter')
    expect(() => loose.resource('/v0/tasks/{id')).toThrow('does not end in a parameter')
  })
})

describe('request', () => {
  it('reaches any operation, filling its path', async () => {
    const { rest, sent } = client(() => json([{ email: 'a@b.c' }]))
    const result = await rest.request('post', '/v0/account/email', { body: { email: 'a@b.c' } })
    expect(sent[0]).toMatchObject({ url: 'https://api.test/v0/account/email', method: 'POST' })
    expect(result.data).toEqual([{ email: 'a@b.c' }])
    await rest.request('get', '/v0/projects/{project}/members/', { path: { project: 1 } })
    expect(sent[1].url).toBe('https://api.test/v0/projects/1/members/')
  })

  it('refuses a missing path parameter', async () => {
    const { rest } = client()
    const loose = rest as unknown as { request: (m: string, p: string, o?: object) => Promise<unknown> }
    await expect(loose.request('get', '/v0/tasks/{id}/')).rejects.toThrow('rest: /v0/tasks/{id}/ needs its "id"')
    await expect(loose.request('get', '/v0/tasks/{id}/', { path: { id: null } })).rejects.toThrow('needs its "id"')
  })

  it('answers an error with its body, and keeps what is not JSON as text', async () => {
    const answers = [
      json({ title: ['Required.'] }, 400),
      new Response('Bad gateway', { status: 502, headers: { 'Content-Type': 'text/html' } }),
      new Response('', { status: 500 }),
      new Response('{nope', { status: 200, headers: { 'Content-Type': 'application/problem+json' } }),
      new Response('plain', { status: 200 }),
      json({ ok: 1 }, 200, 'application/vnd.api+json; charset=utf-8'),
      new Response(null, { status: 205 }),
      new Response(null, { status: 304 }),
    ]
    const { rest } = client(() => answers.shift() as Response)
    const tasks = rest.resource('/v0/tasks/{id}/')
    const failed = await tasks.create({ title: '' })
    expect(failed).toMatchObject({ error: { title: ['Required.'] } })
    expect(failed.response.status).toBe(400)
    expect((await tasks.list()).error).toBe('Bad gateway')
    expect((await tasks.list()).error).toBe('')
    expect((await tasks.list()).data).toBe('{nope')
    expect((await tasks.list()).data).toBe('plain')
    expect((await tasks.list()).data).toEqual({ ok: 1 })
    expect(await tasks.list()).toEqual({ data: undefined, response: expect.any(Response) })
    const notModified = await tasks.list()
    expect(notModified).toMatchObject({ error: '' })
  })

  it('keeps a body with no Content-Type as text', async () => {
    const { rest } = client(() => {
      const response = new Response('{"a":1}')
      response.headers.delete('Content-Type')
      return response
    })
    expect((await rest.request('get', '/v0/tasks/stats/')).data).toBe('{"a":1}')
  })

  it('reads no body for HEAD', async () => {
    const { rest, sent } = client(() => new Response(null, { status: 200 }))
    const loose = rest as unknown as { request: (m: string, p: string) => Promise<{ data: unknown }> }
    expect((await loose.request('head', '/v0/health')).data).toBeUndefined()
    expect(sent[0].method).toBe('HEAD')
  })

  it('sends dates as ISO strings and passes the signal through', async () => {
    const { rest, sent, spy } = client()
    const controller = new AbortController()
    const loose = rest as unknown as { request: (m: string, p: string, o: object) => Promise<unknown> }
    await loose.request('get', '/v0/tasks/', {
      query: { since: new Date(0), none: null, missing: undefined, list: [undefined] },
      signal: controller.signal,
    })
    expect(sent[0].url).toBe('https://api.test/v0/tasks/?since=1970-01-01T00%3A00%3A00.000Z')
    expect(spy.mock.calls[0][1]?.signal).toBe(controller.signal)
  })

  it('sends raw bodies as they are', async () => {
    const { rest, sent } = client()
    const loose = rest as unknown as { request: (m: string, p: string, o: object) => Promise<unknown> }
    const bodies = [
      new URLSearchParams('a=1'),
      new Blob(['b']),
      new ArrayBuffer(1),
      new Uint8Array(1),
      new ReadableStream(),
    ]
    for (const body of bodies) await loose.request('post', '/v0/account/email', { body })
    expect(sent.map((s) => s.body)).toEqual(bodies)
    expect(
      sent.every((s) => s.headers['content-type'] === undefined || !s.headers['content-type'].includes('json'))
    ).toBe(true)
  })

  it('sends JSON where the runtime has no ReadableStream, as Hermes lacks it', async () => {
    // The answer is built first: this runtime's own Response needs ReadableStream.
    const answer = json([])
    const { rest, sent } = client(() => answer)
    vi.stubGlobal('ReadableStream', undefined)
    const sending = rest.request('post', '/v0/account/email', { body: { email: 'a' } })
    vi.unstubAllGlobals()
    await sending
    expect(sent[0].body).toBe('{"email":"a"}')
  })

  it("keeps a caller's own Content-Type for a JSON body", async () => {
    const { rest, sent } = client()
    await rest.request('post', '/v0/account/email', {
      body: { email: 'a@b.c' },
      headers: { 'Content-Type': 'application/merge-patch+json' },
    })
    expect(sent[0].headers['content-type']).toBe('application/merge-patch+json')
  })
})

describe('the client', () => {
  it('sends its headers, from a function per request', async () => {
    let token = 'one'
    const { rest, sent } = client(undefined, { headers: () => ({ Authorization: `Bearer ${token}` }) })
    await rest.request('get', '/v0/tasks/stats/')
    token = 'two'
    await rest.request('get', '/v0/tasks/stats/')
    expect(sent.map((s) => s.headers.authorization)).toEqual(['Bearer one', 'Bearer two'])
    const fixed = client(undefined, { headers: { 'Accept-Language': 'tr' } })
    await fixed.rest.request('get', '/v0/tasks/stats/')
    expect(fixed.sent[0].headers['accept-language']).toBe('tr')
  })

  it('mints no key when generateKey is null, and a v4 UUID by default', async () => {
    const none = client(undefined, { generateKey: null })
    await none.rest.request('post', '/v0/account/email', { body: { email: 'a@b.c' } })
    expect(none.sent[0].headers['idempotency-key']).toBeUndefined()
    const fake = server()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('0-0-0-0-0')
    await createRestClient<paths>({ fetch: fake.fetch }).request('post', '/v0/account/email', { body: { email: 'x' } })
    expect(fake.sent[0]).toMatchObject({ url: '/v0/account/email' })
    expect(fake.sent[0].headers['idempotency-key']).toBe('0-0-0-0-0')
  })

  it('names itself when the runtime has no random source', async () => {
    vi.stubGlobal('crypto', {})
    const fake = server()
    const rest = createRestClient<paths>({ fetch: fake.fetch })
    await expect(rest.request('post', '/v0/account/email', { body: { email: 'x' } })).rejects.toThrow(
      /^createRestClient: this runtime has neither/
    )
  })

  it('uses the global fetch, looked up per call', async () => {
    const first = server()
    vi.stubGlobal('fetch', first.fetch)
    const rest = createRestClient<paths>()
    await rest.request('get', '/v0/tasks/stats/')
    const second = server()
    vi.stubGlobal('fetch', second.fetch)
    await rest.request('get', '/v0/tasks/stats/')
    expect([first.sent.length, second.sent.length]).toEqual([1, 1])
  })
})

describe('a strict client', () => {
  it('sends the key it is given, none for a reason, and refuses a write that names neither', async () => {
    const fake = server()
    const strict = createStrictRestClient<paths>({ baseUrl: 'https://api.test', fetch: fake.fetch })
    await strict.request('post', '/v0/account/email', { body: { email: 'a' }, idempotencyKey: 'k' })
    await strict.request('post', '/v0/account/email', { body: { email: 'a' }, idempotencyKey: { none: 'why' } })
    await strict.request('get', '/v0/tasks/stats/')
    expect(fake.sent.map((s) => s.headers['idempotency-key'])).toEqual(['k', undefined, undefined])
    const loose = strict as unknown as {
      resource: (p: string) => { remove: (id: string, options?: { idempotencyKey?: unknown }) => Promise<unknown> }
    }
    const tasks = loose.resource('/v0/tasks/{id}/')
    const message = "rest: DELETE /v0/tasks/{id}/ names no idempotencyKey - pass one, or { none: 'the reason' }"
    await expect(tasks.remove('t1')).rejects.toThrow(message)
    for (const idempotencyKey of [false, null, {}, { none: 1 }, { none: '  ' }]) {
      await expect(tasks.remove('t1', { idempotencyKey })).rejects.toThrow(message)
    }
    expect(fake.sent).toHaveLength(3)
  })
})

describe('the types', () => {
  // Compile-time only: each check is a function that is never called.
  const restClient = () => createRestClient<paths>({ fetch: server().fetch })

  it('are read off the document: results, bodies, ids, and only the operations it has', () => {
    const rest = restClient()
    const tasks = rest.resource('/v0/tasks/{id}/')
    expectTypeOf(tasks.get).parameter(0).toEqualTypeOf<string>()
    expectTypeOf<Awaited<ReturnType<typeof tasks.get>>['data']>().toEqualTypeOf<
      { id: string; title: string; status: 'open' | 'done' } | undefined
    >()
    expectTypeOf<Awaited<ReturnType<typeof tasks.list>>['data']>().toEqualTypeOf<
      { count: number; results: { id: string; title: string; status: 'open' | 'done' }[] } | undefined
    >()
    expectTypeOf(tasks).not.toHaveProperty('replace')
    expectTypeOf(rest.resource('/v0/projects/{project}/members/{user}/', { project: 1 }).remove)
      .parameter(0)
      .toEqualTypeOf<number>()
    expectTypeOf(rest.resource('/v0/things/{slug}')).not.toHaveProperty('list')
    // A result fits the submit hooks as it is.
    expectTypeOf<RestResult<paths['/v0/tasks/']['post']>>().toMatchTypeOf<APIResult>()
    // No success declared answers unknown; no error declared, unknown too.
    expectTypeOf<
      Awaited<ReturnType<typeof tasks.collectionAction<'stats/', 'get'>>>['error']
    >().toEqualTypeOf<unknown>()
    expectTypeOf<RestResult<{ responses: {} }>['data']>().toEqualTypeOf<unknown>()
    expectTypeOf<RestResult<{ responses: { 204: { content?: never } } }>['data']>().toEqualTypeOf<undefined>()
  })

  it('refuse what the document does not allow', () => {
    const rest = restClient()
    const tasks = rest.resource('/v0/tasks/{id}/')
    const refused = [
      // @ts-expect-error - a status the schema does not list
      () => tasks.create({ title: 'x', status: 'archived' }),
      // @ts-expect-error - title is required
      () => tasks.create({}),
      // @ts-expect-error - the etag is required, since the document requires If-Match
      () => tasks.update('t1', { title: 'x' }),
      // @ts-expect-error - and here too
      () => tasks.remove('t1'),
      // @ts-expect-error - no such action
      () => tasks.action('t1', 'post', 'explode/'),
      // @ts-expect-error - archive/ takes no GET
      () => tasks.action('t1', 'get', 'archive/'),
      // @ts-expect-error - a nested route needs its parent
      () => rest.resource('/v0/projects/{project}/members/{user}/'),
      // @ts-expect-error - not a detail path
      () => rest.resource('/v0/tasks/'),
      // @ts-expect-error - the declared header is required
      () => rest.resource('/v0/things/{slug}').get('s'),
      // @ts-expect-error - a path the document lacks
      () => rest.request('get', '/v0/nope/'),
      // @ts-expect-error - a method the path lacks
      () => rest.request('delete', '/v0/tasks/'),
      // @ts-expect-error - its path parameter is required
      () => rest.request('get', '/v0/tasks/{id}/'),
      // @ts-expect-error - a body the operation does not take
      () => tasks.get('t1', { body: {} }),
      // @ts-expect-error - a query parameter it does not take
      () => tasks.list({ query: { nope: 1 } }),
    ]
    expect(refused).toHaveLength(14)
  })

  it('make a strict client name the key of every write, and only of writes', () => {
    const strict = createStrictRestClient<paths>({ fetch: server().fetch })
    const strictTasks = strict.resource('/v0/tasks/{id}/')
    const allowed = [
      () => strictTasks.list(),
      () => strictTasks.get('t1'),
      () => strictTasks.collectionAction('get', 'stats/'),
      () => strictTasks.create({ title: 'x' }, { idempotencyKey: 'k' }),
      () => strictTasks.update('t1', {}, { etag: '"1"', idempotencyKey: { none: 'a reason' } }),
      () => strict.request('post', '/v0/account/email', { body: { email: 'a' }, idempotencyKey: 'k' }),
    ]
    const refused = [
      // @ts-expect-error - a create without its key
      () => strictTasks.create({ title: 'x' }),
      // @ts-expect-error - an update without one
      () => strictTasks.update('t1', {}, { etag: '"1"' }),
      // @ts-expect-error - a delete without one
      () => strictTasks.remove('t1', { etag: '"1"' }),
      // @ts-expect-error - an action without one
      () => strictTasks.action('t1', 'post', 'archive/'),
      // @ts-expect-error - a bare request without one
      () => strict.request('post', '/v0/account/email', { body: { email: 'a' } }),
      // @ts-expect-error - a bare false, with no reason
      () => strictTasks.create({ title: 'x' }, { idempotencyKey: false }),
      // @ts-expect-error - a nested route's delete without one
      () => strict.resource('/v0/projects/{project}/members/{user}/', { project: 1 }).remove(2),
    ]
    expect([allowed.length, refused.length]).toEqual([6, 7])
  })
})
