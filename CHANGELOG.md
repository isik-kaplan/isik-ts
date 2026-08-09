# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-09

### Added

- `publicConfig` takes a `globalKey` option, naming the `window` property the payload is injected
  under instead of always deriving it from `prefix`. Both halves resolve it through one shared
  function from the same options object - which lives at a single call site in the consuming app,
  since only the library import flips between builds - so the server and the browser cannot
  disagree about where the payload went. Any string is accepted (the key is emitted as an escaped
  literal and read with bracket notation); an empty one throws.

### Fixed

- Documented that two `publicConfig()` calls sharing a prefix also derive the same global key, so
  the second payload silently declines to overwrite the first and reads back as `undefined` in the
  browser while resolving correctly on the server. `globalKey` is the way to separate them. The
  0.3.0 docs claimed any number of same-kind calls could share a namespace, which was true of
  `config()` but not of `publicConfig()`.

## [0.3.0] - 2026-08-09

### Added

- `@isikk/core/next/config` (new entry point): `publicConfig(schema, options)` - the
  browser-visible sibling of `config()`, returning `{ CONFIG, PublicConfigScript }`. Same
  nested-caster schema and the same `prefix`/`sep` naming, but resolved **per request** and
  serialized into the document, so one image runs in every environment instead of the one
  `NEXT_PUBLIC_*` bakes its values into at build time.
  - Ships a server build and a browser build behind export conditions rather than a runtime
    branch. The browser build contains no `process.env` reference at all, so bundling the config
    module for the client cannot leak a server value whatever the schema says; `tests/build.test.ts`
    asserts that against the emitted file. `edge-light`/`worker`/`node` are declared above
    `browser`, since Next's edge compiler sets `browser` too and would otherwise resolve
    middleware to the browser build.
  - Resolution is deferred until something reads the config, so `next build` no longer needs the
    environment populated just to compile, and the injected global is read at access time rather
    than at chunk-evaluation time.
  - `PublicConfigScript` awaits `connection()` to force a runtime read, then injects via
    `useServerInsertedHTML` so the payload lands in `<head>` ahead of the App Router's own `async`
    chunk scripts. Takes an optional `nonce`. Under Cache Components it belongs inside a
    `<Suspense>` boundary.
  - The serialized payload escapes `<` and U+2028/U+2029, so a value containing `</script>`
    cannot break out of the tag and a value containing a line separator cannot produce a syntax
    error. The injected object is deep-frozen and non-writable.
- `@isikk/core/node` now also exports the `ConfigSchema`, `InferConfig` and `ConfigOptions`
  types, shared with `publicConfig`.

### Changed

- `config()` records its prefix as a server namespace and throws `ConfigError` when
  `publicConfig()` has claimed an overlapping one (identical, or nested at a separator boundary).
  Any number of same-kind calls may share a namespace - only a server/public overlap is a
  conflict, which is what stops a key pasted into a public schema by mistake from resolving to a
  real secret. Best-effort: the check only fires when both calls are evaluated in the same
  process.
- CI builds before running tests, so the build-output assertions in `tests/build.test.ts` have
  something to assert against. `npm test` now expects `dist/` to exist - run `npm run build`
  first after a fresh clone.

## [0.2.0] - 2026-08-03

### Added

- `src/colors`: Tailwind color scale generation.
  - `generateTailwindColorScale` derives a Tailwind-style `50`-`950` shade scale from a single
    base hex color (treated as `500`), mixing towards white/black in RGB space - no external
    color library dependency. Accepts hex with or without a leading `#`, and 3-digit shorthand;
    throws on invalid input.
  - `generateNamedTailwindColorScale` - same scale, with each shade key prefixed by name
    (`${name}${shade}`) so multiple palettes can be spread into one flat theme object.
  - `hexToHslTriplet` formats a hex color as the `"H S% L%"` triplet shadcn/Tailwind CSS-variable
    themes expect (`--primary: 240 5.9% 10%;`, consumed as `hsl(var(--primary))`).
- `src/next/middleware`: `stripEmptyQueryParams` - redirects to a copy of the request's URL with
  empty-string query params removed, preserving repeated keys (rebuilds `URLSearchParams`
  directly rather than round-tripping through a plain object, which would collapse repeats).
- `@isikk/core/next/request` (new entry point): `getSafeRedirect` (validates a same-origin
  relative redirect target) and `getRequestOrigin` (resolves the true external origin from
  `X-Forwarded-*` headers, with an injectable `isLocalDevHost` predicate).
- `@isikk/core/next/session` (new entry point): `createSessionGuards(fetchSession, options)`
  builds a `requireSession`/`redirectIfPresent` guard pair around a single `cache()`-memoized
  session fetch.
- Root `cookies` module: `setCookie`/`removeCookie` (browser, via `document.cookie`), alongside
  the existing `getCookie`.
- `docs/next/middleware.md`: note on preferring Next's static `config.matcher` over
  `runProxyIfPathMatches` when the exemption doesn't need to be dynamic.

## [0.1.0] - 2026-07-26

### Added

- Initial release of `@isikk/core`.
- `src/types`, `src/strings`, `src/dates`: `getKeys`/`RecursivePartial`/`RecursiveRecord`/
  `forcedType`, `slugify`, `formattedDate` and friends built on `date-fns`.
- `src/arrays`: `notNone` (null/undefined predicate) and `allCombinations` (non-empty powerset,
  grouped by size).
- `src/functions`: `withAttributes`, `makeCallable`, `getLazyValue`/`getLazyValueAsync`,
  `suppress`, `preventDefault`, `isPathMatched`, `raises`, `cloned`, `enabledIf`,
  `transformExceptions`.
- `src/objects`: `checkRequiredKeys`, `requireExclusiveKeys`, `setKeyValueToObjectIfValue`.
- `src/files`, `src/cookies`, `src/console`: browser file/image helpers, `document.cookie` read
  (`getCookie`), `createConsoleDebugSwitch`.
- `src/hooks` (`@isikk/core/hooks`): `useElementAttributes`, `useFormState`,
  `useEffectAfterMount`, `useFilePaste`, `useFileDragDrop`.
- `src/node` (`@isikk/core/node`): `getFileAsString`, `contextLocal`, `config()` + casters.
- `src/next/middleware`, `src/next/cookies`: `runProxyIfPathMatches` and the
  `setCookie`/`getCookie`/`removeCookie` Server Actions.
- Test suite (Vitest 4 + `@fast-check/vitest` property tests) with coverage thresholds hard-set
  to 100%, tsup dual ESM/CJS build, ESLint 9 + Prettier, docs mirroring `src/` layout, and CI
  (tests on push/PR, npm publish via OIDC trusted publishing on version bumps).
