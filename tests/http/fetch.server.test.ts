// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { createDjangoFetch } from '../../src/http'

const API = 'https://api.test'

function recorder() {
  const sent: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = []
  const baseFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ input, init })
    return new Response('ok')
  }) as unknown as typeof fetch
  return { sent, baseFetch }
}

const headersOf = (init: RequestInit | undefined) => Object.fromEntries(new Headers(init?.headers).entries())

describe('createDjangoFetch on the server', () => {
  it('forwards the Cookie header and reads the token from it', async () => {
    const { sent, baseFetch } = recorder()
    const djangoFetch = createDjangoFetch({ baseUrl: API, baseFetch, cookieHeader: 'sessionid=s; csrftoken=tok' })
    await djangoFetch(`${API}/x`, { method: 'POST' })
    expect(headersOf(sent[0].init)).toEqual({ cookie: 'sessionid=s; csrftoken=tok', 'x-csrftoken': 'tok' })
  })

  it('forwards the Cookie header without a token in it, and never primes', async () => {
    const { sent, baseFetch } = recorder()
    const djangoFetch = createDjangoFetch({
      baseUrl: API,
      baseFetch,
      cookieHeader: 'sessionid=s',
      primeUrl: `${API}/csrf/`,
    })
    await djangoFetch(`${API}/x`, { method: 'POST' })
    expect(sent).toHaveLength(1)
    expect(headersOf(sent[0].init)).toEqual({ cookie: 'sessionid=s' })
  })

  it('never forwards the Cookie header to another origin', async () => {
    const { sent, baseFetch } = recorder()
    const djangoFetch = createDjangoFetch({ baseUrl: API, baseFetch, cookieHeader: 'sessionid=s; csrftoken=tok' })
    await djangoFetch('https://elsewhere.test/x', { method: 'POST' })
    expect(headersOf(sent[0].init)).toEqual({})
  })

  it('trusts no relative URL, since there is no page to resolve it against', async () => {
    const { sent, baseFetch } = recorder()
    const djangoFetch = createDjangoFetch({ baseUrl: API, baseFetch, cookieHeader: 'sessionid=s' })
    await djangoFetch('/x')
    expect(headersOf(sent[0].init)).toEqual({})
  })

  it("trusts no relative URL even with forwardTo: 'any'", async () => {
    const { sent, baseFetch } = recorder()
    const djangoFetch = createDjangoFetch({ baseUrl: API, baseFetch, cookieHeader: 'sessionid=s', forwardTo: 'any' })
    await djangoFetch('/x')
    expect(headersOf(sent[0].init)).toEqual({})
  })

  it('reads no token and never primes without a Cookie header', async () => {
    const { sent, baseFetch } = recorder()
    const djangoFetch = createDjangoFetch({ baseUrl: API, baseFetch, primeUrl: `${API}/csrf/` })
    await djangoFetch(`${API}/x`, { method: 'POST' })
    expect(sent).toHaveLength(1)
    expect(headersOf(sent[0].init)).toEqual({})
    expect(sent[0].init?.credentials).toBe('include')
  })
})
