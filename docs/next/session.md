# next/session

Import from `@isikk/core/next/session`. Requires `next` (`>=14`) and `react` (`>=18`) as peer dependencies.

## createSessionGuards

Builds a pair of directional guards around a single session fetch (plus `getState()`, below): `requireSession()` redirects an anonymous visitor away (e.g. to a login page), `redirectIfPresent()` redirects an already-authenticated visitor the opposite direction (e.g. off an auth-only page). Both wrap the same `fetchSession` in React's [`cache()`](https://react.dev/reference/react/cache), so any number of layouts/pages calling either guard within one render pass dedupe to a single network call.

```typescript
// lib/session.ts
import { createSessionGuards } from '@isikk/core/next/session'

export const { requireSession, redirectIfPresent } = createSessionGuards(fetchSessionFromCookie, {
  loginPath: '/auth/login',
  redirectPath: '/dashboard',
})
```

```typescript
// app/dashboard/layout.tsx
const session = await requireSession() // redirects to /auth/login if there's none

// app/auth/login/page.tsx
await redirectIfPresent() // redirects to /dashboard if already signed in
```

Both accept a one-off `redirectTo` argument that overrides the configured default for that call:

```typescript
await requireSession('/auth/login?next=' + encodeURIComponent(pathname))
```

`loginPath`/`redirectPath` default to `/login`/`/` respectively when omitted.

### A fetch that returns more than the session

A fetch may return a state object with pending steps beside the session. `sessionOf` picks the session out for the present/absent decision, and `redirectFor` is asked first by both guards - a path sends the visitor there, `null` goes on. The rule is the caller's:

```typescript
export const { requireSession, redirectIfPresent, getState } = createSessionGuards(fetchSessionState, {
  sessionOf: (state) => state.session,
  redirectFor: (state) => (state.pendingProviderSignup ? '/auth/complete-signup' : null),
})

const { language, pendingMfaTypes } = await getState() // the same cached fetch, no second call
```

- `getState()` answers whatever the fetch returned, from the same `cache()`d call the guards use.
- The session type is the first type parameter and the state the second, defaulting to `Session | null`, so `createSessionGuards<Session>(fetch)` means what it always has.
