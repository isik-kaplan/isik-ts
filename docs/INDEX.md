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
- [dates.md](dates.md) - `formattedDate` and friends, built on `date-fns`, and `toDate`
- [files.md](files.md) - browser file/image helpers (MIME guessing, canvas re-encoding, base64)
- [cookies.md](cookies.md) - `getCookie`, `setCookie`, `removeCookie` (browser, via `document.cookie`)
- [console.md](console.md) - `createConsoleDebugSwitch`
- [colors.md](colors.md) - `generateTailwindColorScale`, `generateNamedTailwindColorScale`, `hexToHSLTriplet`

## React (`@isikk/core/hooks`)

- [hooks.md](hooks.md) - `useElementAttributes`, `useFormState`, `useValidatedFormState`,
  `useAPISubmit`, `createSubmitHooks`, `useIdempotencyKey`, `useIdempotencyKeyOf`, `useEffectAfterMount`, `useIsMounted`,
  `useBrowserSupportsPasskeys`,
  `useFilePaste`, `useFileDragDrop` (peer dep: `react`)

## Django REST framework (`@isikk/core/drf`)

- [drf.md](drf.md) - `toFormErrors`, `detailOf`, `messagesOf`: readers for DRF's two error shapes
  (peer: none, pure functions)

## django-allauth (`@isikk/core/allauth`)

- [allauth.md](allauth.md) - `toFormErrors`, `detailOf`, `allauthEnvelope`: readers for allauth's
  headless error shape, for `useAPISubmit` and friends (peer: none, pure functions)

## WebAuthn (`@isikk/core/webauthn`)

- [webauthn.md](webauthn.md) - `createCredential`, `getCredential`, `parseCreationOptionsFromJSON`,
  `parseRequestOptionsFromJSON`, `credentialToJSON`, `browserSupportsPasskeys`, `inASecureContext`:
  passkeys against a server that speaks WebAuthn's JSON, allauth's headless MFA included (peer: none,
  browser APIs only)

## Testing (`@isikk/core/testing`)

- [testing.md](testing.md) - `expectUniqueAccessibleNames` (optional peers: `@testing-library/dom`,
  `dom-accessibility-api`)

## Node (`@isikk/core/node`)

- [node.md](node.md) - `getFileAsString`, `contextLocal`, `config` + casters (peer: none, Node
  built-ins only)

## Next.js (`@isikk/core/next/*`)

- [next/](next/README.md) - `runProxyIfPathMatches`, `stripEmptyQueryParams`, the `setCookie`/
  `getCookie`/`removeCookie` Server Actions, `getSafeRedirect`, `getRequestOrigin`,
  `createSessionGuards`, `publicConfig` (peer dep: `next`, `react` for `createSessionGuards` and
  `publicConfig`)

## Conventions

- [naming.md](naming.md) - the naming rule every exported name follows

## Everything else

- `src/dates/_format.ts` - internal `date-fns` adapter, not public API, not documented separately
  (see [dates.md](dates.md) for why it's isolated there)
