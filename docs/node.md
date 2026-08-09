# node

Import from `@isikk/core/node`. Node-only (uses `fs`/`path`/`node:async_hooks`/`process.env`) - do not import this from browser-bundled code.

## getFileAsString

Reads a file (path resolved relative to `process.cwd()`) and returns its contents as a UTF-8 string. Never throws - on failure it logs the error via `console.error` and returns an `'Error reading file: ...'` string instead.

```typescript
import { getFileAsString } from '@isikk/core/node'

const content = await getFileAsString('templates/welcome.txt')
```

## contextLocal

A named registry of [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html#class-asynclocalstorage) instances: `contextLocal("REQUEST")` always returns the same storage for that name, process-wide - so any two places in your codebase that call `contextLocal("REQUEST")` share the same store, without needing to create one `AsyncLocalStorage` instance somewhere and import/pass it around everywhere it's used.

```typescript
import { contextLocal } from '@isikk/core/node'

const requestContext = contextLocal<{ userId: string }>('REQUEST')

// somewhere near the top of a request's handling:
requestContext.run({ userId: '123' }, async () => {
  await handleRequest() // and anywhere within this call tree, however deep:
  requestContext.getStore() // { userId: '123' }
})
```

- Each name gets a genuinely independent `AsyncLocalStorage`, correctly isolated per concurrent async call tree - two concurrent `requestContext.run(...)` calls never see each other's store.
- Outside of a `run()` call, `getStore()` returns `undefined`.

## config

Builds a typed config object by reading and casting environment variables against a schema, throwing a clear `ConfigError` (not a raw parse exception) when something's wrong - a required variable is missing, or a value doesn't parse - unless the caster used for that key was given a fallback.

```typescript
import { boolean, commaSeparatedList, config, integer, string } from '@isikk/core/node'

const env = config({
  PORT: integer(),
  DEBUG: boolean({ missingDefault: false }),
  ALLOWED_HOSTS: commaSeparatedList(),
  DATABASE: {
    HOST: string(),
    PORT: integer({ missingDefault: 5432 }),
  },
})

env.PORT // number, read from process.env.PORT - throws ConfigError if unset or unparseable
env.DEBUG // boolean, defaults to false if process.env.DEBUG is unset
env.DATABASE.HOST // string, read from process.env.DATABASE__HOST (nested keys join with "__" by default)
```

- Each schema leaf is a **caster** - a small factory you call (optionally with `missingDefault`/`errorDefault`) to produce the actual value used in the schema. Built-in casters: `string`, `integer`, `float`, `boolean`, `commaSeparatedList`, `commaSeparatedIntList`, `commaSeparatedFloatList`.
  - `missingDefault` is used when the environment variable isn't set at all.
  - `errorDefault` is used when the variable is set but the caster throws trying to parse it.
  - Neither is required - if you omit them, a missing or unparseable variable throws `ConfigError` instead.
- Environment variable names are built by joining the schema's key path with `sep` (`"__"` by default) - `{ DATABASE: { HOST: string() } }` reads `process.env.DATABASE__HOST`. Pass `{ prefix: 'MYAPP' }` to prepend a namespace to every variable name (`MYAPP__DATABASE__HOST`), or `{ sep: '.' }` to change the joiner.
- Values read here are server-only - nothing in this module serializes them anywhere. `config()` records its prefix as a **server** namespace, and throws `ConfigError` if [`publicConfig()`](next/config.md) has claimed an overlapping one, so a key pasted into a browser-visible schema by mistake can't quietly resolve to a server secret. Any number of `config()` calls may share a namespace; only a server/public overlap is rejected. See [next/config.md](next/config.md#prefixes-and-the-one-overlap-that-is-rejected).
- Write your own caster with the `caster` factory - wrap any `(value: string) => T` function:

  ```typescript
  import { caster } from '@isikk/core/node'

  const json = caster((value: string) => JSON.parse(value))
  ```

- Unlike Python's `int()`/`float()`, JavaScript's `Number()`/`parseInt()`/`parseFloat()` don't throw on unparseable input (`parseInt('123abc')` silently returns `123`, `Number('')` silently returns `0`) - `integer`/`float` (and their comma-separated list variants) validate the _entire_ string is a clean number and throw otherwise, so `missingDefault`/`errorDefault`/the thrown `ConfigError` all actually trigger when you'd expect them to.
- This is a from-scratch, minimal builder - if you're already using (or open to adding) a dedicated config library, [`envalid`](https://github.com/af/envalid), [`t3-env`](https://env.t3.gg/)/`zod`, or [`convict`](https://github.com/mozilla/node-convict) all cover similar ground with more features (schema validation reporting, `.env` file loading, etc.). This exists for projects that want a typed env-var config without adding a dependency for it.
