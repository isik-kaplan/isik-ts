/**
 * WebAuthn's JSON, both ways. A server - allauth's headless MFA included - sends its options as JSON
 * with the binary fields in base64url, and wants the credential back the same way, while the browser
 * API takes and returns ArrayBuffers.
 *
 * WebAuthn Level 3 standardized the conversion as `PublicKeyCredential.parse*OptionsFromJSON` and
 * `credential.toJSON()`. Each function here prefers the platform's and falls back to its own where a
 * browser does not ship it yet - or where a password manager's injected credential drops `toJSON`.
 * The fallback shrinks to dead code as support completes.
 */

// Browsers decode unpadded base64 (the forgiving-base64 algorithm), so the padding base64url drops is
// not put back.
function fromBase64URL(value: string): ArrayBuffer {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer
}

function toBase64URL(value: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// Declared as always present by the DOM types, which is what makes the check worth spelling out.
type Platform = Partial<
  Pick<typeof PublicKeyCredential, 'parseCreationOptionsFromJSON' | 'parseRequestOptionsFromJSON'>
>

function platform(): Platform | undefined {
  return (globalThis as { PublicKeyCredential?: Platform }).PublicKeyCredential
}

function descriptorsFromJSON(descriptors: PublicKeyCredentialDescriptorJSON[] | undefined) {
  return descriptors?.map((descriptor) => ({ ...descriptor, id: fromBase64URL(descriptor.id) }))
}

/**
 * Registration options as the server sent them, as `navigator.credentials.create({ publicKey })`
 * takes them. Only the challenge, the user id and the excluded credential ids are bytes; the rest
 * passes through.
 */
export function parseCreationOptionsFromJSON(
  options: PublicKeyCredentialCreationOptionsJSON
): PublicKeyCredentialCreationOptions {
  const native = platform()
  if (typeof native?.parseCreationOptionsFromJSON === 'function') return native.parseCreationOptionsFromJSON(options)
  // Through unknown: the JSON shape types its enums as plain strings - the very gap this bridges.
  return {
    ...options,
    challenge: fromBase64URL(options.challenge),
    user: { ...options.user, id: fromBase64URL(options.user.id) },
    excludeCredentials: descriptorsFromJSON(options.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions
}

/**
 * Authentication options as the server sent them, as `navigator.credentials.get({ publicKey })`
 * takes them. Only the challenge and the allowed credential ids are bytes.
 */
export function parseRequestOptionsFromJSON(
  options: PublicKeyCredentialRequestOptionsJSON
): PublicKeyCredentialRequestOptions {
  const native = platform()
  if (typeof native?.parseRequestOptionsFromJSON === 'function') return native.parseRequestOptionsFromJSON(options)
  return {
    ...options,
    challenge: fromBase64URL(options.challenge),
    allowCredentials: descriptorsFromJSON(options.allowCredentials),
  } as unknown as PublicKeyCredentialRequestOptions
}

type CredentialJSON = {
  id: string
  rawId: string
  type: string
  authenticatorAttachment?: string
  clientExtensionResults: AuthenticationExtensionsClientOutputs
}

/** A registration as WebAuthn L3's `toJSON()` writes it - what a server's registration endpoint reads. */
export type RegistrationResponseJSON = CredentialJSON & {
  response: {
    clientDataJSON: string
    attestationObject: string
    transports: string[]
    // Missing from the fallback in a browser too old to offer them; a server reads attestationObject.
    authenticatorData?: string
    publicKey?: string
    publicKeyAlgorithm?: number
  }
}

/** An assertion as WebAuthn L3's `toJSON()` writes it - what a server's login endpoint reads. */
export type AuthenticationResponseJSON = CredentialJSON & {
  response: {
    clientDataJSON: string
    authenticatorData: string
    signature: string
    userHandle?: string
  }
}

// The response methods newer than the interface itself, which a browser without `toJSON` may lack.
type AttestationResponse = AuthenticatorAttestationResponse &
  Partial<
    Pick<
      AuthenticatorAttestationResponse,
      'getTransports' | 'getAuthenticatorData' | 'getPublicKey' | 'getPublicKeyAlgorithm'
    >
  >

function attestationToJSON(response: AttestationResponse): RegistrationResponseJSON['response'] {
  const publicKey = response.getPublicKey?.()
  const authenticatorData = response.getAuthenticatorData?.()
  return {
    clientDataJSON: toBase64URL(response.clientDataJSON),
    attestationObject: toBase64URL(response.attestationObject),
    transports: response.getTransports?.() ?? [],
    authenticatorData: authenticatorData ? toBase64URL(authenticatorData) : undefined,
    publicKey: publicKey ? toBase64URL(publicKey) : undefined,
    publicKeyAlgorithm: response.getPublicKeyAlgorithm?.(),
  }
}

function assertionToJSON(response: AuthenticatorAssertionResponse): AuthenticationResponseJSON['response'] {
  return {
    clientDataJSON: toBase64URL(response.clientDataJSON),
    authenticatorData: toBase64URL(response.authenticatorData),
    signature: toBase64URL(response.signature),
    userHandle: response.userHandle ? toBase64URL(response.userHandle) : undefined,
  }
}

/**
 * A credential from `navigator.credentials.create` or `.get`, as the JSON a server reads. Which one
 * it is is read off the response: only a registration carries an `attestationObject`.
 */
export function credentialToJSON(
  credential: PublicKeyCredential
): RegistrationResponseJSON | AuthenticationResponseJSON {
  // Declared as always present by the DOM types; an injected credential is not bound by them.
  if (typeof (credential as Partial<PublicKeyCredential>).toJSON === 'function') return credential.toJSON()
  const { response } = credential
  return {
    id: credential.id,
    rawId: toBase64URL(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response:
      'attestationObject' in response
        ? attestationToJSON(response as AttestationResponse)
        : assertionToJSON(response as AuthenticatorAssertionResponse),
  } as RegistrationResponseJSON | AuthenticationResponseJSON
}

async function credentialOf(promise: Promise<Credential | null>, caller: string): Promise<PublicKeyCredential> {
  const credential = await promise
  if (!credential) throw new Error(`${caller}: the browser returned no credential`)
  return credential as PublicKeyCredential
}

/**
 * Registration in one call: the server's options in, the JSON its registration endpoint reads out.
 * `request` carries the rest of `navigator.credentials.create`'s argument - a `signal`, say. A person
 * who cancels rejects with the browser's `NotAllowedError`, as the platform call does.
 */
export async function createCredential(
  options: PublicKeyCredentialCreationOptionsJSON,
  request?: Omit<CredentialCreationOptions, 'publicKey'>
): Promise<RegistrationResponseJSON> {
  const publicKey = parseCreationOptionsFromJSON(options)
  const credential = await credentialOf(navigator.credentials.create({ ...request, publicKey }), 'createCredential')
  return credentialToJSON(credential) as RegistrationResponseJSON
}

/**
 * Authentication in one call: the server's options in, the JSON its login endpoint reads out.
 * `request` carries the rest of `navigator.credentials.get`'s argument - `mediation: 'conditional'`
 * for autofill, or a `signal`.
 */
export async function getCredential(
  options: PublicKeyCredentialRequestOptionsJSON,
  request?: Omit<CredentialRequestOptions, 'publicKey'>
): Promise<AuthenticationResponseJSON> {
  const publicKey = parseRequestOptionsFromJSON(options)
  const credential = await credentialOf(navigator.credentials.get({ ...request, publicKey }), 'getCredential')
  return credentialToJSON(credential) as AuthenticationResponseJSON
}

/**
 * Whether this browser can do WebAuthn here - checked before offering a button that would fail.
 * Also `false` outside a secure context, where a capable browser defines nothing; `inASecureContext`
 * tells the two apart.
 */
export function browserSupportsPasskeys(): boolean {
  return typeof (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential === 'function'
}

/**
 * Whether the page is served somewhere WebAuthn may exist - https, or localhost. Told apart from an
 * old browser because the advice differs: "use another browser" against "use the https address".
 */
export function inASecureContext(): boolean {
  return globalThis.isSecureContext === true
}
