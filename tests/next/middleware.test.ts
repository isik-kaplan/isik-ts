// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

import { runMiddlewareIfPathMatches, runProxyIfPathMatches, stripEmptyQueryParams } from '../../src/next/middleware'

describe('runProxyIfPathMatches', () => {
  it('runs the handler when the pathname matches', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.next())
    const wrapped = runProxyIfPathMatches(/^\/posts/)(handler)

    const request = new NextRequest('https://example.com/posts/1')
    await wrapped(request)

    expect(handler).toHaveBeenCalledWith(request)
  })

  it('skips the handler when the pathname does not match', async () => {
    const handler = vi.fn()
    const wrapped = runProxyIfPathMatches(/^\/posts/)(handler)

    const request = new NextRequest('https://example.com/users/1')
    await wrapped(request)

    expect(handler).not.toHaveBeenCalled()
  })

  it('skips the handler for default-exempt paths', async () => {
    const handler = vi.fn()
    const wrapped = runProxyIfPathMatches(/.*/)(handler)

    const request = new NextRequest('https://example.com/favicon.ico')
    await wrapped(request)

    expect(handler).not.toHaveBeenCalled()
  })

  it('exempts sitemap.xml by default', async () => {
    const handler = vi.fn()
    const wrapped = runProxyIfPathMatches(/.*/)(handler)

    await wrapped(new NextRequest('https://example.com/sitemap.xml'))

    expect(handler).not.toHaveBeenCalled()
  })

  it('does not exempt a path that merely contains an exempt filename as a substring', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.next())
    const wrapped = runProxyIfPathMatches(/.*/)(handler)

    await wrapped(new NextRequest('https://example.com/admin/blog/my-favicon.ico-post'))
    await wrapped(new NextRequest('https://example.com/admin/users/robots.txt-exploit'))

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('accepts a custom exempt pattern list', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    const wrapped = runProxyIfPathMatches(/.*/, [/^\/skip/])(handler)

    await wrapped(new NextRequest('https://example.com/skip/me'))
    expect(handler).not.toHaveBeenCalled()

    await wrapped(new NextRequest('https://example.com/keep/me'))
    expect(handler).toHaveBeenCalledOnce()
  })
})

describe('DEFAULT_EXEMPT_PATTERNS', () => {
  async function isExempt(pathname: string): Promise<boolean> {
    const handler = vi.fn().mockResolvedValue(NextResponse.next())
    const wrapped = runProxyIfPathMatches(/.*/)(handler)

    await wrapped(new NextRequest(`https://example.com${pathname}`))

    return handler.mock.calls.length === 0
  }

  // Each exact filename is checked both with a leading prefix (would wrongly match without the
  // `^` anchor) and a trailing suffix (would wrongly match without the `$` anchor), alongside the
  // exact path it must still exempt.
  it.each([
    ['/_next/static/chunk.js', true],
    ['/api/_next', false],
    ['/.well-known/security.txt', true],
    ['/api/.well-known', false],
    ['/apple-icon.png', true],
    ['/evil/apple-icon.png', false],
    ['/apple-icon.png.evil', false],
    ['/favicon.ico', true],
    ['/evil/favicon.ico', false],
    ['/favicon.ico.evil', false],
    ['/icon.png', true],
    ['/evil/icon.png', false],
    ['/icon.png.evil', false],
    ['/icon.svg', true],
    ['/evil/icon.svg', false],
    ['/icon.svg.evil', false],
    ['/manifest.json', true],
    ['/evil/manifest.json', false],
    ['/manifest.json.evil', false],
    ['/robots.txt', true],
    ['/evil/robots.txt', false],
    ['/robots.txt.evil', false],
    ['/sitemap.xml', true],
    ['/evil/sitemap.xml', false],
    ['/sitemap.xml.evil', false],
  ])('%s is exempt by default: %s', async (pathname, expected) => {
    expect(await isExempt(pathname)).toBe(expected)
  })
})

describe('runMiddlewareIfPathMatches', () => {
  it('is the same function as runProxyIfPathMatches, kept as a naming-compatibility alias', () => {
    expect(runMiddlewareIfPathMatches).toBe(runProxyIfPathMatches)
  })
})

describe('stripEmptyQueryParams', () => {
  it('returns undefined when there are no empty-string query params', () => {
    const request = new NextRequest('https://example.com/posts?sort=name&tag=a')
    expect(stripEmptyQueryParams(request)).toBeUndefined()
  })

  it('returns undefined for a request with no query params at all', () => {
    const request = new NextRequest('https://example.com/posts')
    expect(stripEmptyQueryParams(request)).toBeUndefined()
  })

  it('redirects to a URL with empty-string query params removed', () => {
    const request = new NextRequest('https://example.com/posts?sort=name&tag=')
    const response = stripEmptyQueryParams(request)

    expect(response?.headers.get('location')).toBe('https://example.com/posts?sort=name')
  })

  it('preserves repeated non-empty keys instead of collapsing them to the last value', () => {
    const request = new NextRequest('https://example.com/posts?tag=a&tag=b&empty=')
    const response = stripEmptyQueryParams(request)

    expect(response?.headers.get('location')).toBe('https://example.com/posts?tag=a&tag=b')
  })
})
