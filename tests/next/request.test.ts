import { describe, expect, it, vi } from 'vitest'

import { getRequestOrigin, getSafeRedirect, isPlainHttpLocalDev } from '../../src/next/request'

describe('getSafeRedirect', () => {
  it('accepts a same-origin relative path', () => {
    expect(getSafeRedirect('/dashboard')).toBe('/dashboard')
  })

  it('falls back to "/" for a non-string value', () => {
    expect(getSafeRedirect(null)).toBe('/')
    expect(getSafeRedirect(undefined)).toBe('/')
  })

  it('falls back to "/" for a value that does not start with a slash', () => {
    expect(getSafeRedirect('evil.com/phish')).toBe('/')
  })

  it('falls back to "/" for a protocol-relative (off-site) value', () => {
    expect(getSafeRedirect('//evil.com')).toBe('/')
  })

  it.each([
    ['a backslash', '/\\evil.com'],
    ['a tab', '/\t/evil.com'],
    ['a newline', '/\n/evil.com'],
    ['a carriage return', '/\r/evil.com'],
  ])('falls back for a path that %s turns protocol-relative', (_, next) => {
    expect(getSafeRedirect(next)).toBe('/')
  })

  it('falls back for a path that names either probe host', () => {
    // Each base can be named back on its own; only the pair together closes it.
    expect(getSafeRedirect('//a.invalid')).toBe('/')
    expect(getSafeRedirect('/\\b.invalid')).toBe('/')
  })

  it('falls back for a value the URL parser rejects', () => {
    expect(getSafeRedirect('/\\[')).toBe('/')
  })

  it('returns the path as given, query and fragment included', () => {
    expect(getSafeRedirect('/dashboard?x=1#y')).toBe('/dashboard?x=1#y')
    expect(getSafeRedirect('/a/../b')).toBe('/a/../b')
  })

  it('uses a custom fallback when provided', () => {
    expect(getSafeRedirect(null, '/home')).toBe('/home')
    expect(getSafeRedirect('//evil.com', '/home')).toBe('/home')
  })
})

// The checks below are not about allowedHosts, so they turn it off.
const ANY = { allowedHosts: 'any' } as const

describe('getRequestOrigin', () => {
  it('trusts X-Forwarded-Proto when present', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'https', host: 'app.example.com' })
    expect(getRequestOrigin(headers, ANY)).toBe('https://app.example.com')
  })

  it('prefers X-Forwarded-Host over Host', () => {
    const headers = new Headers({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'public.example.com',
      host: 'internal-backend',
    })
    expect(getRequestOrigin(headers, ANY)).toBe('https://public.example.com')
  })

  it('defaults to https for a non-local host when X-Forwarded-Proto is absent', () => {
    const headers = new Headers({ host: 'app.example.com' })
    expect(getRequestOrigin(headers, ANY)).toBe('https://app.example.com')
  })

  it('defaults to http for a known local-dev host when X-Forwarded-Proto is absent', () => {
    expect(getRequestOrigin(new Headers({ host: 'localhost:3000' }), ANY)).toBe('http://localhost:3000')
    expect(getRequestOrigin(new Headers({ host: '127.0.0.1:3000' }), ANY)).toBe('http://127.0.0.1:3000')
  })

  it('treats the port as optional for known local-dev hosts', () => {
    expect(getRequestOrigin(new Headers({ host: 'localhost' }), ANY)).toBe('http://localhost')
    expect(getRequestOrigin(new Headers({ host: '127.0.0.1' }), ANY)).toBe('http://127.0.0.1')
  })

  it('does not match a host that merely contains a local-dev hostname as a substring', () => {
    // Exercises both anchors on each pattern: a prefix before "localhost"/"127.0.0.1" defeats
    // `^`, and a suffix after the optional port defeats `$`.
    expect(getRequestOrigin(new Headers({ host: 'notlocalhost:3000' }), ANY)).toBe('https://notlocalhost:3000')
    expect(getRequestOrigin(new Headers({ host: 'localhost.evil.com:3000' }), ANY)).toBe(
      'https://localhost.evil.com:3000'
    )
    expect(getRequestOrigin(new Headers({ host: 'not127.0.0.1:3000' }), ANY)).toBe('https://not127.0.0.1:3000')
    expect(getRequestOrigin(new Headers({ host: '127.0.0.1.evil.com:3000' }), ANY)).toBe(
      'https://127.0.0.1.evil.com:3000'
    )
  })

  it('accepts a custom isLocalDevHost predicate', () => {
    const headers = new Headers({ host: 'app.internal.test' })
    expect(
      getRequestOrigin(headers, { allowedHosts: 'any', isLocalDevHost: (host) => host.endsWith('.internal.test') })
    ).toBe('http://app.internal.test')
  })

  it('throws when neither X-Forwarded-Host nor Host is present', () => {
    expect(() => getRequestOrigin(new Headers(), ANY)).toThrow('neither an X-Forwarded-Host nor a Host header')
  })

  it('takes the first item of a comma list from chained proxies', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'https , http', 'x-forwarded-host': ' a.com , b.com' })
    expect(getRequestOrigin(headers, ANY)).toBe('https://a.com')
  })

  it('reads the local-dev check against the first item only', () => {
    expect(getRequestOrigin(new Headers({ 'x-forwarded-host': 'localhost:3000, proxy.internal' }), ANY)).toBe(
      'http://localhost:3000'
    )
  })

  it('falls through to Host when X-Forwarded-Host is empty', () => {
    expect(getRequestOrigin(new Headers({ 'x-forwarded-host': '', host: 'app.example.com' }), ANY)).toBe(
      'https://app.example.com'
    )
  })

  it('throws when the host is blank', () => {
    expect(() => getRequestOrigin(new Headers({ host: ' , b.com' }), ANY)).toThrow('neither an X-Forwarded-Host')
  })

  describe('allowedHosts', () => {
    it('accepts a host named by a string, ignoring case', () => {
      const headers = new Headers({ 'x-forwarded-host': 'App.Example.com' })
      expect(getRequestOrigin(headers, { allowedHosts: ['other.com', 'app.example.COM'] })).toBe(
        'https://App.Example.com'
      )
    })

    it('accepts a host matched by a RegExp', () => {
      const headers = new Headers({ host: 'tenant.example.com' })
      expect(getRequestOrigin(headers, { allowedHosts: [/^[a-z]+\.example\.com$/] })).toBe('https://tenant.example.com')
    })

    it('throws for a spoofed X-Forwarded-Host', () => {
      const headers = new Headers({ 'x-forwarded-host': 'evil.com', host: 'app.example.com' })
      expect(() => getRequestOrigin(headers, { allowedHosts: ['app.example.com'] })).toThrow(
        'getRequestOrigin: host "evil.com" is not in allowedHosts'
      )
    })

    it('matches a string against the whole host, port included', () => {
      const headers = new Headers({ host: 'app.example.com:8443' })
      expect(() => getRequestOrigin(headers, { allowedHosts: ['app.example.com'] })).toThrow('not in allowedHosts')
    })

    it('rejects everything when empty', () => {
      expect(() => getRequestOrigin(new Headers({ host: 'a.com' }), { allowedHosts: [] })).toThrow(
        'not in allowedHosts'
      )
    })
  })
})

describe('getSafeRedirect with options', () => {
  const authorize = (url: URL) => url.host === 'auth.example.com' && url.pathname === '/o/authorize/'

  it('takes the fallback from an options object, defaulting to /', () => {
    expect(getSafeRedirect('//evil.com', { fallback: '/home' })).toBe('/home')
    expect(getSafeRedirect('//evil.com', {})).toBe('/')
  })

  it('lets through an absolute URL that allow answers true for, normalised', () => {
    expect(getSafeRedirect('https://auth.example.com/o/authorize/?client_id=x', { allow: authorize })).toBe(
      'https://auth.example.com/o/authorize/?client_id=x'
    )
    expect(getSafeRedirect('HTTP://auth.example.com/o/authorize/', { allow: authorize })).toBe(
      'http://auth.example.com/o/authorize/'
    )
  })

  it('refuses an absolute URL that allow answers false for', () => {
    expect(getSafeRedirect('https://evil.com/o/authorize/', { allow: authorize, fallback: '/f' })).toBe('/f')
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,hi'],
    ['ftp:', 'ftp://auth.example.com/o/authorize/'],
    ['a protocol-relative path', '//auth.example.com/o/authorize/'],
    ['something that is not a URL', 'not a url'],
  ])('never asks allow about %s', (_, next) => {
    const allow = vi.fn(() => true)
    expect(getSafeRedirect(next, { allow })).toBe('/')
    expect(allow).not.toHaveBeenCalled()
  })

  it('still decides a path by the same-origin rule, without asking allow', () => {
    const allow = vi.fn(() => true)
    expect(getSafeRedirect('/dashboard', { allow })).toBe('/dashboard')
    expect(getSafeRedirect('/\\evil.com', { allow })).toBe('/')
    expect(allow).not.toHaveBeenCalled()
  })

  it('refuses an absolute URL with no allow', () => {
    expect(getSafeRedirect('https://example.com/a', {})).toBe('/')
  })
})

describe('getRequestOrigin fallbackHost', () => {
  it('answers the fallback for a host outside allowedHosts, ignoring the forwarded protocol', () => {
    const headers = new Headers({ 'x-forwarded-host': 'evil.com', 'x-forwarded-proto': 'http' })
    expect(getRequestOrigin(headers, { allowedHosts: ['app.example.com'], fallbackHost: 'app.example.com' })).toBe(
      'https://app.example.com'
    )
  })

  it('answers the fallback when the request names no host', () => {
    expect(getRequestOrigin(new Headers(), { allowedHosts: 'any', fallbackHost: 'localhost:3000' })).toBe(
      'http://localhost:3000'
    )
  })

  it("decides the fallback's protocol with isLocalDevHost", () => {
    const options = {
      allowedHosts: [],
      fallbackHost: 'dev.test',
      isLocalDevHost: (host: string) => host === 'dev.test',
    }
    expect(getRequestOrigin(new Headers({ host: 'x.com' }), options)).toBe('http://dev.test')
  })

  it('leaves an allowed host alone', () => {
    const headers = new Headers({ host: 'app.example.com' })
    expect(getRequestOrigin(headers, { allowedHosts: ['app.example.com'], fallbackHost: 'other.com' })).toBe(
      'https://app.example.com'
    )
  })
})

describe('isPlainHttpLocalDev', () => {
  it.each([
    ['localhost over http', { host: 'localhost:3000' }, true],
    ['localhost forwarded as http', { 'x-forwarded-host': 'localhost', 'x-forwarded-proto': 'http' }, true],
    ['localhost forwarded as https', { host: 'localhost', 'x-forwarded-proto': 'https' }, false],
    ['a public host', { host: 'app.example.com' }, false],
    ['no host at all', {}, false],
  ])('reads %s as %s', (_, headers, expected) => {
    expect(isPlainHttpLocalDev(new Headers(headers))).toBe(expected)
  })

  it('takes its own local-dev check', () => {
    expect(isPlainHttpLocalDev(new Headers({ host: 'x.test' }), (host) => host === 'x.test')).toBe(true)
  })

  it('never asks the check about a request with no host', () => {
    expect(isPlainHttpLocalDev(new Headers(), () => true)).toBe(false)
  })
})
