# next

- [middleware.md](middleware.md) - `runProxyIfPathMatches`, `chainProxies`, `DEFAULT_EXEMPT_PATTERNS`, `stripEmptyQueryParams`
- [cookies.md](cookies.md) - `setCookie`, `getCookie`, `removeCookie` (server-side, HttpOnly by default)
- [request.md](request.md) - `getSafeRedirect`, `getRequestOrigin`, `isPlainHttpLocalDev`
- [session.md](session.md) - `createSessionGuards`
- [config.md](config.md) - `publicConfig` (runtime browser-visible env config, the `NEXT_PUBLIC_*` alternative)

Split into separate entry points (`@isikk/core/next/middleware`, `@isikk/core/next/cookies`, `@isikk/core/next/request`, `@isikk/core/next/session`, `@isikk/core/next/config`) rather than one `@isikk/core/next` - see [config.md](config.md) for why `config` has to be separate; `cookies` is separate for its ESM-only build; `middleware`/`request`/`session` are split simply to keep each entry point's peer-dependency footprint and concern narrow.
