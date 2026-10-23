# next/request

Import from `@isikk/core/next/request`. Requires `next` as a peer dependency (`>=14`), though nothing here imports anything from it directly - everything operates on plain strings/`Headers`, so it is just as usable from a Server Component, Route Handler, or Server Action.

## getSafeRedirect

Validates that a value (typically a `?next=`-style query param) is safe to pass to `redirect()`: a same-origin relative path. Rejects anything that isn't a string, doesn't start with `/`, or that the URL parser resolves to another origin, falling back to a default instead. The parser decides rather than a prefix check, because browsers read `\` as `/` and strip tabs and newlines: `/\evil.com` and `/<tab>/evil.com` are as protocol-relative as `//evil.com`. A path that passes is returned exactly as given.

```typescript
import { getSafeRedirect } from '@isikk/core/next/request'

getSafeRedirect('/dashboard') // '/dashboard'
getSafeRedirect('//evil.com') // '/' (protocol-relative, rejected)
getSafeRedirect('/\\evil.com') // '/' (a backslash reads as a slash)
getSafeRedirect(null, '/home') // '/home' (custom fallback)
```

The second argument is the fallback, or `{ fallback, allow }`. `allow(url)` lets an absolute URL through when it answers true - the one place off this site a sign-in may return to, say. It is only ever asked about an absolute `http:` or `https:` URL: never a `javascript:` or `data:` one, never a protocol-relative path, never a path on this site (those keep the same-origin rule). The rule itself is the caller's:

```typescript
const authorize = (url: URL) => url.host === 'auth.example.com' && url.pathname === '/o/authorize/'

getSafeRedirect('https://auth.example.com/o/authorize/?client_id=x', { allow: authorize }) // passes, as url.href
getSafeRedirect('https://evil.com/o/authorize/', { allow: authorize }) // '/'
```

## getRequestOrigin

Resolves the true external origin (e.g. `https://real.host`, not an internal `http://backend` hostname) of an incoming request from its `X-Forwarded-*` headers - for server-side code that needs to build an absolute URL back to itself behind a reverse proxy.

```typescript
import { getRequestOrigin } from '@isikk/core/next/request'

getRequestOrigin(headers, { allowedHosts: ['app.example.com'] }) // 'https://app.example.com'
```

Trusts `X-Forwarded-Proto` when present. When it's absent (typically local dev, where there's no proxy setting that header), falls back to an `isLocalDevHost` check - overridable, since what counts as "local dev" is project-specific:

```typescript
getRequestOrigin(headers, {
  allowedHosts: [/\.internal\.test$/],
  isLocalDevHost: (host) => host.endsWith('.internal.test'),
})
```

The default `isLocalDevHost` matches `localhost` and `127.0.0.1` (with or without a port).

Behind a chain of proxies each header is a comma list, one item per hop; the first item is the client's, and that is the one read: `X-Forwarded-Host: a.com, b.com` gives `https://a.com`.

### allowedHosts (required) and fallbackHost

`X-Forwarded-Host` and `Host` are whatever the caller sent. With no proxy stripping them, any caller can send `X-Forwarded-Host: evil.com`, and an absolute URL built from the result - a password-reset link, say - points there. So `allowedHosts` is required:

```typescript
getRequestOrigin(headers, {
  allowedHosts: ['app.example.com', /^[a-z]+\.example\.com(:\d+)?$/],
  fallbackHost: 'app.example.com',
})
```

- A string matches the whole host, port included, ignoring case; a RegExp is tested against it.
- A host outside the list, or a request naming none, answers `fallbackHost`'s origin. Its protocol comes from `isLocalDevHost`, never from the refused request's `X-Forwarded-Proto`. Without `fallbackHost` the call throws.
- `allowedHosts: 'any'` turns the check off, for a deployment whose proxy sets the headers itself. It is spelled out so that trusting every host is something a reader can see.

## isPlainHttpLocalDev

Whether a request reached a local-dev host over plain http - where a `Secure` cookie would be dropped. [next/cookies](cookies.md)' `setCookie` reads it to leave `Secure` off in that one case. Takes the same `isLocalDevHost` override.
