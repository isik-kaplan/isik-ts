# next/request

Import from `@isikk/core/next/request`. Requires `next` as a peer dependency (`>=14`), though neither function here imports anything from it directly - both operate on plain strings/`Headers`, so they're just as usable from a Server Component, Route Handler, or Server Action.

## getSafeRedirect

Validates that a value (typically a `?next=`-style query param) is safe to pass to `redirect()`: a same-origin relative path. Rejects anything that isn't a string, doesn't start with `/`, or that the URL parser resolves to another origin, falling back to a default instead. The parser decides rather than a prefix check, because browsers read `\` as `/` and strip tabs and newlines: `/\evil.com` and `/<tab>/evil.com` are as protocol-relative as `//evil.com`. A path that passes is returned exactly as given.

```typescript
import { getSafeRedirect } from '@isikk/core/next/request'

getSafeRedirect('/dashboard') // '/dashboard'
getSafeRedirect('//evil.com') // '/' (protocol-relative, rejected)
getSafeRedirect('/\\evil.com') // '/' (a backslash reads as a slash)
getSafeRedirect(null, '/home') // '/home' (custom fallback)
```

## getRequestOrigin

Resolves the true external origin (e.g. `https://real.host`, not an internal `http://backend` hostname) of an incoming request from its `X-Forwarded-*` headers - for server-side code that needs to build an absolute URL back to itself behind a reverse proxy.

```typescript
import { getRequestOrigin } from '@isikk/core/next/request'

getRequestOrigin(headers) // 'https://app.example.com'
```

Trusts `X-Forwarded-Proto` when present. When it's absent (typically local dev, where there's no proxy setting that header), falls back to an `isLocalDevHost` check - overridable, since what counts as "local dev" is project-specific:

```typescript
getRequestOrigin(headers, {
  isLocalDevHost: (host) => host.endsWith('.internal.test'),
})
```

The default `isLocalDevHost` matches `localhost` and `127.0.0.1` (with or without a port). Throws if the request has neither an `X-Forwarded-Host` nor a `Host` header.

Behind a chain of proxies each header is a comma list, one item per hop; the first item is the client's, and that is the one read: `X-Forwarded-Host: a.com, b.com` gives `https://a.com`.

`X-Forwarded-Host` is only as trustworthy as the proxy in front. With none stripping it, any caller can send `X-Forwarded-Host: evil.com`, and an absolute URL built from the result - a password-reset link, say - points there. A deployment without a trusted proxy should pass `allowedHosts`, and the call throws for any other host:

```typescript
getRequestOrigin(headers, {
  allowedHosts: ['app.example.com', /^[a-z]+\.example\.com$/],
})
```

A string matches the whole host, port included, ignoring case; a RegExp is tested against it.
