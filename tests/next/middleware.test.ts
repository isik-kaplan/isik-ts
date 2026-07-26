// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

import { runMiddlewareIfPathMatches, runProxyIfPathMatches } from '../../src/next/middleware'

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

describe('runMiddlewareIfPathMatches', () => {
  it('is the same function as runProxyIfPathMatches, kept as a naming-compatibility alias', () => {
    expect(runMiddlewareIfPathMatches).toBe(runProxyIfPathMatches)
  })
})
