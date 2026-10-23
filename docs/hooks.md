# hooks

Import from `@isikk/core/hooks`. Requires `react` as a peer dependency (`>=18`).

## useElementAttributes

Reads a set of DOM properties off a ref'd element, re-reading on window resize and on any attribute mutation (via `MutationObserver`). Returns the ref to attach plus the current values.

```tsx
import { useElementAttributes } from '@isikk/core/hooks'

const ATTRIBUTE_KEYS = ['disabled', 'value'] as const

function Example() {
  const { ref, attributeValues } = useElementAttributes<HTMLInputElement, (typeof ATTRIBUTE_KEYS)[number]>(
    ATTRIBUTE_KEYS
  )

  return <input ref={ref} disabled value="hello" readOnly />
  // attributeValues === { disabled: true, value: 'hello' }
}
```

- `attributeKeys` is a dependency of this hook's internal effect (it re-reads and re-attaches its resize/mutation listeners whenever the array reference changes) - pass a stable reference (a module-level constant, or a `useMemo`'d array), not a fresh literal on every render.

## useFormState

Manages form state, field-level errors, and change/value/click handlers for a plain object shape - avoids writing a `setFormState(prev => ({ ...prev, [key]: value }))` by hand for every field.

```tsx
import { useFormState } from '@isikk/core/hooks'

function Example() {
  const { formState, formErrors, handleFormStateValue, handleFormStateEvent, resetFormState } = useFormState({
    name: '',
  })

  return (
    <>
      <input value={formState.name} onChange={handleFormStateEvent('name')} />
      {formErrors?.name && <span>{formErrors.name[0]}</span>}
      <button onClick={resetFormState}>Reset</button>
    </>
  )
}
```

- `handleFormStateValue(key)` returns a setter that takes the value directly (`onSelect={handleFormStateValue('name')}` style, called as `fn(value)`).
- `handleFormStateEvent(key)` returns a setter that takes a change event, reading `.checked` for checkboxes, `.valueAsNumber` for `number`/`range` inputs, and `.value` (a string) for everything else - so a field typed `number` in your state actually receives a `number` at runtime, not a numeric-looking string. For any other input type where `.value`'s string shape doesn't match your field's type, use `handleFormStateValue` instead and convert yourself.
- `handleFormStateOnClick(key, value)` returns a zero-argument handler that sets `key` to a fixed `value` (for `<button onClick={...}>` style toggles).
- `setFormErrors`/`setFormState` are exposed directly for the rare case the handlers above don't cover.

## useEffectAfterMount

Like `useEffect`, but skips the run on initial mount - only fires when a dependency actually changes afterward.

```tsx
import { useEffectAfterMount } from '@isikk/core/hooks'

function Example({ query }: { query: string }) {
  useEffectAfterMount(() => {
    trackSearch(query) // not called on first render, only on subsequent changes to query
  }, [query])
}
```

Under `<StrictMode>` too: React's development-only second mount is still a mount, so the effect does not run there either, and development behaves as production does.

## useIsMounted

Returns a function that answers whether the component is still mounted **at the moment it is called** - for an effect whose work outlives the component, such as a fetch that resolves after the screen was left. Reads `false` during the first render. No DOM in it, so it works the same in React Native.

```tsx
import { useIsMounted } from '@isikk/core/hooks'

function Profile() {
  const isMounted = useIsMounted()
  const [profile, setProfile] = useState<Profile>()

  useEffect(() => {
    fetchProfile().then((p) => {
      if (isMounted()) setProfile(p)
    })
  }, [isMounted])
}
```

The returned function keeps its identity across renders, so it is safe in a dependency list.

## useIdempotencyKey

An `Idempotency-Key` that belongs to the **attempt**, not the call. A key minted per call protects nothing: a person who presses submit again after a lost response makes a second call with a second key, and the server does the work twice. `keyFor(payload)` answers the same key for as long as the payload is the same, and a new one the moment it changes. `used()` ends the attempt once the server accepted it.

```tsx
import { useAPISubmit, useIdempotencyKey } from '@isikk/core/hooks'

import { toast } from 'sonner'

function PayButton({ amount }: { amount: number }) {
  const { isSubmitting, submit } = useAPISubmit(toast)
  const { keyFor, used } = useIdempotencyKey()

  return (
    <button
      disabled={isSubmitting}
      onClick={() => {
        const body = { amount }
        submit(() => api.POST('/payments/', { body, headers: { 'Idempotency-Key': keyFor(body) } }), {
          failure: 'Could not pay.',
          onSuccess: used,
        })
      }}
    />
  )
}
```

- Because the key changes exactly when the payload does, the browser never sends one key with two payloads. A server's "same key, different payload" refusal then only ever means some other caller.
- Spend it only on success. After a throw or a refusal, the same payload sent again is the same attempt.
- `keyFor()` with no argument keys a write with no body.
- `headerFor(payload)` is `keyFor` as the header, `{ 'Idempotency-Key': key }`, branded `Keyed` for a client method that requires one (see [Branded headers](#branded-headers)). `keyFor` answers an `IdempotencyKey`, which is still a string wherever one is taken.
- Placing the header is the caller's - every client places it differently.
- The default key is a v4 UUID: `crypto.randomUUID()` where there is one, and one built from `crypto.getRandomValues()` where there is not - a page on plain http behind a hostname or a LAN IP is not a secure context, and has no `randomUUID`. Bare Hermes has neither, and minting a key there throws an error naming `generateKey`; pass one, or install `react-native-get-random-values`: `useIdempotencyKey({ generateKey: uuid })`.
- Payloads are compared by `JSON.stringify`. A reordered object gets a new key, which is harmless. A `File` reads as `{}`, so a multipart form passes its own snapshot - file names and sizes, say - as the payload. A `BigInt` or a cycle throws.

### useIdempotencyKeyOf

`useIdempotencyKeyOf(values, options?)` is the same thing read during render, returning `{ key, used }`, for a caller that wants the key as a value. Prefer `useIdempotencyKey` where the payload is at hand when sending: this one keys the values as rendered, which are not always what is sent - a schema's `.trim()` turns two values into one payload, and this gives them two keys. `used()` re-renders, so `key` is fresh after it.

## useAPISubmit

The tail every write shares: a submitting flag, the call, and the server's refusal put where a person can read it. Refusals are read as Django REST framework writes them (see [drf.md](drf.md)).

It takes a `Reporter` - `{ success(message), error(message) }` - because a library cannot pick the app's toast. sonner's `toast` has that shape already:

```tsx
import { useAPISubmit } from '@isikk/core/hooks'

import { toast } from 'sonner'

function RevokeButton({ id }: { id: string }) {
  const { isSubmitting, submit } = useAPISubmit(toast)
  const router = useRouter()

  return (
    <button
      disabled={isSubmitting}
      onClick={() =>
        submit(() => api.DELETE('/tokens/{id}/', { params: { path: { id } } }), {
          success: 'Revoked.',
          failure: 'Could not revoke the token.',
          onSuccess: () => router.refresh(),
        })
      }
    />
  )
}
```

`call` returns an openapi-fetch-shaped result, `{ data?, error?, response? }`. `submit` resolves to whether it succeeded.

- **Success** is no `error` and a response that is `ok` (or no response at all). Pass `isSuccess(result)` for an endpoint that succeeds with a non-2xx - allauth answers an already-logged-in visitor with a 409. `onSuccess(result, { replayed, etag })` receives the result; whether the server answered with `Idempotent-Replayed: true`, which is worth saying "already done" rather than "saved"; and the new version's token (the body's `etag` field, else the `ETag` header, else `null`).
- **A 400** is read as field errors. Given `setFormErrors`, they go there and nothing is reported. Without it, every message is reported as one line.
- **A 429** reports the `throttled` message, whatever the body says, and never reaches `setFormErrors` - see below.
- **A 412** reports the `stale` message and calls `onStale({ current, etag })` - see [Optimistic concurrency](#optimistic-concurrency). **A 428** reports `failure` and throws `PreconditionRequiredError`.
- **Any other 4xx** reports DRF's `detail` sentence. **A 5xx, or no response at all,** reports `failure` - that body is not written for a person, and often is not JSON.
- Anything unreadable falls back to `failure`, so another server's errors read as a failure, not as none.
- A `call` that throws releases `isSubmitting` and rethrows.
- Refreshing or navigating stays at the call site, through `onSuccess` - reaching for a router inside would make every caller a router consumer.
- **A form that navigates on success passes `leavesOnSuccess: true`.** `isSubmitting` then stays set after the success, and every later submit is refused, because an app-router navigation is a fetch rather than a frame and the old screen stays mounted - and clickable - while it runs. The price is that a navigation that is cancelled or fails leaves the form disabled until a reload: a dead button is recoverable, a second write is not.
- A submit made while another is in flight is refused: it resolves to `false` and its call is never made. `disabled={isSubmitting}` only takes effect once React commits, so this is what stops two clicks in one frame.
- The second argument, `{ envelope, throttled, stale }`, is optional.
- `envelope`, an `ErrorEnvelope` - `{ toFormErrors(body), detailOf(body) }` - reads another server's refusals. `useAPISubmit(toast, { envelope: allauthEnvelope })` reads django-allauth's headless API (see [allauth.md](allauth.md)). The status rules above stay the same: a 400 is read for fields, a 429 not at all, another 4xx for its sentence.
- `throttled`, `(seconds: number | null) => string`, is what a 429 reports. `seconds` is the response's `Retry-After` read by [`retryAfterOf`](http.md#retryafterof), or `null` when it named no wait - allauth's never does. It is called as the 429 is reported, so it can call i18next's `t()` in the current language. A call overrides it with its own `throttled` submit option. The default is English: `Too many requests. Try again in 30 seconds.`, or `Too many requests. Wait a moment and try again.` with no wait.

  A 429 is not read from the body because three different things answer one - a DRF throttle with an English `detail` that cannot be translated, allauth with often no message at all, a proxy with its own - and they all mean the same thing to the person.

- `stale`, `() => string`, is what a 412 reports, called as it is reported. A call overrides it with its own `stale` option. The default is English: `Someone else changed this while you were editing. Review their changes.`

### Branded headers

`Versioned` and `Keyed`, from `@isikk/core`, are type-only marks on headers whose write decided its version, or carries a key one of these hooks made. A client method that requires them refuses headers built without that decision - a forgotten `etag` becomes a compile error, not a 428 at runtime:

```ts
import type { Keyed, Versioned } from '@isikk/core'

function updateNote(id: string, body: NoteUpdate, headers: WriteHeaders & Versioned) {
  return api.PATCH('/notes/{id}/', { params: { path: { id } }, body, headers })
}

submit((headers) => updateNote(id, body, headers), { etag: note.etag, failure: 'Could not save.' }) // compiles
submit((headers) => updateNote(id, body, headers), { failure: 'Could not save.' }) // does not
```

- The headers `submit` hands its call are `Versioned` when the options carry `etag` - a string, or `null`. The brand means **versioning was decided**, not that `If-Match` is present: `etag: null` is the deliberate "this write holds no version", which sends none and expects the server's 428.
- An `etag` whose type may be `undefined` - `note?.etag` - leaves the headers unbranded, so the client method refuses them. The fix is `etag: note?.etag ?? null`, which says what was meant.
- `ifMatch(etag)` and `anyVersion()` are `Versioned`; `idempotencyKey(key)` and `headerFor(payload)` are `Keyed`. A spread keeps the brand, `{ ...headers, Authorization }`; picking keys into a new object drops it.
- Nothing carries it at runtime - the headers stay a plain record for any client.
- When the call's headers do not fit, TypeScript reports it at the client method's argument. A mistyped option elsewhere in `submit` reads "No overload matches this call", which lists each overload.

### Optimistic concurrency

For a server that versions its rows with `ETag` / `If-Match` - isik's `PreconditionMixin` among them. A write names the version it was based on, and a server holding a newer one refuses it with a 412 rather than overwriting someone else's change.

The call is handed the headers to send, since only it knows how its client places them:

```tsx
submit((headers) => api.DELETE('/notes/{id}/', { params: { path: { id } }, headers }), {
  etag: note.etag,
  failure: 'Could not delete the note.',
  onStale: ({ current, etag }) => showTheirs(current, etag),
})
```

- `etag` on the submit options is sent as `If-Match`, verbatim, and brands the call's headers `Versioned` (see above). `'*'` overwrites whatever is there. Without one, or with `null`, the call is handed `{}`.
- Read the token from the item's `etag` body field where the server has one. It is never weakened by compression, and a cross-origin page can read it without `Access-Control-Expose-Headers: ETag`. `etagOf(response)` in [http.md](http.md) reads the header.
- **A 412** reports `stale` - never the body's English `detail`, never through `setFormErrors` - and hands `onStale` the body's `current` (the server's version) and its token: `current.etag`, else the `ETag` header, else `null`. `submit` resolves to `false`.
- **A 428** means the write was sent without a token the server needs. Only the code can fix that, so after reporting `failure` it throws `PreconditionRequiredError`, with the form unlocked, for an error boundary or error tracking to catch.
- Cross-origin, the API has to allow the header in and the token out: `If-Match` in django-cors-headers' `CORS_ALLOW_HEADERS`, and `ETag` in `CORS_EXPOSE_HEADERS` if the header is read. Without them every cross-origin write fails.

## useValidatedFormState

`useFormState`, a schema, and `useAPISubmit`, composed. The schema is any [Standard Schema](https://standardschema.dev) - zod, valibot, ArkType - so none of them is a dependency of this package.

```tsx
import { useValidatedFormState } from '@isikk/core/hooks'

import { toast } from 'sonner'
import { z } from 'zod'

const schema = z.object({ name: z.string().trim().min(1, 'Required.') })

function RenameForm() {
  const { formState, formErrors, handleFormStateEvent, isSubmitting, submit } = useValidatedFormState(
    schema,
    { name: '' },
    toast
  )

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await submit((value) => api.PATCH('/org/', { body: value }), { failure: 'Could not rename.' })
  }
  // ...
}
```

Returns everything `useFormState` does, plus `validate`, `isSubmitting` and `submit`.

- `submit` validates first and never makes the call when the schema refuses. The call receives the schema's **output**, so a `.trim()` or a coercion is not lost.
- The call's second argument is an idempotency key from `useIdempotencyKey`, an `IdempotencyKey` - a string, branded so a client method can require one the hooks made - keyed on that output and spent on success: `submit((value, key) => api.POST('/orgs/', { body: value, headers: { 'Idempotency-Key': key } }), ...)`. A write that sends no key - a PATCH, say - passes `idempotencyKey: false` in the submit options: the call then takes the value alone, no key is minted, and so none is needed from a runtime that could not make one.
- The fourth argument, `{ generateKey, envelope, throttled, stale }`, replaces the default key generator, and reads another server's refusals and words a 429 and a 412 as `useAPISubmit`'s second argument does.
- A form editing a row the server versions with `ETag` / `If-Match` uses [`useVersionedFormState`](#useversionedformstate) instead.
- The schema's issues and the server's 400 land in the same `formErrors`, so a refusal from either side renders in the same place. An issue is filed under the first segment of its path; one with no path goes under `non_field_errors`.
- A server error naming a field the form state does not hold joins `non_field_errors` rather than being dropped - a serializer can refuse a column this form never shows.
- `validate()` returns a `boolean`, so `if (!validate()) return` works. It needs a synchronous schema - every zod or valibot schema without an async refinement - and throws a `TypeError` for one that answers with a Promise, rather than returning a Promise that would always read as valid. `submit` awaits the schema, so it accepts either.

## useVersionedFormState

`useValidatedFormState` for a row the server versions with `ETag` / `If-Match` - isik's `PreconditionMixin` among them. It takes the same arguments, plus a required `etag` - the loaded item's `etag` field - which the form sends as `If-Match` on every submit and keeps current itself. It returns the same, plus `etag`, `conflict`, `takeTheirs` and `keepMine`.

Its own hook rather than an option, because the call takes a different second argument: the headers to send, `Idempotency-Key` and `If-Match` together, ready to spread into the client's own.

```tsx
const { formState, conflict, takeTheirs, keepMine, submit } = useVersionedFormState(schema, note, toast, {
  etag: note.etag,
})

await submit((value, headers) => api.PATCH('/notes/{id}/', { params: { path: { id } }, body: value, headers }), {
  failure: 'Could not save.',
  idempotencyKey: false,
})

if (conflict) {
  // conflict.mine: what was sent. conflict.theirs: the server's version, as form state.
  // <button onClick={takeTheirs}>Use theirs</button> <button onClick={keepMine}>Keep mine</button>
}
```

- `etag` is required, so a form cannot forget it and meet a 428; pass `null` for an item not loaded yet, and no `If-Match` is sent. The call's second argument is `{ 'Idempotency-Key'?, 'If-Match'? }`, always [`Versioned`](#branded-headers) and `Keyed` too unless `idempotencyKey: false` - or a flag known only at runtime, which cannot promise a key.
- The `etag` it returns is the token the form holds now. A success's new one replaces it, from the body's `etag` field or the `ETag` header, so a second save sends the right one. A new `etag` option - a refetch - replaces it too.
- A 412 sets `conflict: { mine, theirs, current, etag }`. `mine` is the form state as submitted. `current` is the 412 body's `current`. `theirs` is `current` as form state: by default the form's own keys read from it, keeping the form's value for any it lacks. Pass `fromServer(current, mine)` for a representation that does not map key for key. `etag` is the server's new token. The form keeps its own token until the person chooses.
- `takeTheirs()` drops the edits: the form takes `theirs` and its token, and `formErrors` and `conflict` clear.
- `keepMine()` writes the edits over theirs: it runs the last `submit` again, with the form as it stands now and `If-Match` set to `conflict.etag`, and resolves as `submit` does. Without a conflict it resolves to `false` and sends nothing.
- A 412 ends the idempotency attempt, so `keepMine` sends a new key. Its write carries another `If-Match`, so it is another request, and the old key would have the server answer it from the refused one.
- A later success clears `conflict`. Rendering it is the page's: this is state only.
- `conflict.current` is `null` when the row is gone - a server set to answer a deleted row with a 412 rather than a 404. Then `theirs` is `mine` and `etag` is `null`: offer neither choice, since there is nothing to take and `keepMine` would send no `If-Match`.
- `'*'` overwrites whatever version is there. Send it - as `etag` on `useAPISubmit` - only when the person chose to overwrite. A server may refuse it with a 428, which throws as a missing token does.

## createSubmitHooks

`useAPISubmit` and `useValidatedFormState` with the reporter already supplied, so an app names its toast once rather than once per hook:

```tsx
// lib/hooks.ts
import { createSubmitHooks } from '@isikk/core/hooks'

import { toast } from 'sonner'

export const { useAPISubmit, useValidatedFormState } = createSubmitHooks(toast)
```

The returned hooks - `useAPISubmit`, `useValidatedFormState` and `useVersionedFormState` - take every argument the originals do except the reporter. An optional second argument, `{ envelope, throttled, stale }`, binds those the same way - `createSubmitHooks(toast, { envelope: allauthEnvelope })` for an app's allauth surfaces, and the 429 and 412 messages once for every form:

```tsx
import i18next from 'i18next'

const throttled = (seconds: number | null) =>
  seconds === null ? i18next.t('errors.throttled') : i18next.t('errors.throttledFor', { count: seconds })

const stale = () => i18next.t('errors.stale')

export const { useAPISubmit, useValidatedFormState, useVersionedFormState } = createSubmitHooks(toast, {
  throttled,
  stale,
})
export const auth = createSubmitHooks(toast, { envelope: allauthEnvelope, throttled })
```

A factory rather than a provider or a module-level default: a provider is a component, and a default is a global that leaks between tests and turns a forgotten reporter from a type error into silence at runtime.

## useBrowserSupportsPasskeys

`browserSupportsPasskeys()` from [webauthn.md](webauthn.md), for render. The server cannot ask the browser, so it renders `true` and hydration replaces it with the real answer, with no mismatch warning.

```tsx
import { useBrowserSupportsPasskeys } from '@isikk/core/hooks'

function PasskeyButton() {
  if (!useBrowserSupportsPasskeys()) return null
  return <button onClick={signInWithPasskey}>Sign in with a passkey</button>
}
```

- The optimistic answer is on purpose: a button that disappears on an old browser, rather than one that appears late on every new one.

## useFilePaste

Listens for paste events (on `document`, or a given `targetElement`) and captures any pasted files, validating them against an accepted MIME type list and/or a max size.

```tsx
import { useFilePaste } from '@isikk/core/hooks'

const ACCEPTED_TYPES = ['image/*']

function Example() {
  const { files, error, clearFiles } = useFilePaste({
    acceptedTypes: ACCEPTED_TYPES,
    maxSize: 5_000_000,
  })

  return <div>{error ? error : `${files.length} file(s) pasted`}</div>
}
```

- An `acceptedTypes` entry ending in `/*` matches any type in that category (`image/*` matches `image/webp`); every other entry matches exactly. `useFileDragDrop` reads `acceptedFileTypes` the same way.
- Validation is synchronous, so there is no loading state: `files` and `error` are set by the time the paste event returns.
- Same caveat as `useElementAttributes`: `acceptedTypes` flows into this hook's paste-listener effect dependencies - use a stable reference, not an inline array literal, or the listener gets removed and re-attached on every render.

## useFileDragDrop

Wires up `dragover`/`dragenter`/`dragleave`/`drop` listeners on a ref'd element, filtering dropped files by accepted type and/or max size.

```tsx
import { useFileDragDrop } from '@isikk/core/hooks'

const ACCEPTED_FILE_TYPES = ['image/*']

function Dropzone() {
  const { ref, isDragging, files, reset } = useFileDragDrop<HTMLDivElement>({
    onDrop: (files) => uploadAll(files),
    acceptedFileTypes: ACCEPTED_FILE_TYPES,
    multiple: false,
  })

  return <div ref={ref}>{isDragging ? 'Drop it!' : 'Drag a file here'}</div>
}
```

- Same caveat again: `acceptedFileTypes` (and `onDrop`) flow into this hook's drag-listener effect dependencies - use stable references, not fresh literals/inline arrow functions on every render.
