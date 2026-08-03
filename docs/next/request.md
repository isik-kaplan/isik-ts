# next/request

Import from `@isikk/core/next/request`. Requires `next` as a peer dependency (`>=14`), though neither function here imports anything from it directly - both operate on plain strings/`Headers`, so they're just as usable from a Server Component, Route Handler, or Server Action.

## getSafeRedirect

Validates that a value (typically a `?next=`-style query param) is safe to pass to `redirect()`: a same-origin relative path. Rejects anything that isn't a string, doesn't start with `/`, or starts with `//` (protocol-relative - i.e. an off-site redirect), falling back to a default instead.

```typescript
import { getSafeRedirect } from '@isikk/core/next/request'

getSafeRedirect('/dashboard') // '/dashboard'
getSafeRedirect('//evil.com') // '/' (protocol-relative, rejected)
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
