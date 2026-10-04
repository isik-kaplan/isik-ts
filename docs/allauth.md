# allauth

Import from `@isikk/core/allauth`. Pure functions, no peer dependencies - it reads response bodies and does not import django-allauth or any client.

django-allauth's headless API refuses in one shape, whatever the status:

    {"status": 400, "errors": [{"message": "That email is taken.", "code": "email_taken", "param": "email"}]}

An entry with a `param` is about that field; one without is about the request as a whole.

## allauthEnvelope

The two readers below, as the `ErrorEnvelope` that `useAPISubmit`, `useValidatedFormState` and `createSubmitHooks` take (see [hooks.md](hooks.md)). Without it those hooks read DRF's shape, find nothing in allauth's, and report the caller's generic `failure` instead of the server's own sentence.

```tsx
import { allauthEnvelope } from '@isikk/core/allauth'
import { useAPISubmit } from '@isikk/core/hooks'

const { isSubmitting, submit } = useAPISubmit(toast, allauthEnvelope)
```

An app with both DRF and allauth endpoints binds each once:

```tsx
export const { useAPISubmit, useValidatedFormState } = createSubmitHooks(toast)
export const auth = createSubmitHooks(toast, allauthEnvelope)
```

## toFormErrors

Reads allauth's refusal into `{ field: string[] }` - the same `FormErrors` shape `@isikk/core/drf` gives, so a form renders either server's errors in the same place.

```typescript
import { toFormErrors } from '@isikk/core/allauth'

toFormErrors({ status: 400, errors: [{ message: 'Too short.', code: 'password_too_short', param: 'password' }] })
// { password: ['Too short.'] }
```

- An error with no `param` goes to `non_field_errors`.
- Entries without a string `message` are skipped.
- Returns `undefined` when there is nothing to read - including allauth's 401 "pending flow" body, which carries `data` and `meta` rather than `errors`. Whether that 401 is a success is the caller's to say, through `isSuccess`.

## detailOf

Every message in the refusal, as one line. allauth's 409s and 429s carry the sentence a person should read in the same `errors` list a 400 uses, so this reads that list rather than a `detail` key.

```typescript
import { detailOf } from '@isikk/core/allauth'

detailOf({ status: 429, errors: [{ message: 'Too many failed login attempts.', code: 'too_many_login_attempts' }] })
// 'Too many failed login attempts.'
```
