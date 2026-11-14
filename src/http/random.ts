/**
 * A v4 UUID. `randomUUID` exists only in a secure context, so a dev stack on plain http behind a
 * hostname has none. `getRandomValues` exists everywhere `crypto` does, and 16 of its bytes are a v4
 * UUID once the version and variant bits are set. `caller` names who asked, in the error.
 */
export function randomUUID(caller: string): string {
  const crypto = globalThis.crypto as Partial<Crypto> | undefined
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new TypeError(
      `${caller}: this runtime has neither crypto.randomUUID nor crypto.getRandomValues - pass ` +
        '`generateKey`, or install a polyfill such as react-native-get-random-values'
    )
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
