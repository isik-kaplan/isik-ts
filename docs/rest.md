# rest (`@isikk/core/rest`)

A typed REST client read off any OpenAPI document's `paths`, as openapi-typescript emits them. It
generates nothing and has no dependencies. Every type comes from the document: which methods a path
has, its path, query and header parameters, its body, and what each status answers. Results are
openapi-fetch-shaped (`{ data, error, response }`), so they go straight to `useAPISubmit` and friends.

```typescript
import { createDjangoFetch } from '@isikk/core'
import { createStrictRestClient } from '@isikk/core/rest'

import type { paths } from './schema'

// openapi-typescript's output

const rest = createStrictRestClient<paths>({ baseUrl, fetch: createDjangoFetch({ baseUrl }) })

export const api = {
  tokens: rest.resource('/v0/personal-access-tokens/{id}/'),
  oauthApplications: rest.resource('/v0/oauth-applications/{id}/'),
  members: (project: number) => rest.resource('/v0/projects/{project}/members/{user}/', { project }),
}
```

## A resource

`rest.resource(detailPath)` takes the path whose last segment is a parameter. That parameter is the
id. Any parameters before it are a nested route's parent, and you bind them here. The resource has
only the operations its document declares:

| method                                       | operation                                                         |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `list(options?)`                             | `GET` the collection                                              |
| `create(body, options?)`                     | `POST` the collection                                             |
| `get(id, options?)`                          | `GET` the detail                                                  |
| `update(id, body, options)`                  | `PATCH` the detail                                                |
| `replace(id, body, options)`                 | `PUT` the detail                                                  |
| `remove(id, options)`                        | `DELETE` the detail                                               |
| `action(id, method, 'sub/path/', options?)`  | anything under the detail: `@action(detail=True)`, a nested route |
| `collectionAction(method, 'sub/', options?)` | anything under the collection: `@action(detail=False)`            |

```typescript
await api.tokens.list({ query: { page: 2 } })
const { data, error } = await api.tokens.create({ name: 'CI' }, { idempotencyKey })
await api.oauthApplications.update(id, { name: 'New' }, { etag, idempotencyKey })
await api.oauthApplications.action(id, 'post', 'rotate-secret/', { body: { revoke_tokens: true }, idempotencyKey })
```

Routes with and without a trailing slash both work (`/v0/things/{slug}` with `/v0/things`).

## Options

Each call's options are typed from its operation:

- `path`: path parameters the resource didn't fill. `request` takes all of them here.
- `query`: arrays are sent as repeated keys, as DRF's filters read them. `undefined` and `null` are
  left out, and a `Date` is sent as its ISO string.
- `headers`: the operation's declared headers (required ones are required), plus any others.
- `etag`: sent as `If-Match`. It is required exactly when the document requires that header.
- `idempotencyKey`: sent as `Idempotency-Key` on a POST, PUT, PATCH or DELETE. `{ none: 'reason' }`
  sends none and says why; a loose client also takes a bare `false`.
- `body`: a plain value is sent as JSON. `FormData`, `URLSearchParams`, a `Blob`, a buffer or a stream
  is sent as it is.
- `signal`.

`rest.request(method, path, options)` reaches any operation in the document, resource-shaped or
not, for example allauth's `/account/email`.

## Strict or not

- `createStrictRestClient` requires every write to name its key: leaving out `idempotencyKey`
  doesn't compile, and a caller the types can't see gets a `TypeError` before anything is sent.
  `{ none: 'reason' }` opts out on purpose, with a reason a reader can check; a bare `false` doesn't
  compile, and a blank reason throws. Use it with `useIdempotencyKey`, whose key lasts for the whole
  attempt, so a resubmit after a lost response reuses it. The check doesn't depend on the document
  declaring the header.
- `createStrictRestClient<paths, 'declared'>({ requireKey: 'declared' })` requires a key only on
  the writes whose operation declares an `Idempotency-Key` header, for a project that wants its
  document to set that policy. The rule is given twice, as the type parameter and as the option, so
  the types and the runtime agree; a mismatch doesn't compile. The document doesn't exist at runtime,
  so under this rule only the types check: an untyped caller's missing key goes out as no key. The
  rule is only as good as the document. A write that needs a key but whose operation doesn't declare
  the header compiles without one, which is why `'every-write'` is the default.
- `createRestClient` mints a key for a write that names none, using `generateKey` (default: a v4
  UUID; `null` mints none). A key minted per call protects only that call. Use this client for
  scripts and tools, not forms.

Both take `baseUrl`, `fetch` (default: the global one, looked up per call), and `headers`, an object
or a function called on every request, for example for a bearer token that refreshes.

## Results

`{ data, response }` on a 2xx, `{ error, response }` otherwise. `data` is typed by the operation's 2xx
responses and `error` by the rest; either is `unknown` when the document declares none. A JSON body is
parsed, other bodies come back as text, and an empty body is `undefined` (`''` as an error). A network
failure throws, as `fetch` does.
