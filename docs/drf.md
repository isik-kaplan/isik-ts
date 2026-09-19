# drf

Import from `@isikk/core/drf`. Pure functions, no peer dependencies - it reads response bodies and does not import Django REST framework or any client.

DRF refuses in two shapes, and the status decides which one arrives:

    400   {"name": ["This field may not be blank."], "non_field_errors": [...]}
    else  {"detail": "You do not have permission to perform this action."}

## toFormErrors

Reads the 400 shape into `{ field: string[] }`, ready to hand to a form's error state. Returns `undefined` when the body carries no field errors, so `toFormErrors(body) ?? fallback` reads naturally.

```typescript
import { toFormErrors } from '@isikk/core/drf'

toFormErrors({ name: ['This field may not be blank.'], scopes: 'Not approved.' })
// { name: ['This field may not be blank.'], scopes: ['Not approved.'] }

toFormErrors({ detail: 'Not found.' }) // undefined - that is detailOf's shape
```

- A field's value can be a bare string as well as a list (a `ValidationError` raised with a dict of strings produces that), and it is wrapped into a list.
- `detail` is skipped: it is the other shape, not a field. A serializer with a field literally named `detail` would lose it.
- A value that is neither a string nor a list of strings - a nested serializer's error object, say - is skipped rather than rendered as `[object Object]`.
- `non_field_errors` is kept as an ordinary key; it is about the form as a whole.

## detailOf

Reads the one sentence DRF wrote for a refusal that is not about a field (401, 403, 404, 409...). Returns `undefined` when there is no string `detail` to read, and never throws on a `null`, `undefined` or primitive body.

```typescript
import { detailOf } from '@isikk/core/drf'

detailOf({ detail: 'You do not have permission to perform this action.' })
// 'You do not have permission to perform this action.'
```

## messagesOf

Flattens the result of `toFormErrors` into a single line, for a caller with nowhere to put messages per field - a button or a switch gets the same 400 body a form does. `non_field_errors` come first, then every field's messages. Field names are left out: they are the serializer's `snake_case`, and DRF's messages read as whole sentences without them.

```typescript
import { messagesOf, toFormErrors } from '@isikk/core/drf'

messagesOf(toFormErrors({ name: ['Taken.'], non_field_errors: ['Pick one or the other.'] }))
// 'Pick one or the other. Taken.'
```

Returns `undefined` for `undefined` or when there are no messages.

## FormErrors

`Record<string, string[]> & { non_field_errors?: string[] }` - the type `toFormErrors` returns.
