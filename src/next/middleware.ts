import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { isPathMatched } from '../functions'

// Directories end in a slash, so `/_nextanything` or `/.well-knownX` is not exempted with them.
export const DEFAULT_EXEMPT_PATTERNS: RegExp[] = [
  /^\/_next\//,
  /^\/\.well-known\//,
  /^\/apple-icon\.png$/,
  /^\/favicon\.ico$/,
  /^\/icon\.png$/,
  /^\/icon\.svg$/,
  /^\/manifest\.json$/,
  /^\/robots\.txt$/,
  /^\/sitemap\.xml$/,
]

export function runProxyIfPathMatches(pattern: RegExp, exemptPatterns: RegExp[] = DEFAULT_EXEMPT_PATTERNS) {
  return function (handler: (request: NextRequest) => Promise<NextResponse | void>) {
    return async function (request: NextRequest): Promise<NextResponse | void> {
      if (isPathMatched(request.nextUrl.pathname, pattern, exemptPatterns)) {
        return await handler(request)
      }
      return undefined
    }
  }
}

type ProxyHandler = (request: NextRequest) => Promise<NextResponse | void> | NextResponse | void

/**
 * Runs proxies in order and answers with the first response any of them returns. One that returns
 * nothing passes the request on, and a chain where none answers returns nothing.
 *
 * `NextResponse.next({ request: { headers } })` is a response too, so it ends the chain: a proxy
 * that only rewrites request headers goes last.
 */
export function chainProxies(...handlers: ProxyHandler[]) {
  return async function (request: NextRequest): Promise<NextResponse | void> {
    for (const handler of handlers) {
      const response = await handler(request)
      if (response) return response
    }
    return undefined
  }
}

/**
 * Redirects to a copy of `request`'s URL with every empty-string query param value removed
 * (`?tag=&sort=name` becomes `?sort=name`), or returns `undefined` if there was nothing to strip.
 * Preserves repeated keys (`?tag=a&tag=b` stays `?tag=a&tag=b`) - rebuilds the query string
 * directly from `URLSearchParams` entries rather than round-tripping through a plain object,
 * which would silently collapse repeats down to the last value.
 */
export function stripEmptyQueryParams(request: NextRequest): NextResponse | undefined {
  const url = request.nextUrl.clone()
  const cleaned = new URLSearchParams()
  let changed = false

  for (const [key, value] of url.searchParams.entries()) {
    if (value === '') {
      changed = true
      continue
    }
    cleaned.append(key, value)
  }

  if (!changed) {
    return undefined
  }

  url.search = cleaned.toString()
  return NextResponse.redirect(url)
}
