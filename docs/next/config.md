# next/config

Import from `@isikk/core/next/config`. Requires `next` (`>=15`, for `connection()`) and `react` as peer dependencies.

Browser-visible configuration read from the environment **at request time** instead of being baked in at build. This is the difference from `NEXT_PUBLIC_*`, which Next inlines during `next build` - one image per environment, and a rebuild to change a URL. Here the same container image runs in staging and production.

```typescript
// app/config.ts
import { publicConfig } from '@isikk/core/next/config'
import { boolean, commaSeparatedList, config, string } from '@isikk/core/node'

// Server-only. Never serialized anywhere.
export const SERVER = config({
  DATABASE: { HOST: string(), PASSWORD: string() },
  SESSION_SECRET: string(),
})

// Browser-visible. Everything here ships in the HTML of every page, in plaintext.
export const { CONFIG, PublicConfigScript } = publicConfig(
  {
    API_URL: string(),
    SENTRY_DSN: string({ missingDefault: '' }),
    FEATURES: {
      NEW_CHECKOUT: boolean({ missingDefault: false }),
      LOCALES: commaSeparatedList({ missingDefault: ['en'] }),
    },
  },
  { prefix: 'PUBLIC' }
)
```

The schema is the same nested-caster schema [`config()`](../node.md#config) takes, with the same `prefix`/`sep` naming and the same `missingDefault`/`errorDefault` rules:

```sh
DATABASE__HOST=db.internal          # server-only
DATABASE__PASSWORD=hunter2
SESSION_SECRET=...

PUBLIC__API_URL=https://api.example.com   # browser-visible
PUBLIC__SENTRY_DSN=https://abc@sentry.io/123
PUBLIC__FEATURES__NEW_CHECKOUT=true
PUBLIC__FEATURES__LOCALES=en,tr,de
```

Render the script once, in the root layout:

```tsx
// app/layout.tsx
import { Suspense } from 'react'

import { PublicConfigScript } from './config'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense>
          <PublicConfigScript />
        </Suspense>
        {children}
      </body>
    </html>
  )
}
```

Then `CONFIG` works identically in server and client components - same import, same type:

```tsx
'use client'

import { CONFIG } from '../app/config'

export function Feedback() {
  if (!CONFIG.FEATURES.NEW_CHECKOUT) return null
  return <a href={`${CONFIG.API_URL}/feedback`}>Send feedback</a>
}
```

`CONFIG.FEATURES.LOCALES` is `string[]` on both sides. On the server that is the caster's output; in the browser it is the already-cast array read back out of an injected global, so nothing is re-parsed client-side.

## Prefixes, and the one overlap that is rejected

`prefix` is optional and has no default, exactly like `config()`. What is enforced is that a namespace claimed by `config()` and one claimed by `publicConfig()` must not overlap.

That rule exists because of one specific mistake. Paste `SESSION_SECRET: string()` into the public schema by accident, with both calls reading the same namespace, and it resolves to the real secret and gets published in the HTML of every page - no error, no failing test, and by the time anyone notices it is in CDN caches and browser histories, so the fix is a rotation rather than a revert. With disjoint namespaces the same paste looks for `PUBLIC__SESSION_SECRET`, finds nothing, and throws.

Only a server/public overlap is a conflict. Any number of `config()` calls may share a namespace, as may any number of `publicConfig()` calls - two server reads of one variable are harmless. Overlap means either identical prefixes, or one nested under the other at a separator boundary (`APP` and `APP__PUBLIC` both reach `APP__PUBLIC__TOKEN`).

An absent prefix counts as a value, so `config()` and `publicConfig()` both unprefixed is the one combination rejected outright. An absent prefix is otherwise treated as disjoint from every named one: unprefixed server config alongside prefixed public config is the most natural setup there is, and the only way it genuinely collides is a server schema with a top-level key named exactly like the public prefix. Rejecting that whole shape would cost more than it buys.

**The check is best-effort.** It fires when both calls are evaluated in the same process. If your server config lives in `lib/server-config.ts` and your public config in `app/config.ts`, a route importing only the latter never triggers it, so a violation can throw on one route and pass silently on another. Treat it as a backstop, not a guarantee - the schema is still the thing to read carefully.

## Values must survive a JSON round-trip

Config reaches the browser as JSON. Every built-in caster (`string`, `integer`, `float`, `boolean`, and the `commaSeparated*` variants) produces something JSON can carry, so this only matters for casters you write yourself with `caster()`:

```typescript
const url = caster((value: string) => new URL(value))
```

That types `CONFIG.SOMETHING` as `URL` on both sides, but the browser receives a plain object - the type is a lie and the first `.hostname` read fails. Keep public schemas to JSON-shaped values and do the richer parsing at the point of use. (The one built-in edge: `float()` on `"-0"` arrives in the browser as `0`, because JSON has no signed zero.)

## How it stays safe

**The export condition split does the work, not the code.** `./next/config` resolves to a different file per environment:

```json
"./next/config": {
  "types": "./dist/next/config/index.d.ts",
  "edge-light": "./dist/next/config/index.js",
  "worker": "./dist/next/config/index.js",
  "node": "./dist/next/config/index.js",
  "browser": "./dist/next/config/browser.js",
  "default": "./dist/next/config/index.js"
}
```

The server build closes over values read from `process.env`; if that same module were ever bundled for the client, everything it touched would ship. The browser build contains no reference to `process.env` at all, so leaking a server value through this module is structurally impossible rather than a discipline someone has to maintain. `tests/build.test.ts` asserts that property against the emitted file on every CI run.

Conditions match in declaration order, which is why `browser` sits below the server-side ones. Next's **edge** compiler sets `browser` alongside `edge-light`/`worker`, so a `browser` entry placed above them would hand middleware and edge routes the browser build - which reads a global that only exists in a document.

**Nothing resolves until something reads it.** `publicConfig()` returns a lazy view, so calling it costs nothing. That matters twice over. On the server, `next build` evaluates modules while collecting page data, and eager resolution there is what forces CI to populate an environment just to compile - with the deferral, a missing variable no longer fails the build, and "can this build" stops depending on "is this configured". In the browser, the injected global is read at access time rather than at chunk-evaluation time, so an `async` chunk that happens to execute before the inline script still sees the config.

**`connection()` forces a per-request read.** Without it a statically prerendered route would freeze the values into the build output, which is the problem this module exists to solve. `PublicConfigScript` awaits it before serializing anything. (Not `unstable_noStore`, which `connection()` replaces.)

**The payload is escaped.** Values travel as a JSON string parsed at runtime, with `<` escaped to `\u003c` and U+2028/U+2029 escaped to `\u2028`/`\u2029`. `JSON.stringify` alone is not enough for a `<script>` body: a value containing `</script>` closes the tag early and drops the rest of the payload into the document as markup, and U+2028/U+2029 are literal line terminators in JavaScript, so a value containing one is a syntax error. The injected object is deep-frozen and defined non-writable, so nothing can reshape config after hydration.

## Constraints worth knowing before you adopt it

- **Cache Components** requires `connection()` to sit inside a `<Suspense>` boundary, hence the wrapper in the layout example. Without Cache Components the boundary is harmless, so it is simplest to always include it.
- **`output: 'export'`** is incompatible - a fully static export has no request to read from. Use `NEXT_PUBLIC_*` there.
- **Next 15+**, because of `connection()`. The package's other `next/*` entry points still support `>=14`.
- **A CSP nonce** goes through the `nonce` prop: `<PublicConfigScript nonce={(await headers()).get('x-nonce') ?? undefined} />` from an async layout.
- **Catch `ConfigError` from the entry point you called.** Each entry point bundles its own copy of the class, so `instanceof` works within an entry point but not across one - use the `ConfigError` exported from `@isikk/core/next/config` for errors thrown by `publicConfig`.
- **Testing outside Next**: the browser half throws a directed error if nothing was injected. Assign the global yourself (`__ISIK_PUBLIC_CONFIG__`, or `__ISIK_PUBLIC_CONFIG__<PREFIX>__` when prefixed) before anything reads the config.

## Why this is a separate entry point, and ESM-only

The same constraint documented in [cookies.md](cookies.md), one directive over: the injection component carries `'use client'`, which Next requires to be the literal first statement of the module it applies to. esbuild's CJS output always injects its own `"use strict"` prologue as line one, which would push the directive to second place and break Next's detection of the client boundary - so these entries are built ESM-only, in their own tsup config run sequentially after the main build.

There is a second, subtler version of the same problem inside the ESM build. Declaring the client component as its own tsup `entry` does not stop esbuild from _also_ inlining it into the server entry that imports it, concatenating modules ahead of the directive and destroying it. Marking the import `external` is what keeps it a real import between two emitted files. `tests/build.test.ts` covers both halves.
