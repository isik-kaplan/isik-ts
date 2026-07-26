import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCookie } from '../../src/cookies'

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
})
