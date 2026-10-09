// RFC 6265's grammar. A name is a token; a value is any printable ASCII but space, `"`, `,`, `;` and
// `\`. Anything outside it either ends the cookie early - `a;b` stores `a` - or, from user input,
// writes an attribute of its own: `x; domain=evil.com`.
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/

function assertCookieName(name: string): void {
  if (!COOKIE_NAME.test(name)) {
    throw new TypeError(`Cookie name ${JSON.stringify(name)} is not a valid token`)
  }
}

// A path is anything but a control character or the `;` that would start the next attribute.
function isCookiePathCharacter(character: string): boolean {
  return character !== ';' && character >= ' ' && character !== '\x7F'
}

function assertCookiePath(path: string): void {
  if (![...path].every(isCookiePathCharacter)) {
    throw new TypeError(`Cookie path ${JSON.stringify(path)} cannot hold a ';' or a control character`)
  }
}

export interface CookieEncodingOptions {
  /**
   * Percent-encode the value on write and decode it on read, for a value that may hold a character
   * a cookie cannot carry. Pass it on both sides: a value written encoded reads back raw without it.
   */
  encoded?: boolean
}

// A cookie the page did not write, or one a person edited, may carry a `%` that is not an escape. It
// reads back as it was stored rather than throwing.
function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function getCookie(name: string, options: CookieEncodingOptions = {}): string | undefined {
  for (const pair of document.cookie.split('; ')) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }
    if (pair.slice(0, separatorIndex) === name) {
      const value = pair.slice(separatorIndex + 1)
      return options.encoded ? decode(value) : value
    }
  }
  return undefined
}

export interface SetCookieOptions extends CookieEncodingOptions {
  /** Days until the cookie expires. Omit for a session cookie (cleared when the browser closes). */
  days?: number
  path?: string
}

/**
 * Throws for a name that is not a token, a path holding a `;` or a control character, or a value a
 * cookie cannot carry as written, rather than storing part of it. `encoded: true` stores any value,
 * percent-encoded.
 */
export function setCookie(name: string, value: string, options: SetCookieOptions = {}): void {
  const { days, path = '/', encoded = false } = options
  assertCookieName(name)
  assertCookiePath(path)
  const stored = encoded ? encodeURIComponent(value) : value
  if (!COOKIE_VALUE.test(stored)) {
    throw new TypeError(
      `Cookie value ${JSON.stringify(value)} cannot be stored as written; pass { encoded: true } to setCookie and getCookie`
    )
  }
  const expires = days === undefined ? '' : `; expires=${new Date(Date.now() + days * 86_400_000).toUTCString()}`
  document.cookie = `${name}=${stored}${expires}; path=${path}`
}

export function removeCookie(name: string, path: string = '/'): void {
  assertCookieName(name)
  assertCookiePath(path)
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=${path}`
}
