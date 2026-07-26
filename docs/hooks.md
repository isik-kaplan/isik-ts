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
