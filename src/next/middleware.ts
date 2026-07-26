import type { NextRequest, NextResponse } from 'next/server'

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

// Next.js 16 deprecated the `middleware.ts`/`middleware` file convention in favor of
// `proxy.ts`/`proxy` (middleware.ts still works today for edge-runtime use cases, but is
// deprecated and defaults to being phased out). This alias exists so code written against either
// naming keeps working - the wrapped handler's shape (NextRequest in, NextResponse|void out)
// hasn't changed between the two, only what Next.js calls the file/export that uses it.
export const runMiddlewareIfPathMatches = runProxyIfPathMatches
