import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCookie, removeCookie, setCookie } from '../../src/cookies'

function clearCookies() {
  document.cookie.split(';').forEach((cookie) => {
    const name = cookie.split('=')[0].trim()
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`
    }
  })
}

describe('getCookie', () => {
  afterEach(() => {
    clearCookies()
  })

  it('returns the value of an existing cookie', () => {
    document.cookie = 'session=abc123'
    expect(getCookie('session')).toBe('abc123')
  })

  it('picks the right cookie among several', () => {
    document.cookie = 'a=1'
    document.cookie = 'b=2'
    document.cookie = 'c=3'
    expect(getCookie('b')).toBe('2')
  })

  it('returns undefined for a cookie that does not exist', () => {
    expect(getCookie('missing')).toBeUndefined()
  })

  it('does not confuse a name that is a suffix of another cookie name', () => {
    document.cookie = 'my_session=abc'
    document.cookie = 'session=xyz'
    expect(getCookie('session')).toBe('xyz')
  })

  it('returns the first match when the same cookie name legitimately appears twice (different scopes)', () => {
    const cookieGetter = vi.spyOn(document, 'cookie', 'get').mockReturnValue('name=first; name=second')

    expect(getCookie('name')).toBe('first')

    cookieGetter.mockRestore()
  })

  it('reads the value raw by default, a percent escape included', () => {
    document.cookie = 'q=a%3Bb'
    expect(getCookie('q')).toBe('a%3Bb')
  })

  it('decodes the value when asked to', () => {
    document.cookie = 'q=a%3Bb%3Dc%20d'
    expect(getCookie('q', { encoded: true })).toBe('a;b=c d')
  })

  it('reads a stray % as it was stored rather than throwing, even when asked to decode', () => {
    document.cookie = 'discount=50%off'
    expect(getCookie('discount', { encoded: true })).toBe('50%off')
  })

  it('skips a malformed cookie entry that has no "=" separator instead of misreading it', () => {
    // Without the separator, slice(0, -1) drops the entry's last character and slice(0) returns
    // it whole - chosen so a buggy "don't skip" path would wrongly match name 'a' against it.
    const cookieGetter = vi.spyOn(document, 'cookie', 'get').mockReturnValue('ab')

    expect(getCookie('a')).toBeUndefined()

    cookieGetter.mockRestore()
  })
})

describe('setCookie', () => {
  afterEach(() => {
    clearCookies()
  })

  it('sets a session cookie (no expiry) at the root path by default', () => {
    setCookie('theme', 'dark')
    expect(document.cookie).toContain('theme=dark')
    expect(getCookie('theme')).toBe('dark')
  })

  it('sets an expiry when days is provided', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    setCookie('theme', 'dark', { days: 7 })
    expect(cookieSetter).toHaveBeenCalledWith(expect.stringMatching(/^theme=dark; expires=.+; path=\/$/))
    cookieSetter.mockRestore()
  })

  it('computes the expiry as exactly days * 86,400,000ms from now', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')

    setCookie('theme', 'dark', { days: 7 })

    const expected = new Date(Date.parse('2024-01-01T00:00:00.000Z') + 7 * 86_400_000).toUTCString()
    expect(cookieSetter).toHaveBeenCalledWith(`theme=dark; expires=${expected}; path=/`)

    cookieSetter.mockRestore()
    vi.useRealTimers()
  })

  it('stores an empty value', () => {
    setCookie('empty', '')
    expect(getCookie('empty')).toBe('')
  })

  // Every character a value may carry as written, the edges of each range RFC 6265 allows included.
  it('stores a value of any allowed character as written', () => {
    const value = "!#$%&'()*+-./09:<=>?@AZ[]^_`az{|}~"
    setCookie('v', value)
    expect(getCookie('v')).toBe(value)
  })

  it.each([
    ['a semicolon', 'a;b'],
    ['a comma', 'a,b'],
    ['a space', 'a b'],
    ['a double quote', 'a"b'],
    ['a backslash', 'a\\b'],
    ['a tab', 'a\tb'],
    ['a DEL', 'a\x7Fb'],
    ['a non-ASCII letter', 'café'],
    ['a leading semicolon', ';a'],
    ['a trailing semicolon', 'a;'],
  ])('throws for a value with %s rather than storing part of it', (_, value) => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    expect(() => setCookie('q', value)).toThrow(
      `Cookie value ${JSON.stringify(value)} cannot be stored as written; pass { encoded: true } to setCookie and getCookie`
    )
    expect(cookieSetter).not.toHaveBeenCalled()
    cookieSetter.mockRestore()
  })

  it('cannot be made to write an attribute through the value', () => {
    expect(() => setCookie('x', 'y; domain=evil.com')).toThrow(TypeError)
  })

  it('percent-encodes the value when asked to, and reads it back decoded', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    setCookie('q', 'a;b=c d', { encoded: true })
    expect(cookieSetter).toHaveBeenCalledWith('q=a%3Bb%3Dc%20d; path=/')
    cookieSetter.mockRestore()

    setCookie('q', 'a;b=c d', { encoded: true })
    expect(getCookie('q', { encoded: true })).toBe('a;b=c d')
  })

  it('encodes a value that was storable anyway, so it decodes back the same', () => {
    setCookie('discount', '50%off', { encoded: true })
    expect(getCookie('discount')).toBe('50%25off')
    expect(getCookie('discount', { encoded: true })).toBe('50%off')
  })

  it.each([
    ['empty', ''],
    ['with a space', 'my cookie'],
    ['with an equals sign', 'a=b'],
    ['with a semicolon', 'a;b'],
    ['with a slash', 'a/b'],
    ['non-ASCII', 'çerez'],
    ['with a leading separator', '(a'],
    ['with a trailing separator', 'a)'],
  ])('throws for a name that is %s, encoded or not', (_, name) => {
    expect(() => setCookie(name, 'v')).toThrow(`Cookie name ${JSON.stringify(name)} is not a valid token`)
    expect(() => setCookie(name, 'v', { encoded: true })).toThrow(TypeError)
  })

  it('accepts a name of any token character, the edges of each range included', () => {
    const name = "!#$%&'*+-.^_`|~09AZaz"
    setCookie(name, 'v')
    expect(getCookie(name)).toBe('v')
  })

  it('uses a custom path when provided', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    setCookie('theme', 'dark', { path: '/app' })
    expect(cookieSetter).toHaveBeenCalledWith('theme=dark; path=/app')
    cookieSetter.mockRestore()
  })
})

describe('cookie paths', () => {
  it.each([
    ['a semicolon', '/; domain=evil.com'],
    ['a leading semicolon', ';/app'],
    ['a trailing semicolon', '/app;'],
    ['a newline', '/app\n'],
    ['a NUL', '/\x00'],
    ['a unit separator', '/\x1F'],
    ['a DEL', '/\x7F'],
  ])('throws for a path with %s, setting or removing, and writes nothing', (_, path) => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    expect(() => setCookie('a', 'b', { path })).toThrow(
      `Cookie path ${JSON.stringify(path)} cannot hold a ';' or a control character`
    )
    expect(() => removeCookie('a', path)).toThrow(TypeError)
    expect(cookieSetter).not.toHaveBeenCalled()
    cookieSetter.mockRestore()
  })

  it('accepts any other printable path, a space and non-ASCII included', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    setCookie('a', 'b', { path: '/my app/çerez/ ~' })
    removeCookie('a', '/my app/çerez/ ~')
    expect(cookieSetter).toHaveBeenNthCalledWith(1, 'a=b; path=/my app/çerez/ ~')
    expect(cookieSetter).toHaveBeenNthCalledWith(2, 'a=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/my app/çerez/ ~')
    cookieSetter.mockRestore()
  })
})

describe('removeCookie', () => {
  afterEach(() => {
    clearCookies()
  })

  it('removes an existing cookie', () => {
    document.cookie = 'session=abc123'
    removeCookie('session')
    expect(getCookie('session')).toBeUndefined()
  })

  it('uses a custom path when provided', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    removeCookie('session', '/app')
    expect(cookieSetter).toHaveBeenCalledWith('session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/app')
    cookieSetter.mockRestore()
  })

  it('throws for a name that is not a token rather than writing it', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    expect(() => removeCookie('a; domain=evil.com')).toThrow('is not a valid token')
    expect(cookieSetter).not.toHaveBeenCalled()
    cookieSetter.mockRestore()
  })

  it('uses the root path by default', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    removeCookie('session')
    expect(cookieSetter).toHaveBeenCalledWith('session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/')
    cookieSetter.mockRestore()
  })
})
