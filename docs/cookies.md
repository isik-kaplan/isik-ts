# cookies

## getCookie

Reads a single cookie's value from `document.cookie`. Browser-only - for reading cookies in a Next.js server context (Server Components, Server Actions), see [next/cookies](next/cookies.md) instead.

```typescript
import { getCookie } from '@isikk/core'

document.cookie = 'session=abc123'
getCookie('session') // 'abc123'
getCookie('missing') // undefined
getCookie('q', { encoded: true }) // decodes a value written with setCookie's { encoded: true }
```

The value comes back as stored unless `encoded: true` is passed. With it, a `%` that is not a valid escape reads back as stored rather than throwing.

## setCookie

Writes a cookie via `document.cookie`. Browser-only.

```typescript
import { setCookie } from '@isikk/core'

setCookie('theme', 'dark') // session cookie, cleared when the browser closes
setCookie('theme', 'dark', { days: 30 }) // expires in 30 days
setCookie('theme', 'dark', { path: '/app' }) // defaults to '/'
setCookie('q', 'a;b') // throws - a ';' would end the value early
setCookie('q', 'a;b', { encoded: true }) // stored as q=a%3Bb
getCookie('q', { encoded: true }) // 'a;b'
```

A cookie can't carry every character as written. A `;` ends the value and starts an attribute, so `a;b` would store only `a`, and a value from user input could set `domain=`. Rather than store part of it, `setCookie` throws for a value outside what [RFC 6265](https://www.rfc-editor.org/rfc/rfc6265#section-4.1.1) allows: printable ASCII except space, `"`, `,`, `;` and `\`. A session id, a JWT or base64 is unaffected.

For a value that may hold any of those, such as user input or free text, pass `encoded: true`. The value is percent-encoded with `encodeURIComponent`, and `getCookie` needs the same option to decode it. `encoded` applies to the value only: the name must always be a token (letters, digits and ``!#$%&'*+-.^_`|~``), or `setCookie` and `removeCookie` throw. They throw too for a `path` holding a `;` or a control character, which would otherwise start an attribute of its own.

## removeCookie

Deletes a cookie by setting it to expire in the past. Browser-only.

```typescript
import { removeCookie } from '@isikk/core'

removeCookie('theme')
removeCookie('theme', '/app') // must match the path it was set with
```
