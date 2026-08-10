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

  it('uses a custom path when provided', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    setCookie('theme', 'dark', { path: '/app' })
    expect(cookieSetter).toHaveBeenCalledWith('theme=dark; path=/app')
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

  it('uses the root path by default', () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set')
    removeCookie('session')
    expect(cookieSetter).toHaveBeenCalledWith('session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/')
    cookieSetter.mockRestore()
  })
})
