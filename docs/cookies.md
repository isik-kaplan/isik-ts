# cookies

## getCookie

Reads a single cookie's value from `document.cookie`, or from a `Cookie` request header passed as `from` - which works anywhere, a server included. For a Next.js server context, [next/cookies](next/cookies.md) reads the request's cookies directly.

```typescript
import { getCookie } from '@isikk/core'

document.cookie = 'session=abc123'
getCookie('session') // 'abc123'
getCookie('missing') // undefined
getCookie('q', { encoded: true }) // decodes a value written with setCookie's { encoded: true }
```

The value comes back as stored unless `encoded: true` is passed. With it, a `%` that is not a valid escape reads back as stored rather than throwing.

```typescript
getCookie('csrftoken', { from: request.headers.get('cookie') ?? '' }) // the incoming request's
```

The name is compared as a string, never built into a pattern, so a name holding `.` or `+` matches only itself.

## setCookie

Writes a cookie via `document.cookie`. Browser-only.

```typescript
import { setCookie } from '@isikk/core'

setCookie('theme', 'dark') // session cookie, cleared when the browser closes
setCookie('theme', 'dark', { days: 30 }) // expires in 30 days
setCookie('theme', 'dark', { path: '/app' }) // defaults to '/'
setCookie('theme', 'dark', { sameSite: 'Strict' }) // defaults to 'Lax'
setCookie('q', 'a;b') // throws - a ';' would end the value early
setCookie('q', 'a;b', { encoded: true }) // stored as q=a%3Bb
getCookie('q', { encoded: true }) // 'a;b'
```

Every cookie is written with `SameSite=Lax` unless `sameSite` says otherwise, and with `Secure` whenever the page itself is https - so local http development still works. `secure: false` leaves it off; `sameSite: 'None'` without `secure` throws, since browsers drop that cookie.

A cookie can't carry every character as written. A `;` ends the value and starts an attribute, so `a;b` would store only `a`, and a value from user input could set `domain=`. Rather than store part of it, `setCookie` throws for a value outside what [RFC 6265](https://www.rfc-editor.org/rfc/rfc6265#section-4.1.1) allows: printable ASCII except space, `"`, `,`, `;` and `\`. A session id, a JWT or base64 is unaffected.

For a value that may hold any of those, such as user input or free text, pass `encoded: true`. The value is percent-encoded with `encodeURIComponent`, and `getCookie` needs the same option to decode it. `encoded` applies to the value only: the name must always be a token (letters, digits and ``!#$%&'*+-.^_`|~``), or `setCookie` and `removeCookie` throw. They throw too for a `path` holding a `;` or a control character, which would otherwise start an attribute of its own.

## removeCookie

Deletes a cookie by setting it to expire in the past. Browser-only.

```typescript
import { removeCookie } from '@isikk/core'

removeCookie('theme')
removeCookie('theme', '/app') // must match the path it was set with
```
