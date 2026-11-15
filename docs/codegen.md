# codegen (`isikk-gen-client`, `@isikk/core/codegen`)

Generates a finished API client from an OpenAPI document, next to the types openapi-typescript
generates from the same document. The output is one readable TypeScript file. It imports only those
types and needs nothing at runtime but `fetch`: no @isikk/core, no openapi-fetch.

```
schema.yml ──openapi-typescript──▶ schema.ts   (types)
           ──isikk-gen-client────▶ client.ts   (the client)
```

```json
"scripts": {
  "openapi:gen": "openapi-typescript src/api/schema.yml -o src/api/schema.ts && isikk-gen-client src/api/schema.yml -o src/api/client.ts --keys declared"
}
```

```typescript
import { createDjangoFetch } from '@isikk/core'

import { createClient } from './api/client'

export const api = createClient({ baseUrl, fetch: createDjangoFetch({ baseUrl }) })

await api.oauthApplications.list({ query: { page: 2 } })
await api.oauthApplications.rotateSecret(id, { revoke_tokens: true }, { idempotencyKey })
await api.oauthApplications.delegatableScopes()
await api.reviews.approve(id, { approved_scopes }, { etag, idempotencyKey })
await api.users.history(id)
await api.users.histories({ query: { page: 2 } })
await api.users.me()
await api.users.updateMe(body, { etag, idempotencyKey })
```

## Options

| option                    | default           |                                                                              |
| ------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `-o, --out <file>`        | required          | where to write the client                                                    |
| `--types <path>`          | `./schema`        | the openapi-typescript output, as the client imports it                      |
| `--keys <rule>`           | `every-write`     | which writes must name their `Idempotency-Key`, below                        |
| `--strip-prefix <prefix>` | the shared prefix | taken off every path before its resources are read                           |
| `--include <prefix>`      | every path        | only the paths that start with this: one client of several a document serves |
| `--rename <from>=<to>`    |                   | the project's own name for a generated one, repeatable (below)               |
| `--no-plurals`            | plurals on        | keep collection actions that GET a list singular                             |

The input is YAML or JSON (`.json`). Name clashes, and what each name became instead, are printed
as warnings.

## How paths become methods

Resources are read from what follows the prefix every path shares (`/v0/`, `/accounts-api/v0/`).

- **A collection and its detail** (`/tasks/` and `/tasks/{id}/`) make one resource: `list` and
  `create` on the collection, `get`, `update` (PATCH), `replace` (PUT) and `remove` on the detail.
- **An action** is a path under either one. It's named after its sub-path in camelCase:
  `rotate-secret/` → `rotateSecret(id, ...)`, and `delegatable-scopes/` → `delegatableScopes()`.
- **A collection action that GETs a list**, whether an array or a page of `results`, is named in
  the plural: `users/history/` → `histories()`, beside one user's `history(id)`. A name that's
  already plural stays as it is (`permissions()`, `scopes()`). Only the last word changes
  (`delegatableScope` → `delegatableScopes`). `--no-plurals` turns this off.
- **A sub-path with several methods** gives the read the bare name and names the writes in the
  resource's own words: `users/me/` → `me()`, `updateMe(...)`, `replaceMe(...)`, `createMe(...)`,
  `removeMe(...)`.
- **A nested route** (`/projects/{project}/members/{user}/`) takes its parent first:
  `projectsMembers.remove(project, user, ...)`.
- **A path with no detail** (`/features/`, allauth's `/account/email`) is a resource with the same
  words: `accountEmail.get()`, `.create(body, ...)`, `.update(...)`, `.replace(...)`,
  `.remove(body, ...)`.
- **A clash** gets another name, and the generator warns. A collection action says it's one
  (`stats/` beside one task's `stats(id)` → `collectionStats()`); a detail action takes its verb
  (`getGet`). If that's taken too, it gets a number.
- **Your own names:** `--rename users.collectionStats=allStats` renames a member, and
  `--rename users=people` a resource. A name that doesn't exist, or renaming onto a name that's
  already taken, is an error, not a rename that silently does nothing.
- **One client of several:** a document that serves allauth's browser and app clients under
  `/v0/browser/` and `/v0/app/` generates each with `--include /v0/browser/`.
- **A parameter in the shared prefix** (allauth's `/_allauth/{client}/v1/`) is filled once:
  `createClient({ pathParams: { client: 'browser' } })`.
- A path parameter that's part of a segment (`{kind}-report/`) is passed in `options.path`.

## Each call

Positional arguments come first: parents, then the id, then the body when the operation takes one.
Then comes an options object, typed per operation and required only when something in it is:

- `query`: arrays are sent as repeated keys, as DRF's filters read them. `undefined` and `null` are
  left out, and a `Date` is sent as its ISO string.
- `headers`: the declared headers (required ones are required), plus any others.
- `etag`: sent as `If-Match`; present, and required, as the document declares it.
- `idempotencyKey`: on writes, as the key rule says.
- `path`: the path parameters no positional argument covers.
- `signal`.

A plain body is sent as JSON. `FormData`, `URLSearchParams`, a `Blob`, a buffer or a stream is sent
as it is.

A result has openapi-fetch's shape, `{ data, response }` on a 2xx and `{ error, response }`
otherwise, so it goes straight to `useAPISubmit` and the other submit hooks. `data` and `error` are
typed from the declared responses (`unknown` where there are none). A JSON body is parsed, others come
back as text, and an empty body is `undefined` (`''` as an error). A network failure throws.

## Idempotency keys

- **`every-write`** (default): every POST, PUT, PATCH and DELETE must name `idempotencyKey`, or
  `{ none: 'the reason' }`. Leaving it out doesn't compile, and an untyped caller gets a
  `TypeError` before anything is sent. Use it with `useIdempotencyKey`, whose key lasts for the
  whole attempt, so a resubmit after a lost response reuses it.
- **`declared`**: as `every-write`, but only on the writes whose operation declares an
  `Idempotency-Key` header. isik declares it exactly where it takes a claim and leaves it off its
  exempt actions, including a project's own `idempotency_exempt_actions`. So for an isik API this
  follows the server's own decision, and calls never restate an exemption.
- **`minted`**: nothing is required. A write that names no key gets a fresh v4 UUID (`generateKey`
  replaces the generator, and `null` sends none). A key minted per call protects only that call, so
  use this for scripts, not forms.

## The client's options

`baseUrl`; `fetch` (default: the global one, looked up per call; pass `createDjangoFetch(...)` for
CSRF and cookie forwarding); `headers`, an object or a function called per request; `pathParams`
when the prefix has parameters; `generateKey` under `minted`; and `onRequest`, which gets an event
when each request starts and ends (method, path, URL, idempotency key, etag, status, time,
`X-Request-Id`). `logRequests` from [`@isikk/core/debug`](debug.md) logs those events.

## Programmatic use

```typescript
import { generateClient } from '@isikk/core/codegen'

const { code, warnings } = generateClient(document, { types: './schema', keys: 'declared' })
```

`document` is the parsed OpenAPI object.
