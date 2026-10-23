# http

## retryAfterOf

How many seconds a response asks the client to wait, read from its `Retry-After` header. `useAPISubmit` hands this to its `throttled` message on a 429 (see [hooks.md](hooks.md#useapisubmit)).

```typescript
import { retryAfterOf } from '@isikk/core'

retryAfterOf(response) // Retry-After: 120 -> 120
retryAfterOf(response) // Retry-After: Wed, 21 Oct 2026 07:28:00 GMT -> seconds until then
retryAfterOf(response) // no Retry-After -> null
```

- Takes anything with `headers` - a `Response`, openapi-fetch's `result.response` - or `null`/`undefined`, which reads as no header.
- Both forms of the header: delta-seconds, and an HTTP-date in any of the three forms RFC 9110 has a client accept (`Sun, 06 Nov 1994 08:49:37 GMT`, `Sunday, 06-Nov-94 08:49:37 GMT`, `Sun Nov  6 08:49:37 1994`).
- Never negative: a date already past reads as `0`. A date is rounded up to whole seconds, so waiting the answer is always enough.
- `null` for a value that is neither form - `-1`, `1.5`, `soon`. The date forms are matched exactly rather than handed to `Date.parse`, which reads `1.5` as a day in 2001.

## etagOf

A response's `ETag`, exactly as sent - quotes and any `W/` kept - so it goes back into `If-Match` unchanged. `null` with no response or no header.

```typescript
import { etagOf } from '@isikk/core'

etagOf(response) // ETag: "3f2a" -> '"3f2a"'
```

- Prefer a body field where the server sends one - isik's `etag`. Compression can weaken the header to `W/"..."`, and a cross-origin page can read the header only if the server lists `ETag` in `Access-Control-Expose-Headers`.

## ifMatch

The `If-Match` header for a write, to spread into a client's headers:

```typescript
import { ifMatch } from '@isikk/core'

api.PATCH('/notes/{id}/', { params, body, headers: ifMatch(note.etag) })
ifMatch('*') // { 'If-Match': '*' } - overwrite whatever is there
```

- The tag is sent as given. An empty string throws a `TypeError`: it matches nothing, and is always a token that was never loaded.
- The result is branded [`Versioned`](#versioned--keyed--idempotencykey), for a client method that requires it.
- `useAPISubmit` and `useVersionedFormState` build this header themselves from an `etag` option (see [hooks.md](hooks.md#optimistic-concurrency)).
- Send `'*'` only when a person chose to overwrite. A server may refuse it with a 428. `anyVersion()` says so by name.

## anyVersion

`{ 'If-Match': '*' }`, branded `Versioned` - write over whatever version is there. Its own name so an overwrite is a choice someone can find; `ifMatch('*')` still works.

## idempotencyKey

`{ 'Idempotency-Key': key }`, branded `Keyed`, to spread into a client's headers. An empty key throws a `TypeError`. `useIdempotencyKey`'s `headerFor(payload)` builds it from the attempt's key.

## Versioned / Keyed / IdempotencyKey

Type-only marks, nothing at runtime. `Versioned` is on headers whose write decided its version - from `ifMatch`, `anyVersion`, or a submit given an `etag`, `null` included. `Keyed` is on headers carrying a key the hooks or `idempotencyKey` made. `IdempotencyKey` is `string & Keyed`. A client method that takes `headers: WriteHeaders & Versioned & Keyed` refuses headers built without them at compile time. See [hooks.md](hooks.md#branded-headers).

## isPreconditionFailed / isPreconditionRequired

Whether a response is a 412 (the `If-Match` sent names a version someone else has replaced) or a 428 (the server needs an `If-Match` and none was sent). Both answer `false` with no response.

## createDjangoFetch

A `fetch` for a Django API, to hand a typed client such as openapi-fetch. It sends the CSRF token in the header Django reads, forwards the session cookie from the server, and keeps the headers of a `Request` it is given - openapi-fetch hands its fetch a `Request`, whose own headers a plain `fetch(request, init)` would replace with init's.

```typescript
import { createDjangoFetch, nameFetchFailures } from '@isikk/core'

import createClient from 'openapi-fetch'

// In the browser
const api = createClient<paths>({ baseUrl, fetch: createDjangoFetch({ baseUrl, primeUrl: `${baseUrl}/csrf/` }) })

// In a Server Component: the incoming request's cookies, forwarded
const cookieHeader = (await headers()).get('cookie') ?? undefined
const serverApi = createClient<paths>({
  baseUrl,
  fetch: createDjangoFetch({ baseUrl, cookieHeader, baseFetch: nameFetchFailures(fetch) }),
})
```

- **Only to the API.** The `Cookie` header, the CSRF token and `credentials` go only to `baseUrl`'s origin. A request this fetch makes anywhere else carries none of them. `forwardTo: ['https://auth.example.com']` names other origins instead, and `forwardTo: 'any'` turns the check off. A relative URL is resolved against the page, so on the server, where there is none, it is never trusted.
- **CSRF.** The token is read from the `csrftoken` cookie - `document.cookie` in the browser, `cookieHeader` on the server - and sent as `X-CSRFToken`. Both names are options: `csrfCookieName`, `csrfHeaderName`.
- **Priming.** With `primeUrl`, an unsafe request (anything but GET, HEAD, OPTIONS, TRACE) made in the browser while the CSRF cookie is missing first GETs `primeUrl` - a view with Django's `ensure_csrf_cookie`. Requests made together share that one GET. A prime that fails lets the request go ahead and be refused as it would have been. It never primes on the server, or on every call.
- `credentials` defaults to `'include'` on trusted requests; an untrusted one keeps whatever the caller passed.
- `baseFetch` defaults to the global `fetch`, looked up at call time - so there is no unbound `fetch` to throw "Illegal invocation".
- Nothing goes into a request body: the token travels as a header.

## nameFetchFailures

Wraps a fetch so a network failure names the call that failed. undici's own `fetch failed` carries only its own frames, so Next's error digest reads every network failure alike without it.

```typescript
import { nameFetchFailures } from '@isikk/core'

const named = nameFetchFailures(fetch)
await named('https://api.example.com/v0/orders/?token=x', { method: 'POST' })
// Error: fetch failed: POST https://api.example.com/v0/orders/ (ECONNREFUSED), the original on `cause`
```

- The query string and fragment are left out by default - a query can carry a token, and the message lands in logs and error digests. `{ includeQuery: true }` keeps them.
- The code in parentheses is the underlying error's `cause.code`, when there is one.
- A response, any status, passes through untouched.
