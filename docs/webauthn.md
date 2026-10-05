# webauthn

Import from `@isikk/core/webauthn`. No dependencies, and browser APIs only.

A WebAuthn server sends its options as JSON, with the binary fields - the challenge, the user id, credential ids - in base64url, and wants the credential back the same way. The browser API takes and returns `ArrayBuffer`s. These functions convert between the two. Each one uses the platform's own conversion from WebAuthn Level 3 (`PublicKeyCredential.parse*OptionsFromJSON`, `credential.toJSON()`) where the browser has it, and falls back to its own where it does not.

## createCredential and getCredential

The whole ceremony in one call: the server's options in, the JSON its endpoint reads out.

```tsx
import { createCredential, getCredential } from '@isikk/core/webauthn'

// Registration: allauth's headless API sends the options under data.creation_options.publicKey.
const { data } = await api.GET('/_allauth/browser/v1/account/authenticators/webauthn')
const credential = await createCredential(data.data.creation_options.publicKey)
await api.POST('/_allauth/browser/v1/account/authenticators/webauthn', { body: { name: 'Laptop', credential } })

// Login: under data.request_options.publicKey.
const { data: login } = await api.GET('/_allauth/browser/v1/auth/webauthn/login')
const assertion = await getCredential(login.data.request_options.publicKey)
await api.POST('/_allauth/browser/v1/auth/webauthn/login', { body: { credential: assertion } })
```

- The second argument carries the rest of `navigator.credentials.create`'s or `.get`'s argument: a `signal`, or `mediation: 'conditional'` for passkey autofill.
- A person who cancels rejects with the browser's `NotAllowedError`, untouched. A browser that answers with no credential at all rejects with an `Error`.

## parseCreationOptionsFromJSON, parseRequestOptionsFromJSON, credentialToJSON

The three conversions, for a caller that calls `navigator.credentials` itself. They are named after, and match, the platform's.

```typescript
import { credentialToJSON, parseRequestOptionsFromJSON } from '@isikk/core/webauthn'

const publicKey = parseRequestOptionsFromJSON(options)
const credential = await navigator.credentials.get({ publicKey })
const body = credentialToJSON(credential as PublicKeyCredential)
```

- `credentialToJSON` reads a registration or an assertion, telling them apart by the response: only a registration carries an `attestationObject`.
- It uses the credential's own `toJSON` where there is one - some password managers inject credentials without it.
- The fallback writes the shape L3's `toJSON` does, with two gaps a server does not miss: a browser too old for `getPublicKey()` and friends leaves `publicKey`, `publicKeyAlgorithm` and `authenticatorData` out of a registration, as they are all inside the `attestationObject` already; and extension inputs and outputs pass through unconverted, so an extension with binary values - `prf` - needs a browser with the platform conversion.

## browserSupportsPasskeys and inASecureContext

Checked before offering a passkey button that would fail.

```typescript
import { browserSupportsPasskeys, inASecureContext } from '@isikk/core/webauthn'

if (!browserSupportsPasskeys()) {
  message = inASecureContext() ? 'This browser cannot use passkeys.' : 'Open this page over https to use passkeys.'
}
```

- WebAuthn exists only in a secure context - https, or localhost - so a capable browser on plain http defines nothing, and `browserSupportsPasskeys()` is `false` there too. `inASecureContext()` tells the two apart, because the advice differs.
- Both are `false` on a server. In render, use `useBrowserSupportsPasskeys()` from `@isikk/core/hooks` (see [hooks.md](hooks.md)), which does not mismatch on hydration.
