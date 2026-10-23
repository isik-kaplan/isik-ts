# next/cookies

Import from `@isikk/core/next/cookies`. Requires `next` as a peer dependency (`>=14`). Thin wrappers around `next/headers`'s `cookies()`, for Server Components, Route Handlers and an app's own Server Actions.

```typescript
import { getCookie, removeCookie, setCookie } from '@isikk/core/next/cookies'

await setCookie('session', token) // HttpOnly; Secure; SameSite=Lax; Path=/
await setCookie('theme', 'dark', { httpOnly: false, maxAge: 60 * 60 * 24 * 365 }) // readable by the page
await getCookie('theme') // 'dark'
await removeCookie('theme')
```

- `setCookie` is at its most guarded by default: `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `path: '/'`. A cookie the page's own script must read says so with `httpOnly: false`. `secure` is left off only for a local-dev host over plain http (see [`isPlainHttpLocalDev`](request.md#isplainhttplocaldev)), where a browser would drop it. `sameSite: 'none'` without `secure` throws.
- `maxAge` is in seconds; omit it for a session cookie.
- `getCookie` returns `null` (not `undefined`) when the cookie is absent, matching `next/headers`'s own convention.
- These only work in a request-scoped context - calling them outside of one throws, the same way calling `next/headers`'s `cookies()` directly would.

## Not Server Actions

These are plain server functions. Until 0.19.0 the file was marked `'use server'`, which made each export a Server Action - a public endpoint any visitor can call, with any name. `getCookie` then handed any cookie to the page's script, an HttpOnly session cookie included, and `setCookie` wrote any name. An app that wants a cookie set from the client writes its own action around these, with its own list of names:

```typescript
'use server'

import { setCookie } from '@isikk/core/next/cookies'

export async function setTheme(theme: 'light' | 'dark') {
  await setCookie('theme', theme, { httpOnly: false })
}
```

## Why this entry point is ESM-only

It ships only an `import` condition, as it always has. `next/headers` only works inside Next's own bundling, which reads ESM.
