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
