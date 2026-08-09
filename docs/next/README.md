# next

- [middleware.md](middleware.md) - `runProxyIfPathMatches`, `DEFAULT_EXEMPT_PATTERNS`, `stripEmptyQueryParams` (`runMiddlewareIfPathMatches` is a kept alias)
- [cookies.md](cookies.md) - `setCookie`, `getCookie`, `removeCookie` (Next.js Server Actions)
- [request.md](request.md) - `getSafeRedirect`, `getRequestOrigin`
- [session.md](session.md) - `createSessionGuards`
- [config.md](config.md) - `publicConfig` (runtime browser-visible env config, the `NEXT_PUBLIC_*` alternative)

Split into separate entry points (`@isikk/core/next/middleware`, `@isikk/core/next/cookies`, `@isikk/core/next/request`, `@isikk/core/next/session`, `@isikk/core/next/config`) rather than one `@isikk/core/next` - see [cookies.md](cookies.md) and [config.md](config.md) for why `cookies` and `config` specifically have to be separate; `middleware`/`request`/`session` are split simply to keep each entry point's peer-dependency footprint and concern narrow.
