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
