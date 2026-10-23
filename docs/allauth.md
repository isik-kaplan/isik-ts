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

const { isSubmitting, submit } = useAPISubmit(toast, { envelope: allauthEnvelope })
```

An app with both DRF and allauth endpoints binds each once:

```tsx
export const { useAPISubmit, useValidatedFormState } = createSubmitHooks(toast)
export const auth = createSubmitHooks(toast, { envelope: allauthEnvelope })
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

Every message in the refusal, as one line. allauth writes the sentence a person should read for a refusal not about a field - a wrong password, a 409 - in the same `errors` list a 400 uses, so this reads that list rather than a `detail` key.

```typescript
import { detailOf } from '@isikk/core/allauth'

detailOf({
  status: 400,
  errors: [{ message: 'The password you specified is not correct.', code: 'incorrect_password' }],
})
// 'The password you specified is not correct.'
```

allauth's 429 often carries no `errors` at all, and never a `Retry-After`. `useAPISubmit` does not read a 429's body under any envelope; it reports the app's `throttled` message instead (see [hooks.md](hooks.md#useapisubmit)).

## errorsOf

The `errors` list of an allauth refusal, typed: `AllauthError[]`, or `undefined` when the body has none. Only entries carrying a string `message` are kept, as `toFormErrors` and `detailOf` read them, so a malformed entry never reaches a page.

```typescript
import { type AllauthError, type AllauthErrorResponse, errorsOf } from '@isikk/core/allauth'

errorsOf({
  status: 400,
  errors: [{ message: 'Too short.', code: 'password_too_short', param: 'password' }, { code: 'x' }],
})
// [{ message: 'Too short.', code: 'password_too_short', param: 'password' }]
```

`AllauthError` is `{ message, code?, param? }`, and `AllauthErrorResponse` is `{ status, errors }`.

## Pending flows

allauth answers a request it cannot finish yet - an unverified email, a second factor, a sensitive action - with a 401 naming the flow still owed: `{ status: 401, data: { flows: [...] }, meta }`. That is a step to take, not a refusal. These read it:

```typescript
import { hasPendingVerifyEmail, needsReauthentication, pendingFlow, pendingMfaTypes } from '@isikk/core/allauth'

hasPendingVerifyEmail(body) // a login or signup owes email verification; allauth has mailed a link
pendingMfaTypes(body) // ['totp', 'webauthn'] - the factors still owed - or null when none is pending
needsReauthentication(body) // a reauthenticate or mfa_reauthenticate flow: prove who you are again
pendingFlow(body, 'provider_signup') // any pending flow by id, or undefined
```

Each reads a body that is not allauth's - `null`, a DRF error, anything - as nothing pending. With `onRefusal` (see [hooks.md](hooks.md#useapisubmit)), a submit can treat a reauthentication 401 as a detour rather than an error:

```tsx
submit(call, {
  failure: 'Could not save.',
  onRefusal: (result) => needsReauthentication(result.error) && startReauth(),
})
```
