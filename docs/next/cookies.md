# next/cookies

Import from `@isikk/core/next/cookies`. Requires `next` as a peer dependency (`>=14`). Thin wrappers around `next/headers`'s `cookies()`, callable from Server Actions/Server Components.

```typescript
import { getCookie, removeCookie, setCookie } from '@isikk/core/next/cookies'

await setCookie('theme', 'dark')
await getCookie('theme') // 'dark'
await removeCookie('theme')
```

- `getCookie` returns `null` (not `undefined`) when the cookie is absent, matching `next/headers`'s own convention.
- These only work in a request-scoped context (a Server Action, Route Handler, or Server Component) - calling them outside of one throws, the same way calling `next/headers`'s `cookies()` directly would.

## Why this is a separate entry point from `next/middleware`

This file starts with a `'use server'` directive, which Next.js's compiler requires to be the literal first statement of the module it applies to, and requires every top-level export from a `'use server'` file to be an `async` function - `runProxyIfPathMatches` isn't one. Bundling this together with [`next/middleware`](middleware.md) in one file would either lose the directive (esbuild silently drops non-standard directive prologues like `'use server'` once other modules get concatenated ahead of it in a bundle) or make the bundle invalid. Keeping them as separate build entries means each compiles to its own output file, so the directive survives intact and never leaks onto exports it doesn't apply to.

## Why this entry point is ESM-only

This entry ships only an `import` condition, no `require`. esbuild's CJS output format always injects its own `"use strict"` prologue as the literal first line, which would push `'use server'` to second place and break Next's directive detection there too - the same class of problem the file-splitting above solves for bundling, just resurfacing in the CJS wrapper instead. Since `'use server'` only has meaning inside Next's ESM/RSC bundling pipeline anyway, a CJS build of this entry wouldn't be usable for its purpose regardless, so it's simply not built.
