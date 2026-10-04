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
- Placing the header is the caller's - every client places it differently.
- `generateKey` replaces `crypto.randomUUID()`, which React Native's Hermes and pages served over plain http do not have: `useIdempotencyKey({ generateKey: uuid })`.
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

- **Success** is no `error` and a response that is `ok` (or no response at all). Pass `isSuccess(result)` for an endpoint that succeeds with a non-2xx - allauth answers an already-logged-in visitor with a 409. `onSuccess(result, { replayed })` receives the result, and whether the server answered with `Idempotent-Replayed: true` - worth saying "already done" rather than "saved".
- **A 400** is read as field errors. Given `setFormErrors`, they go there and nothing is reported. Without it, every message is reported as one line.
- **Any other 4xx** reports DRF's `detail` sentence. **A 5xx, or no response at all,** reports `failure` - that body is not written for a person, and often is not JSON.
- Anything unreadable falls back to `failure`, so another server's errors read as a failure, not as none.
- A `call` that throws releases `isSubmitting` and rethrows.
- Refreshing or navigating stays at the call site, through `onSuccess` - reaching for a router inside would make every caller a router consumer.
- A second argument, an `ErrorEnvelope` - `{ toFormErrors(body), detailOf(body) }` - reads another server's refusals. `useAPISubmit(toast, allauthEnvelope)` reads django-allauth's headless API (see [allauth.md](allauth.md)). The status rules above stay the same: a 400 is read for fields, another 4xx for its sentence.

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
- The call's second argument is an idempotency key from `useIdempotencyKey`, keyed on that output and spent on success: `submit((value, key) => api.POST('/orgs/', { body: value, headers: { 'Idempotency-Key': key } }), ...)`. A form that does not want one ignores it. The fourth argument, `{ generateKey, envelope }`, replaces `crypto.randomUUID()` and reads another server's refusals, as `useAPISubmit`'s second argument does.
- The schema's issues and the server's 400 land in the same `formErrors`, so a refusal from either side renders in the same place. An issue is filed under the first segment of its path; one with no path goes under `non_field_errors`.
- A server error naming a field the form state does not hold joins `non_field_errors` rather than being dropped - a serializer can refuse a column this form never shows.
- `validate()` returns a `boolean`, so `if (!validate()) return` works. It needs a synchronous schema - every zod or valibot schema without an async refinement - and throws a `TypeError` for one that answers with a Promise, rather than returning a Promise that would always read as valid. `submit` awaits the schema, so it accepts either.

## createSubmitHooks

`useAPISubmit` and `useValidatedFormState` with the reporter already supplied, so an app names its toast once rather than once per hook:

```tsx
// lib/hooks.ts
import { createSubmitHooks } from '@isikk/core/hooks'

import { toast } from 'sonner'

export const { useAPISubmit, useValidatedFormState } = createSubmitHooks(toast)
```

The returned hooks take every argument the originals do except the reporter. An optional second argument binds an `ErrorEnvelope` the same way: `createSubmitHooks(toast, allauthEnvelope)` for an app's allauth surfaces.

A factory rather than a provider or a module-level default: a provider is a component, and a default is a global that leaks between tests and turns a forgotten reporter from a type error into silence at runtime.

## useFilePaste

Listens for paste events (on `document`, or a given `targetElement`) and captures any pasted files, validating them against an accepted MIME type list and/or a max size.

```tsx
import { useFilePaste } from '@isikk/core/hooks'

const ACCEPTED_TYPES = ['image/*']

function Example() {
  const { files, error, isLoading, clearFiles } = useFilePaste({
    acceptedTypes: ACCEPTED_TYPES,
    maxSize: 5_000_000,
  })

  return <div>{error ? error : `${files.length} file(s) pasted`}</div>
}
```

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
