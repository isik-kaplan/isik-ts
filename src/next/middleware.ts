import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { isPathMatched } from '../functions'

export const DEFAULT_EXEMPT_PATTERNS: RegExp[] = [
  /^\/_next/,
  /^\/\.well-known/,
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

// Next.js 16 deprecated the `middleware.ts`/`middleware` file convention in favor of
// `proxy.ts`/`proxy` (middleware.ts still works today for edge-runtime use cases, but is
// deprecated and defaults to being phased out). This alias exists so code written against either
// naming keeps working - the wrapped handler's shape (NextRequest in, NextResponse|void out)
// hasn't changed between the two, only what Next.js calls the file/export that uses it.
export const runMiddlewareIfPathMatches = runProxyIfPathMatches
