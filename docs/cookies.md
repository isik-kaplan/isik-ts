# cookies

## getCookie

Reads a single cookie's value from `document.cookie`. Browser-only - for reading cookies in a Next.js server context (Server Components, Server Actions), see [next/cookies](next/cookies.md) instead.

```typescript
import { getCookie } from '@isikk/core'

document.cookie = 'session=abc123'
getCookie('session') // 'abc123'
getCookie('missing') // undefined
```

## setCookie

Writes a cookie via `document.cookie`. Browser-only.

```typescript
import { setCookie } from '@isikk/core'

setCookie('theme', 'dark') // session cookie, cleared when the browser closes
setCookie('theme', 'dark', { days: 30 }) // expires in 30 days
setCookie('theme', 'dark', { path: '/app' }) // defaults to '/'
```

## removeCookie

Deletes a cookie by setting it to expire in the past. Browser-only.

```typescript
import { removeCookie } from '@isikk/core'

removeCookie('theme')
removeCookie('theme', '/app') // must match the path it was set with
```
