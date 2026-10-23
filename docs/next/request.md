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

It answers "what origin did the visitor reach?" - a question about a URL to **show**: an email link, an invitation, a redirect. It is the wrong question for where the server should **connect**. A server-side fetch whose address comes from the request's host lets any caller choose what the server dials, which is SSRF however well the host is checked. See [Fetching from your own backend](#fetching-from-your-own-backend).

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

- A string matches the whole host, port included, ignoring case; a RegExp is tested against it; a function is asked, `(host) => boolean`. A function suits hosts known at runtime - a multi-tenant app's customer domains, already resolved by the time a page renders a link. A host your code has already validated can also be passed as `allowedHosts: [host]`.
- A host outside the list, or a request naming none, answers `fallbackHost`'s origin. Its protocol comes from `isLocalDevHost`, never from the refused request's `X-Forwarded-Proto`. Without `fallbackHost` the call throws.
- `fallbackHost` is for a **single-origin** deployment only. In a multi-tenant one the backend resolves the tenant from the host, so falling back renders another tenant's page where a refusal belongs. Leave it out there, and let the throw refuse.
- `allowedHosts: 'any'` turns the check off, for a deployment whose proxy sets the headers itself. It is spelled out so that trusting every host is something a reader can see.

### Three questions, three helpers

An app with one `getRequestOrigin()` helper is probably using it for more than one of these, and nothing at a call site says which - both answers are strings, so the compiler cannot tell either. Several call sites will need both, and want different values:

```typescript
const origin = await originHere()
const api = createAPI(origin) // dial - must never be the visitor's host
const callbackUrl = `${origin}/auth/callback-complete` // show - must be the visitor's host
```

Give each its own named helper, so the name carries the decision rather than the call site:

- **Dial** - where the server connects. A fixed internal origin; never the request (see below).
- **Show to the requester** - a URL rendered back to the very visitor who sent the request: a redirect, a callback, a link on the page they asked for. `getRequestOrigin`, and in a multi-tenant app `allowedHosts: 'any'` is right here. The customer domains are a database table, so a static or synchronous list would refuse exactly the domains the product sells. What makes `'any'` safe is the direction: a forged `Host` comes back to nobody but the one who forged it.
- **Deliver to someone else** - an email, an invitation, a password-reset link, a webhook. Never the request's host, `'any'` or not: a forged `Host` would plant the attacker's domain in a link another person opens. Build these from the tenant's stored domain, read from the database by the tenant the backend resolved.

### Fetching from your own backend

A Server Component fetching from your own API should connect to a fixed address, and carry the visitor's host as a header for the backend to read - never build the address from the request:

```typescript
const visitorHost = (await headers()).get('host') ?? ''
const api = createClient<paths>({
  baseUrl: CONFIG.API_INTERNAL, // http://backend:8000, a fixed address
  fetch: createDjangoFetch({ baseUrl: CONFIG.API_INTERNAL, cookieHeader }),
  headers: { 'X-Forwarded-Host': visitorHost, 'X-Forwarded-Proto': 'https' },
})
```

A forged host can then only name a tenant, which the backend checks (django-tenants answers an unknown one with a 404), and never an address.

- **Both headers.** With `USE_X_FORWARDED_HOST` and `SECURE_PROXY_SSL_HEADER`, Django reads the host and the scheme from them. Sending only `X-Forwarded-Host` makes every request look insecure: `request.is_secure()` turns false, secure-cookie handling changes, and absolute URLs come out `http://`. Some fetch implementations ignore a `Host` header set by hand, so the forwarded one is the dependable carrier.
- **A precondition to check.** This makes the frontend a second setter of headers the backend trusts, beside the proxy. That is safe only when the API's internal port is reachable from inside the deployment's network alone - a compose or cluster network. If the outside world can reach that port, anyone can set those headers, and the proxy-only arrangement is the safe one.
- **A new address.** If every server fetch goes through the public origin today, this adds an internal API origin to the config and a trust boundary to the deployment - not a one-line change.
- `createDjangoFetch` sends the `Cookie` header only to `baseUrl`'s origin, so a client pointed somewhere else by a bug carries no session. That limits a leak; it does not stop SSRF, since a request-derived `baseUrl` would match itself.

## isPlainHttpLocalDev

Whether a request reached a local-dev host over plain http - where a `Secure` cookie would be dropped. [next/cookies](cookies.md)' `setCookie` reads it to leave `Secure` off in that one case. Takes the same `isLocalDevHost` override.
