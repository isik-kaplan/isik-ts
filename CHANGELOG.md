# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
