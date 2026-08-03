# next

- [middleware.md](middleware.md) - `runProxyIfPathMatches`, `DEFAULT_EXEMPT_PATTERNS`, `stripEmptyQueryParams` (`runMiddlewareIfPathMatches` is a kept alias)
- [cookies.md](cookies.md) - `setCookie`, `getCookie`, `removeCookie` (Next.js Server Actions)
- [request.md](request.md) - `getSafeRedirect`, `getRequestOrigin`
- [session.md](session.md) - `createSessionGuards`

Split into separate entry points (`@isikk/core/next/middleware`, `@isikk/core/next/cookies`, `@isikk/core/next/request`, `@isikk/core/next/session`) rather than one `@isikk/core/next` - see [cookies.md](cookies.md) for why `cookies` specifically has to be separate; `middleware`/`request`/`session` are split simply to keep each entry point's peer-dependency footprint and concern narrow.
