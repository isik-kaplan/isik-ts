import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDjangoFetch, nameFetchFailures } from '../../src/http'

type Sent = { input: RequestInfo | URL; init: RequestInit | undefined }

function recorder(answer: (input: RequestInfo | URL) => Promise<Response> = async () => new Response('ok')) {
  const sent: Sent[] = []
  const baseFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ input, init })
    return answer(input)
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
  return { sent, baseFetch }
}

function headersOf(sent: Sent): Record<string, string> {
  return Object.fromEntries(new Headers(sent.init?.headers).entries())
}

function clearCookies() {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim()
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`
  }
}

describe('nameFetchFailures', () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })

  async function failureOf(input: RequestInfo | URL, init?: RequestInit, options?: { includeQuery?: boolean }) {
    const wrapped = nameFetchFailures(async () => Promise.reject(refused), options)
    return wrapped(input, init).then(
      () => undefined,
      (error: Error) => error
    )
  }

  it('passes a response through untouched', async () => {
    const response = new Response('ok')
    const wrapped = nameFetchFailures(async () => response)
    await expect(wrapped('https://api.test/a')).resolves.toBe(response)
  })

  it('names the method, the URL and the code, and keeps the original as cause', async () => {
    const error = await failureOf('https://api.test/v0/orders/', { method: 'post' })
    expect(error?.message).toBe('fetch failed: POST https://api.test/v0/orders/ (ECONNREFUSED)')
    expect(error?.cause).toBe(refused)
  })

  it("reads a Request's method and URL", async () => {
    const error = await failureOf(new Request('https://api.test/v0/me/', { method: 'PATCH' }))
    expect(error?.message).toBe('fetch failed: PATCH https://api.test/v0/me/ (ECONNREFUSED)')
  })

  it("prefers init's method to the Request's", async () => {
    const error = await failureOf(new Request('https://api.test/a', { method: 'PATCH' }), { method: 'DELETE' })
    expect(error?.message).toBe('fetch failed: DELETE https://api.test/a (ECONNREFUSED)')
  })

  it('defaults to GET, and reads a URL object', async () => {
    const error = await failureOf(new URL('https://api.test/a'))
    expect(error?.message).toBe('fetch failed: GET https://api.test/a (ECONNREFUSED)')
  })

  it.each([
    ['an absolute URL', 'https://api.test/a?token=secret#frag', 'https://api.test/a'],
    ['a relative URL', '/a/b?token=secret', '/a/b'],
    ['a fragment alone', '/a#token=secret', '/a'],
  ])('leaves the query and fragment out of %s', async (_, input, named) => {
    const error = await failureOf(input)
    expect(error?.message).toBe(`fetch failed: GET ${named} (ECONNREFUSED)`)
  })

  it('keeps the query when asked', async () => {
    const error = await failureOf('https://api.test/a?page=2', undefined, { includeQuery: true })
    expect(error?.message).toBe('fetch failed: GET https://api.test/a?page=2 (ECONNREFUSED)')
  })

  it.each([
    ['no cause', new TypeError('fetch failed')],
    ['a cause with no code', Object.assign(new TypeError('x'), { cause: {} })],
    ['a code that is not a string', Object.assign(new TypeError('x'), { cause: { code: 7 } })],
    ['something that is not an error', null],
  ])('names no code for %s', async (_, thrown) => {
    const wrapped = nameFetchFailures(async () => Promise.reject(thrown))
    const error = (await wrapped('https://api.test/a').catch((caught: unknown) => caught)) as Error
    expect(error.message).toBe('fetch failed: GET https://api.test/a')
    expect(error.cause).toBe(thrown)
  })
})

describe('createDjangoFetch in the browser', () => {
  const API = 'http://localhost:3000'

  afterEach(() => {
    clearCookies()
  })

  it('refuses a base URL that is not absolute', () => {
    expect(() => createDjangoFetch({ baseUrl: '/api' })).toThrow(
      new TypeError('createDjangoFetch: baseUrl "/api" is not an absolute URL')
    )
  })

  it("sends the CSRF cookie as Django's header, with credentials, to the base origin", async () => {
    document.cookie = 'csrftoken=tok'
    const { sent, baseFetch } = recorder()
    await createDjangoFetch({ baseUrl: `${API}/api/`, baseFetch })(`${API}/api/x/`, { method: 'POST' })
    expect(headersOf(sent[0])).toEqual({ 'x-csrftoken': 'tok' })
    expect(sent[0].init?.credentials).toBe('include')
    expect(sent[0].init?.method).toBe('POST')
  })

  it('reads a relative URL against the page, which here is the API', async () => {
    document.cookie = 'csrftoken=tok'
    const { sent, baseFetch } = recorder()
    await createDjangoFetch({ baseUrl: API, baseFetch })('/api/x/')
    expect(headersOf(sent[0])).toEqual({ 'x-csrftoken': 'tok' })
  })

  it('takes custom cookie and header names, and credentials', async () => {
    document.cookie = 'mycsrf=tok'
    const { sent, baseFetch } = recorder()
    const djangoFetch = createDjangoFetch({
      baseUrl: API,
      baseFetch,
      csrfCookieName: 'mycsrf',
      csrfHeaderName: 'X-My-CSRF',
      credentials: 'same-origin',
    })
    await djangoFetch(`${API}/x`)
    expect(headersOf(sent[0])).toEqual({ 'x-my-csrf': 'tok' })
    expect(sent[0].init?.credentials).toBe('same-origin')
  })

  it("keeps a Request's own headers, with init's winning", async () => {
    const { sent, baseFetch } = recorder()
    const request = new Request(`${API}/x`, { method: 'PATCH', headers: { 'If-Match': '"v1"', Accept: 'a' } })
    await createDjangoFetch({ baseUrl: API, baseFetch })(request, { headers: { Accept: 'b' } })
    expect(sent[0].input).toBe(request)
    expect(headersOf(sent[0])).toEqual({ 'if-match': '"v1"', accept: 'b' })
  })

  it('sends neither the token nor credentials to another origin', async () => {
    document.cookie = 'csrftoken=tok'
    const { sent, baseFetch } = recorder()
    await createDjangoFetch({ baseUrl: API, baseFetch })('https://elsewhere.test/x', {
      method: 'POST',
      headers: { A: '1' },
    })
    expect(headersOf(sent[0])).toEqual({ a: '1' })
    expect(sent[0].init?.credentials).toBeUndefined()
  })

  it('keeps the caller’s own credentials on a request it does not trust', async () => {
    const { sent, baseFetch } = recorder()
    await createDjangoFetch({ baseUrl: API, baseFetch })('https://elsewhere.test/x', { credentials: 'omit' })
    expect(sent[0].init?.credentials).toBe('omit')
  })

  it('sends them to the origins in forwardTo, and only those', async () => {
    document.cookie = 'csrftoken=tok'
    const { sent, baseFetch } = recorder()
    const djangoFetch = createDjangoFetch({ baseUrl: API, baseFetch, forwardTo: ['https://auth.test'] })
    await djangoFetch('https://auth.test/x')
    await djangoFetch(`${API}/x`)
    expect(headersOf(sent[0])).toEqual({ 'x-csrftoken': 'tok' })
    expect(headersOf(sent[1])).toEqual({})
  })

  it("sends them anywhere with forwardTo: 'any'", async () => {
    document.cookie = 'csrftoken=tok'
    const { sent, baseFetch } = recorder()
    await createDjangoFetch({ baseUrl: API, baseFetch, forwardTo: 'any' })('https://elsewhere.test/x')
    expect(headersOf(sent[0])).toEqual({ 'x-csrftoken': 'tok' })
  })

  it('sends no token when there is no cookie and no primeUrl', async () => {
    const { sent, baseFetch } = recorder()
    await createDjangoFetch({ baseUrl: API, baseFetch })(`${API}/x`, { method: 'POST' })
    expect(headersOf(sent[0])).toEqual({})
  })

  describe('primeUrl', () => {
    function primingFetch() {
      const { sent, baseFetch } = recorder(async (input) => {
        if (String(input) === `${API}/csrf/`) document.cookie = 'csrftoken=primed'
        return new Response('ok')
      })
      return { sent, djangoFetch: createDjangoFetch({ baseUrl: API, baseFetch, primeUrl: `${API}/csrf/` }), baseFetch }
    }

    it('primes once before an unsafe request with no cookie, then sends the token', async () => {
      const { sent, djangoFetch } = primingFetch()
      await djangoFetch(`${API}/x`, { method: 'post' })
      expect(sent.map(({ input }) => String(input))).toEqual([`${API}/csrf/`, `${API}/x`])
      expect(sent[0].init).toEqual({ credentials: 'include' })
      expect(headersOf(sent[1])).toEqual({ 'x-csrftoken': 'primed' })
    })

    it.each(['GET', 'HEAD', 'OPTIONS', 'TRACE'])('never primes for %s', async (method) => {
      const { sent, djangoFetch } = primingFetch()
      await djangoFetch(`${API}/x`, { method })
      expect(sent).toHaveLength(1)
    })

    it('reads the method from a Request, and defaults to GET', async () => {
      const { sent, djangoFetch } = primingFetch()
      await djangoFetch(`${API}/x`)
      expect(sent).toHaveLength(1)
      await djangoFetch(new Request(`${API}/y`, { method: 'DELETE' }))
      expect(sent.map(({ input }) => (input instanceof Request ? input.url : String(input)))).toEqual([
        `${API}/x`,
        `${API}/csrf/`,
        `${API}/y`,
      ])
    })

    it('does not prime when given a Cookie header, even in a browser', async () => {
      const { sent, baseFetch } = recorder()
      const djangoFetch = createDjangoFetch({
        baseUrl: API,
        baseFetch,
        primeUrl: `${API}/csrf/`,
        cookieHeader: 'sessionid=s',
      })
      await djangoFetch(`${API}/x`, { method: 'POST' })
      expect(sent).toHaveLength(1)
    })

    it('does not prime when the cookie is there', async () => {
      document.cookie = 'csrftoken=tok'
      const { sent, djangoFetch } = primingFetch()
      await djangoFetch(`${API}/x`, { method: 'POST' })
      expect(sent).toHaveLength(1)
    })

    it('does not prime for a request it does not trust', async () => {
      const { sent, djangoFetch } = primingFetch()
      await djangoFetch('https://elsewhere.test/x', { method: 'POST' })
      expect(sent).toHaveLength(1)
    })

    it('shares one prime between requests made together, and primes again later', async () => {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { sent, baseFetch } = recorder(async () => new Response('ok'))
      baseFetch.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ input, init })
        await gate
        return new Response('ok')
      })
      const djangoFetch = createDjangoFetch({ baseUrl: API, baseFetch, primeUrl: `${API}/csrf/` })
      const both = Promise.all([
        djangoFetch(`${API}/a`, { method: 'POST' }),
        djangoFetch(`${API}/b`, { method: 'POST' }),
      ])
      release()
      await both
      expect(sent.filter(({ input }) => String(input) === `${API}/csrf/`)).toHaveLength(1)
      await djangoFetch(`${API}/c`, { method: 'POST' })
      expect(sent.filter(({ input }) => String(input) === `${API}/csrf/`)).toHaveLength(2)
    })

    it('lets the request go ahead, without a token, when the prime fails', async () => {
      const { sent, baseFetch } = recorder()
      baseFetch.mockImplementationOnce(async () => Promise.reject(new TypeError('fetch failed')))
      const djangoFetch = createDjangoFetch({ baseUrl: API, baseFetch, primeUrl: `${API}/csrf/` })
      await djangoFetch(`${API}/x`, { method: 'POST' })
      expect(sent.map(({ input }) => String(input))).toEqual([`${API}/x`])
      expect(headersOf(sent[0])).toEqual({})
    })
  })

  describe('the default fetch', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('ok'))
      )
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('is the global one, looked up at call time', async () => {
      await createDjangoFetch({ baseUrl: API })(`${API}/x`)
      expect(fetch).toHaveBeenCalledOnce()
    })
  })
})
