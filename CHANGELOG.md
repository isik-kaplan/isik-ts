# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0] - 2026-10-04

### Added

- `leavesOnSuccess` on `useAPISubmit`'s and `useValidatedFormState`'s submit options: for a form
  whose `onSuccess` navigates, `isSubmitting` stays set after the success and later submits are
  refused, so the old screen cannot send the write again while the next route loads.

### Fixed

- `useAPISubmit` refuses a submit made while another is in flight - it resolves to `false` without
  making the call. Before, two clicks in one frame both got through, because `isSubmitting` only
  disables a button once React commits.

## [0.11.0] - 2026-10-04

### Added

- `@isikk/core/testing`, with `expectUniqueAccessibleNames(container?, roles?)`: throws if two
  controls of the same role share an accessible name - the case that makes an exact
  `getByRole(role, { name })` query throw. Checks the interactive roles by default. Needs
  `@testing-library/dom` and `dom-accessibility-api`, both optional peer dependencies.
- `@isikk/core/allauth`: `toFormErrors`, `detailOf` and `allauthEnvelope`, readers for
  django-allauth's headless `{status, errors: [{message, code, param}]}` refusals.
- `ErrorEnvelope` in `@isikk/core/hooks`: `useAPISubmit(reporter, envelope?)` and
  `useValidatedFormState`'s `{ envelope }` option read another server's refusals. The default is
  still DRF's, so `useAPISubmit(toast, allauthEnvelope)` is how an allauth surface gets the server's
  own sentence instead of the generic `failure`.
- `createSubmitHooks(reporter, envelope?)` in `@isikk/core/hooks`: `useAPISubmit` and
  `useValidatedFormState` with the reporter (and envelope) already bound, so an app names its toast
  once rather than once per hook.
- [docs/naming.md](docs/naming.md): the naming rule every exported name follows.

### Changed

- `useValidatedFormState`'s fourth argument is typed `ValidatedFormStateOptions` - the idempotency
  options plus `envelope`.
- British spellings in comments and test names are now American, per the naming rule.

## [0.10.0] - 2026-10-02

### Changed

- **Breaking:** an acronym in a name is uppercase, except as its leading segment - as in
  `encodeURIComponent` and `toJSON`. Renamed, with no aliases left behind:
  - `useApiSubmit` -> `useAPISubmit` in `@isikk/core/hooks`
  - `ApiResult` -> `APIResult` in `@isikk/core/hooks`
  - `ApiSubmitOptions` -> `APISubmitOptions` in `@isikk/core/hooks`
  - `hexToHslTriplet` -> `hexToHSLTriplet` in `@isikk/core`
  - `guessImageMimeType` -> `guessImageMIMEType` in `@isikk/core`
  - `isImageMimeType` -> `isImageMIMEType` in `@isikk/core`

  Behavior is unchanged; a consumer's compiler names every call site on the bump.

## [0.9.0] - 2026-10-02

### Added

- `useIdempotencyKey(options?)` in `@isikk/core/hooks`: `keyFor(payload)` answers the same
  `Idempotency-Key` for as long as the payload is the same and a new one when it changes, and
  `used()` ends the attempt - so a resubmit after a lost response is the same attempt to the server.
  `generateKey` replaces `crypto.randomUUID()` where there is none, such as React Native.
- `useIdempotencyKeyOf(values, options?)` in `@isikk/core/hooks`: the same, read during render as
  `{ key, used }`.
- `useApiSubmit`'s `onSuccess` receives `{ replayed }` beside the result: whether the server answered
  with `Idempotent-Replayed: true`.
- `useValidatedFormState`'s `submit` hands the call an idempotency key as its second argument, keyed
  on the schema's output and spent on success. A fourth argument, `{ generateKey }`, is passed on.

## [0.8.1] - 2026-09-28

### Fixed

- `toFormErrors` no longer reads a refusal's `code` as a field. `{detail, code}` - DRF's sentence with
  its machine-readable code beside it - showed a person the word `not_authenticated` through
  `messagesOf`, and a 400 `ParseError` in that shape was handed to the form instead of reported. A
  `code` is skipped only beside a string `detail`, so a serializer's own `code` field still reports.

## [0.8.0] - 2026-09-27

### Added

- `toDate(value, unit)` in `@isikk/core`: reads a string, a `Date`, or a number whose unit is named -
  `'seconds'` for allauth's session and passkey payloads, `'milliseconds'` by default.
- `useIsMounted` in `@isikk/core/hooks`: a function that answers whether the component is still
  mounted when it is called. No DOM in it, so it works in React Native.
- `useApiSubmit(reporter)` in `@isikk/core/hooks`: a submitting flag, the call, and the refusal read
  as DRF writes it - a 400's fields into the form, another 4xx's `detail` reported, a 5xx or an
  unreached server reported as the caller's `failure`. The reporter is injected, and sonner's
  `toast` already fits it. `isSuccess` overrides what counts as success.
- `useValidatedFormState(schema, initialState, reporter)` in `@isikk/core/hooks`: `useFormState`
  with any Standard Schema validator, composed with `useApiSubmit` so the schema's and the server's
  field errors land in the same `formErrors`. A server error naming a field the form does not hold
  joins `non_field_errors`. The call receives the schema's output. `validate()` is synchronous
  and throws for a schema that answers asynchronously; `submit()` accepts either.

## [0.7.0] - 2026-09-19

### Added

- `@isikk/core/drf` with `toFormErrors`, `detailOf` and `messagesOf`: readers for the two shapes
  Django REST framework refuses in - `{field: [messages]}` for a 400 and `{detail: sentence}` for
  everything else. Pure functions with no peer dependencies, in their own entry point so the core
  stays framework-neutral.

## [0.6.0] - 2026-08-09

Absorbs everything tagged `0.5.0` below. **0.5.0 was never published**: its CI run failed on an
unrelated flaky property test (see Fixed), so the publish job skipped and the version number went
unused. Consumers go from `0.4.0` straight to `0.6.0`, and this entry is the whole of that jump.

### Added

- `@isikk/core/next/config` re-exports every caster (`string`, `integer`, `float`, `boolean`,
  the `commaSeparated*` variants and the `caster` factory), so a schema can be written without
  importing `@isikk/core/node`. Without this the documented usage pattern **could not build**:
  a schema has to live at a call site shared with client components and edge routes, but importing
  casters from `/node` pulls in that barrel's `contextLocal` (`async_hooks`) and `getFileAsString`
  (`fs`), which have no resolution in those bundles. The casters themselves are pure
  `(value: string) => T` factories and add no environment access to the browser build.

### Changed

- **Breaking:** `publicConfig`'s `globalKey` option is now required, and `options` with it. There
  is no default and nothing derived from `prefix` - the package no longer picks a name on any
  consuming app's `window`. Omitting it throws `ConfigError` naming what's missing.
  - The injected property lands in the app's global namespace, so the name belongs to the app.
    A package-chosen `__SOME_PACKAGE_CONFIG__` wrote this package's identity into every app that
    installed it.
  - A derived default was also a name two `publicConfig()` calls could agree on without either
    writing it down. Since the payload is injected non-writable, the second injection declines to
    overwrite the first, so that config read back as `undefined` in the browser while still
    resolving on the server. Requiring the name turns an invisible collision into two readable
    lines, and makes the 0.4.0 caveat about sharing a prefix moot - nothing about the browser
    payload derives from `prefix` any more.
  - Any non-empty string is accepted. Empty strings, and non-strings from callers without types,
    throw.
  - Migration: add `{ globalKey: '__YOUR_APP_CONFIG__' }` to every `publicConfig()` call. Existing
    0.4.0 callers relying on the derived name can pass their old key
    (`__ISIK_PUBLIC_CONFIG__`, or `__ISIK_PUBLIC_CONFIG__<PREFIX>__` when prefixed) to keep the
    emitted payload byte-identical.

### Fixed

- `tests/objects/index.test.ts` asserted `key in object` for the falsy branch of
  `setKeyValueToObjectIfValue`. `in` walks the prototype chain, so any key inherited from
  `Object.prototype` - `valueOf`, `toString`, `hasOwnProperty`, `__defineGetter__` - reported `true`
  on a fresh `{}` even though nothing had been set. Whether CI passed depended on whether the run's
  random seed produced one of those names with a falsy value; seed `1770714701` found
  `["valueOf", 0]` and took down the 0.5.0 release. Now asserts own-property presence, which is what
  the implementation actually promises, and the arbitrary no longer needs to filter
  `__proto__`/`constructor`/`prototype` out - they hold too. The implementation was always correct.
- Documented that `connection()` inside `PublicConfigScript` makes the _payload_ dynamic but does
  not cover a sibling component's synchronous `CONFIG` read, which still executes during the
  prerender pass. A route reading config in a server component needs
  `export const dynamic = 'force-dynamic'`; a route whose HTML depends on the server's environment
  is dynamic by definition. The 0.3.0 docs implied `PublicConfigScript` handled this for the whole
  route.
- Dependencies: `next` 16.2.12 -> 16.3.0, plus transitive `postcss` and `sharp`, clearing six
  high-severity advisories. Dev-only - none of these ship in `dist/`.

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
