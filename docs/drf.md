# drf

Import from `@isikk/core/drf`. Pure functions, no peer dependencies - it reads response bodies and does not import Django REST framework or any client.

DRF refuses in two shapes, and the status decides which one arrives:

    400   {"name": ["This field may not be blank."], "non_field_errors": [...]}
    else  {"detail": "You do not have permission to perform this action."}

A 400's messages may also arrive as DRF's `get_full_details()`, each one `{message, code}`. isik
(0.57.0 and later) sends them that way:

    400   {"name": [{"message": "This field may not be blank.", "code": "blank"}]}

`toFormErrors` reads both shapes into the same strings, and `codesOf` reads the codes.

## toFormErrors

Reads the 400 shape into `{ field: string[] }`, ready to hand to a form's error state. Returns `undefined` when the body carries no field errors, so `toFormErrors(body) ?? fallback` reads naturally.

```typescript
import { toFormErrors } from '@isikk/core/drf'

toFormErrors({ name: ['This field may not be blank.'], scopes: 'Not approved.' })
// { name: ['This field may not be blank.'], scopes: ['Not approved.'] }

toFormErrors({ items: [{}, { qty: ['Ensure this value is greater than 0.'] }] })
// { 'items.1.qty': ['Ensure this value is greater than 0.'] }

toFormErrors({ detail: 'Not found.' }) // undefined - that is detailOf's shape
```

- A field's value can be a bare string as well as a list (a `ValidationError` raised with a dict of strings produces that), and it is wrapped into a list.
- `detail` is skipped: it is the other shape, not a field. A serializer with a field literally named `detail` would lose it.
- `code` is skipped only beside a string `detail`, where it is the machine-readable name of that same refusal (`{detail: 'Authentication credentials were not provided.', code: 'not_authenticated'}`). Anywhere else - a 400 with no `detail`, or a list of messages - `code` is an ordinary field, like an invitation or MFA code.
- A nested serializer's errors flatten into dotted keys: `{address: {city: [...]}}` gives `address.city`, and a `many=True` serializer's `{items: [{}, {qty: [...]}]}` gives `items.1.qty`. `useValidatedFormState` holds no field by that name, so the message joins `non_field_errors` there rather than being lost to the generic `failure`.
- Below the top level only a list of messages counts, as that is all a serializer nests; a bare string there is another server's envelope (allauth's `{message, code, param}` entries) and is skipped. A list that is not all strings is read by index like an object, and anything that is not a message - a number, `null` - is skipped rather than rendered as `[object Object]`.
- `non_field_errors` is kept as an ordinary key; it is about the form as a whole.
- A message is a string or a full detail: an object with exactly `message` and `code`, both strings. It is read wherever a string is, a lone detail included, and a list may mix the two. An entry with any other key, like allauth's `param`, is not a message.

## codesOf

Reads the codes of a 400's full-detail messages, under the keys `toFormErrors` gives their messages. A page branches on a code, not on the message, which is translated:

```typescript
import { codesOf } from '@isikk/core/drf'

codesOf({ kinds: [{ kind: [{ message: "parcel_routed isn't sent to webhooks.", code: 'kind_not_sent_on_webhook' }] }] })
// { 'kinds.0.kind': ['kind_not_sent_on_webhook'] }
```

A message sent as a bare string has no code, so a field whose messages are all strings has no entry, and `codesOf` returns `undefined` when no message carries a code. In a submit hook, read it in `onRefusal` and return `false`, so the form still gets its messages:

```typescript
useAPISubmit(toast, {
  onRefusal: (result) => {
    setInert(codesOf(result.error)?.['kinds.0.kind']?.includes('kind_inert_on_webhook') ?? false)
    return false
  },
})
```

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

## FormErrorCodes

The same type, holding codes - what `codesOf` returns.
