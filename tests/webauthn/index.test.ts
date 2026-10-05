import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  browserSupportsPasskeys,
  createCredential,
  credentialToJSON,
  getCredential,
  inASecureContext,
  parseCreationOptionsFromJSON,
  parseRequestOptionsFromJSON,
} from '../../src/webauthn'

afterEach(() => {
  vi.unstubAllGlobals()
})

const bytes = (buffer: unknown) => Array.from(new Uint8Array(buffer as ArrayBuffer))
const buffer = (...values: number[]) => new Uint8Array(values).buffer

// `-_-_` is `+/+/` in plain base64, so it fails unless both substitutions run on every occurrence.
const SYMBOLS = '-_-_'
const SYMBOL_BYTES = [0xfb, 0xff, 0xbf]
// Five bytes, so plain base64 pads with `=` and base64url drops it.
const UNPADDED = 'AQIDBP8'
const UNPADDED_BYTES = [1, 2, 3, 4, 255]

// What allauth's headless API sends under `data.creation_options.publicKey`.
const creationOptions: PublicKeyCredentialCreationOptionsJSON = {
  rp: { id: 'localhost', name: 'Example' },
  user: { id: UNPADDED, name: 'ada@example.com', displayName: 'Ada' },
  challenge: SYMBOLS,
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  excludeCredentials: [{ type: 'public-key', id: SYMBOLS, transports: ['internal'] }],
  authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  attestation: 'none',
}

// And under `data.request_options.publicKey`.
const requestOptions: PublicKeyCredentialRequestOptionsJSON = {
  challenge: UNPADDED,
  rpId: 'localhost',
  allowCredentials: [{ type: 'public-key', id: SYMBOLS, transports: ['usb', 'nfc'] }],
  userVerification: 'preferred',
}

describe('parseCreationOptionsFromJSON', () => {
  it('decodes the challenge, the user id and the excluded ids, and passes the rest through', () => {
    const options = parseCreationOptionsFromJSON(creationOptions)
    expect(bytes(options.challenge)).toEqual(SYMBOL_BYTES)
    expect(bytes(options.user.id)).toEqual(UNPADDED_BYTES)
    expect(options.user).toMatchObject({ name: 'ada@example.com', displayName: 'Ada' })
    expect(bytes(options.excludeCredentials?.[0].id)).toEqual(SYMBOL_BYTES)
    expect(options.excludeCredentials?.[0]).toMatchObject({ type: 'public-key', transports: ['internal'] })
    expect(options).toMatchObject({
      rp: creationOptions.rp,
      pubKeyCredParams: creationOptions.pubKeyCredParams,
      authenticatorSelection: creationOptions.authenticatorSelection,
      attestation: 'none',
    })
  })

  it('decodes into ArrayBuffers, as the platform does', () => {
    expect(parseCreationOptionsFromJSON(creationOptions).challenge).toBeInstanceOf(ArrayBuffer)
  })

  it('leaves out excludeCredentials when the server sent none', () => {
    const { excludeCredentials: _, ...options } = creationOptions
    expect(parseCreationOptionsFromJSON(options).excludeCredentials).toBeUndefined()
  })

  it("prefers the platform's parser where there is one", () => {
    const parsed = {} as PublicKeyCredentialCreationOptions
    const parseCreationOptionsFromJSON_ = vi.fn(() => parsed)
    vi.stubGlobal('PublicKeyCredential', { parseCreationOptionsFromJSON: parseCreationOptionsFromJSON_ })
    expect(parseCreationOptionsFromJSON(creationOptions)).toBe(parsed)
    expect(parseCreationOptionsFromJSON_).toHaveBeenCalledExactlyOnceWith(creationOptions)
  })

  it('falls back where PublicKeyCredential has no parser', () => {
    vi.stubGlobal('PublicKeyCredential', {})
    expect(bytes(parseCreationOptionsFromJSON(creationOptions).challenge)).toEqual(SYMBOL_BYTES)
  })
})

describe('parseRequestOptionsFromJSON', () => {
  // The round trip the server's verification depends on: the challenge and the ids byte-equal.
  it('decodes the challenge and the allowed ids, and passes the rest through', () => {
    const options = parseRequestOptionsFromJSON(requestOptions)
    expect(bytes(options.challenge)).toEqual(UNPADDED_BYTES)
    expect(bytes(options.allowCredentials?.[0].id)).toEqual(SYMBOL_BYTES)
    expect(options.allowCredentials?.[0]).toMatchObject({ type: 'public-key', transports: ['usb', 'nfc'] })
    expect(options).toMatchObject({ rpId: 'localhost', userVerification: 'preferred' })
  })

  it('leaves out allowCredentials when the server sent none', () => {
    expect(parseRequestOptionsFromJSON({ challenge: UNPADDED }).allowCredentials).toBeUndefined()
  })

  it("prefers the platform's parser where there is one", () => {
    const parsed = {} as PublicKeyCredentialRequestOptions
    const parseRequestOptionsFromJSON_ = vi.fn(() => parsed)
    vi.stubGlobal('PublicKeyCredential', { parseRequestOptionsFromJSON: parseRequestOptionsFromJSON_ })
    expect(parseRequestOptionsFromJSON(requestOptions)).toBe(parsed)
    expect(parseRequestOptionsFromJSON_).toHaveBeenCalledExactlyOnceWith(requestOptions)
  })

  it('falls back where PublicKeyCredential has no parser', () => {
    vi.stubGlobal('PublicKeyCredential', {})
    expect(bytes(parseRequestOptionsFromJSON(requestOptions).challenge)).toEqual(UNPADDED_BYTES)
  })
})

// A credential the way a browser without `toJSON` hands one over.
function credential(response: object, authenticatorAttachment: string | null = 'platform') {
  return {
    id: SYMBOLS,
    rawId: buffer(...SYMBOL_BYTES),
    type: 'public-key',
    authenticatorAttachment,
    getClientExtensionResults: () => ({ credProps: { rk: true } }),
    response,
  } as unknown as PublicKeyCredential
}

const attestation = {
  clientDataJSON: buffer(1),
  attestationObject: buffer(2),
  getTransports: () => ['internal', 'hybrid'],
  getAuthenticatorData: () => buffer(3),
  getPublicKey: () => buffer(4),
  getPublicKeyAlgorithm: () => -7,
}

const assertion = {
  clientDataJSON: buffer(1),
  authenticatorData: buffer(3),
  signature: buffer(5),
  userHandle: buffer(...UNPADDED_BYTES),
}

describe('credentialToJSON', () => {
  it("prefers the credential's own toJSON", () => {
    const json = { id: 'from-the-platform' }
    expect(credentialToJSON({ toJSON: () => json } as unknown as PublicKeyCredential)).toBe(json)
  })

  it('writes a registration as WebAuthn L3 does', () => {
    expect(credentialToJSON(credential(attestation))).toEqual({
      id: SYMBOLS,
      rawId: SYMBOLS,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: 'AQ',
        attestationObject: 'Ag',
        transports: ['internal', 'hybrid'],
        authenticatorData: 'Aw',
        publicKey: 'BA',
        publicKeyAlgorithm: -7,
      },
    })
  })

  // A browser old enough to lack toJSON may lack these too; the attestationObject still carries them.
  it('writes a registration from a response without the newer methods', () => {
    const { clientDataJSON, attestationObject } = attestation
    expect(credentialToJSON(credential({ clientDataJSON, attestationObject }, null))).toEqual({
      id: SYMBOLS,
      rawId: SYMBOLS,
      type: 'public-key',
      clientExtensionResults: { credProps: { rk: true } },
      response: { clientDataJSON: 'AQ', attestationObject: 'Ag', transports: [] },
    })
  })

  // A key that holds no private key material has no public key to report.
  it('leaves out a public key the authenticator did not report', () => {
    const json = credentialToJSON(credential({ ...attestation, getPublicKey: () => null }))
    expect((json.response as { publicKey?: string }).publicKey).toBeUndefined()
  })

  it('writes an assertion as WebAuthn L3 does', () => {
    expect(credentialToJSON(credential(assertion))).toEqual({
      id: SYMBOLS,
      rawId: SYMBOLS,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: { credProps: { rk: true } },
      response: { clientDataJSON: 'AQ', authenticatorData: 'Aw', signature: 'BQ', userHandle: UNPADDED },
    })
  })

  // A non-discoverable credential answers with no user handle, and L3 leaves the member out.
  it('leaves out a missing user handle', () => {
    const json = credentialToJSON(credential({ ...assertion, userHandle: null }))
    expect(json.response).toEqual({ clientDataJSON: 'AQ', authenticatorData: 'Aw', signature: 'BQ' })
  })
})

describe('createCredential', () => {
  function stubCredentials(create: () => Promise<unknown>) {
    const spy = vi.fn(create)
    vi.stubGlobal('navigator', { credentials: { create: spy } })
    return spy
  }

  it('creates from the parsed options and answers the JSON the server reads', async () => {
    const create = stubCredentials(async () => credential(attestation))
    const signal = new AbortController().signal
    const json = await createCredential(creationOptions, { signal })
    expect(json.response.attestationObject).toBe('Ag')
    const [argument] = create.mock.calls[0] as unknown as [CredentialCreationOptions]
    expect(argument.signal).toBe(signal)
    expect(bytes(argument.publicKey?.challenge)).toEqual(SYMBOL_BYTES)
  })

  it('refuses a browser that answers with no credential', async () => {
    stubCredentials(async () => null)
    await expect(createCredential(creationOptions)).rejects.toThrow(
      new Error('createCredential: the browser returned no credential')
    )
  })

  // A person who cancels: the browser's NotAllowedError, untouched.
  it("passes the browser's refusal through", async () => {
    const cancelled = new DOMException('The operation was cancelled.', 'NotAllowedError')
    stubCredentials(async () => Promise.reject(cancelled))
    await expect(createCredential(creationOptions)).rejects.toBe(cancelled)
  })
})

describe('getCredential', () => {
  function stubCredentials(get: () => Promise<unknown>) {
    const spy = vi.fn(get)
    vi.stubGlobal('navigator', { credentials: { get: spy } })
    return spy
  }

  it('gets from the parsed options and answers the JSON the server reads', async () => {
    const get = stubCredentials(async () => credential(assertion))
    const json = await getCredential(requestOptions, { mediation: 'conditional' })
    expect(json.response.signature).toBe('BQ')
    const [argument] = get.mock.calls[0] as unknown as [CredentialRequestOptions]
    expect(argument.mediation).toBe('conditional')
    expect(bytes(argument.publicKey?.challenge)).toEqual(UNPADDED_BYTES)
  })

  it('refuses a browser that answers with no credential', async () => {
    stubCredentials(async () => null)
    await expect(getCredential(requestOptions)).rejects.toThrow(
      new Error('getCredential: the browser returned no credential')
    )
  })
})

describe('browserSupportsPasskeys', () => {
  it('is false where there is no PublicKeyCredential - an old browser, an insecure page, a server', () => {
    vi.stubGlobal('PublicKeyCredential', undefined)
    expect(browserSupportsPasskeys()).toBe(false)
  })

  it('is true where PublicKeyCredential is an interface', () => {
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
    expect(browserSupportsPasskeys()).toBe(true)
  })

  it('is false for a PublicKeyCredential that is not one', () => {
    vi.stubGlobal('PublicKeyCredential', {})
    expect(browserSupportsPasskeys()).toBe(false)
  })
})

describe('inASecureContext', () => {
  it('is true in a secure context', () => {
    vi.stubGlobal('isSecureContext', true)
    expect(inASecureContext()).toBe(true)
  })

  it('is false outside one', () => {
    vi.stubGlobal('isSecureContext', false)
    expect(inASecureContext()).toBe(false)
  })

  it('is false where the question does not exist, as on a server', () => {
    vi.stubGlobal('isSecureContext', undefined)
    expect(inASecureContext()).toBe(false)
  })
})
