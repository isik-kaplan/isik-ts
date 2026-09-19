# @isikk/core docs

Contents, mirroring the `src/` package layout. Each linked page is short: what it does, when to
reach for it, one usage example.

## Core (`@isikk/core`)

Framework-agnostic, no peer dependencies beyond `date-fns`.

- [types.md](types.md) - `getKeys`, `RecursivePartial`, `RecursiveRecord`, `forcedType`
- [arrays.md](arrays.md) - `notNone`, `allCombinations`
- [functions.md](functions.md) - `withAttributes`, `makeCallable`, `getLazyValue`/`getLazyValueAsync`,
  `suppress`, `preventDefault`, `isPathMatched`, `raises`, `cloned`, `enabledIf`, `transformExceptions`
- [objects.md](objects.md) - `checkRequiredKeys`, `requireExclusiveKeys`, `setKeyValueToObjectIfValue`
- [strings.md](strings.md) - `slugify`
- [dates.md](dates.md) - `formattedDate` and friends, built on `date-fns`
- [files.md](files.md) - browser file/image helpers (MIME guessing, canvas re-encoding, base64)
- [cookies.md](cookies.md) - `getCookie`, `setCookie`, `removeCookie` (browser, via `document.cookie`)
- [console.md](console.md) - `createConsoleDebugSwitch`
- [colors.md](colors.md) - `generateTailwindColorScale`, `generateNamedTailwindColorScale`, `hexToHslTriplet`

## React (`@isikk/core/hooks`)

- [hooks.md](hooks.md) - `useElementAttributes`, `useFormState`, `useEffectAfterMount`,
  `useFilePaste`, `useFileDragDrop` (peer dep: `react`)

## Django REST framework (`@isikk/core/drf`)

- [drf.md](drf.md) - `toFormErrors`, `detailOf`, `messagesOf`: readers for DRF's two error shapes
  (peer: none, pure functions)

## Node (`@isikk/core/node`)

- [node.md](node.md) - `getFileAsString`, `contextLocal`, `config` + casters (peer: none, Node
  built-ins only)

## Next.js (`@isikk/core/next/*`)

- [next/](next/README.md) - `runProxyIfPathMatches`, `stripEmptyQueryParams`, the `setCookie`/
  `getCookie`/`removeCookie` Server Actions, `getSafeRedirect`, `getRequestOrigin`,
  `createSessionGuards`, `publicConfig` (peer dep: `next`, `react` for `createSessionGuards` and
  `publicConfig`)

## Everything else

- `src/dates/_format.ts` - internal `date-fns` adapter, not public API, not documented separately
  (see [dates.md](dates.md) for why it's isolated there)
