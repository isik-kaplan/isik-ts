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
- [cookies.md](cookies.md) - `getCookie` (also from a `Cookie` header), `setCookie`, `removeCookie` (browser, via `document.cookie`)
- [console.md](console.md) - `createConsoleDebugSwitch`
- [colors.md](colors.md) - `generateTailwindColorScale`, `generateNamedTailwindColorScale`, `hexToHSLTriplet`
- [http.md](http.md) - `createDjangoFetch`, `nameFetchFailures`, `retryAfterOf`, `etagOf`, `ifMatch`, `anyVersion`, `idempotencyKey`, `isPreconditionFailed`, `isPreconditionRequired`, and the `Versioned` / `Keyed` / `IdempotencyKey` brands

## React (`@isikk/core/hooks`)

- [hooks.md](hooks.md) - `useElementAttributes`, `useFormState`, `useValidatedFormState`, `useVersionedFormState`,
  `useAPISubmit`, `createSubmitHooks`, `PreconditionRequiredError`, `useIdempotencyKey`, `useIdempotencyKeyOf`, `useEffectAfterMount`, `useIsMounted`,
  `useBrowserSupportsPasskeys`,
  `useFilePaste`, `useFileDragDrop` (peer dep: `react`)

## Codegen (`isikk-gen-client`, `@isikk/core/codegen`)

- [codegen.md](codegen.md) - `isikk-gen-client schema.yml -o client.ts`: a finished, self-contained
  API client from an OpenAPI document, beside openapi-typescript's types - resources with `list`,
  `create`, `get`, `update`, `replace`, `remove` and named actions (`rotateSecret(id, ...)`), typed per
  operation, with an `Idempotency-Key` rule (`every-write`, `declared`, `minted`); `generateClient`
  for programmatic use (dependency: `yaml`, for the command)

## Debug (`@isikk/core/debug`)

- [debug.md](debug.md) - `debug(true | false | 'app:*')` persisted as `localStorage.debug`,
  `createDebug(namespace)` loggers with groups and a replay buffer, `quietConsole()` to call above
  `Sentry.init`, and `logRequests(logger)` for a generated client's `onRequest` (peer: none)

## Offline sync (`@isikk/core/sync`, `@isikk/core/sync/react`)

- [sync.md](sync.md) - `openSyncEngine`, `createIndexedDBAdapter`, `createSQLiteAdapter` + `expoSQLite`,
  `createMemoryAdapter`, `batchPush` / `restPush`, `goOffline` / `goOnline` and `syncFully` with
  progress, and the hooks `useLiveQuery`, `useSyncedWrite`, `usePendingWrites`, `useSyncStatus`,
  `useSyncProgress`: a local copy, an offline write queue and a feed, against the isik sync protocol
  in `protocol/sync/v1/` (peer: `react` for the hooks)

## Django REST framework (`@isikk/core/drf`)

- [drf.md](drf.md) - `toFormErrors`, `codesOf`, `detailOf`, `messagesOf`: readers for DRF's two error shapes, plain or full-detail
  (peer: none, pure functions)

## django-allauth (`@isikk/core/allauth`)

- [allauth.md](allauth.md) - `toFormErrors`, `detailOf`, `errorsOf`, `allauthEnvelope`, and the pending-flow readers: readers for allauth's
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

- [next/](next/README.md) - `runProxyIfPathMatches`, `chainProxies`, `stripEmptyQueryParams`, the
  server-side `setCookie`/`getCookie`/`removeCookie`, `getSafeRedirect`, `getRequestOrigin`,
  `createSessionGuards`, `publicConfig` (peer dep: `next`, `react` for `createSessionGuards` and
  `publicConfig`)

## Conventions

- [naming.md](naming.md) - the naming rule every exported name follows

## Everything else

- `src/dates/_format.ts` - internal `date-fns` adapter, not public API, not documented separately
  (see [dates.md](dates.md) for why it's isolated there)
