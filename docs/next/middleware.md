# next/middleware

Import from `@isikk/core/next/middleware`. Requires `next` as a peer dependency (`>=14`).

## runProxyIfPathMatches

Wraps a Next.js request handler so it only runs when `request.nextUrl.pathname` matches a pattern, skipping it (returning `undefined`, i.e. "continue") for any pathname matching an exempt pattern first. Built on [`isPathMatched`](../functions.md#ispathmatched) from the framework-agnostic `functions` module.

```typescript
// proxy.ts
import { runProxyIfPathMatches } from '@isikk/core/next/middleware'

export const proxy = runProxyIfPathMatches(/^\/dashboard/)(async (request) => {
  if (!isAuthenticated(request)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
})
```

- **Naming**: Next.js 16 deprecated the `middleware.ts`/`export function middleware()` file convention in favor of `proxy.ts`/`export function proxy()` (`middleware.ts` still works today - it's how you opt into the edge runtime, since `proxy.ts` always runs on the Node.js runtime and can't be configured otherwise - but it's deprecated and Next's own migration codemod renames it). The wrapped handler's shape (`NextRequest` in, `NextResponse | void` out) is identical either way, so `runProxyIfPathMatches` works unchanged whichever file/export name you're using. `runMiddlewareIfPathMatches` is kept as an exact alias (`runMiddlewareIfPathMatches === runProxyIfPathMatches`) for code still targeting `middleware.ts`.

## DEFAULT_EXEMPT_PATTERNS

The default `exemptPatterns` used when `runProxyIfPathMatches` is called without a second argument: Next.js internals (`/_next`), `.well-known`, and common root-level static asset filenames (favicon, manifest, robots.txt, sitemap, app icons - matching the exclusion list in Next's own [official proxy matcher examples](https://nextjs.org/docs/app/api-reference/file-conventions/proxy#negative-matching)). Exported so callers can spread it into a custom list instead of replacing it outright:

```typescript
import { DEFAULT_EXEMPT_PATTERNS, runProxyIfPathMatches } from '@isikk/core/next/middleware'

const proxy = runProxyIfPathMatches(/.*/, [...DEFAULT_EXEMPT_PATTERNS, /^\/health$/])(handler)
```

- Each static-asset pattern is fully anchored (`^\/favicon\.ico$`, not just `/favicon\.ico/`) - it matches only the exact root-level path, not any pathname that happens to contain that filename as a substring. This matters for an exempt list feeding into auth-gating middleware: an unanchored `/favicon\.ico/` would also match `/admin/blog/my-favicon.ico-post`, exempting it from whatever check `handler` was supposed to run.
