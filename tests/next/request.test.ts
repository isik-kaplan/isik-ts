import { describe, expect, it } from 'vitest'

import { getRequestOrigin, getSafeRedirect } from '../../src/next/request'

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

describe('getRequestOrigin', () => {
  it('trusts X-Forwarded-Proto when present', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'https', host: 'app.example.com' })
    expect(getRequestOrigin(headers)).toBe('https://app.example.com')
  })

  it('prefers X-Forwarded-Host over Host', () => {
    const headers = new Headers({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'public.example.com',
      host: 'internal-backend',
    })
    expect(getRequestOrigin(headers)).toBe('https://public.example.com')
  })

  it('defaults to https for a non-local host when X-Forwarded-Proto is absent', () => {
    const headers = new Headers({ host: 'app.example.com' })
    expect(getRequestOrigin(headers)).toBe('https://app.example.com')
  })

  it('defaults to http for a known local-dev host when X-Forwarded-Proto is absent', () => {
    expect(getRequestOrigin(new Headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000')
    expect(getRequestOrigin(new Headers({ host: '127.0.0.1:3000' }))).toBe('http://127.0.0.1:3000')
  })

  it('treats the port as optional for known local-dev hosts', () => {
    expect(getRequestOrigin(new Headers({ host: 'localhost' }))).toBe('http://localhost')
    expect(getRequestOrigin(new Headers({ host: '127.0.0.1' }))).toBe('http://127.0.0.1')
  })

  it('does not match a host that merely contains a local-dev hostname as a substring', () => {
    // Exercises both anchors on each pattern: a prefix before "localhost"/"127.0.0.1" defeats
    // `^`, and a suffix after the optional port defeats `$`.
    expect(getRequestOrigin(new Headers({ host: 'notlocalhost:3000' }))).toBe('https://notlocalhost:3000')
    expect(getRequestOrigin(new Headers({ host: 'localhost.evil.com:3000' }))).toBe('https://localhost.evil.com:3000')
    expect(getRequestOrigin(new Headers({ host: 'not127.0.0.1:3000' }))).toBe('https://not127.0.0.1:3000')
    expect(getRequestOrigin(new Headers({ host: '127.0.0.1.evil.com:3000' }))).toBe('https://127.0.0.1.evil.com:3000')
  })

  it('accepts a custom isLocalDevHost predicate', () => {
    const headers = new Headers({ host: 'app.internal.test' })
    expect(getRequestOrigin(headers, { isLocalDevHost: (host) => host.endsWith('.internal.test') })).toBe(
      'http://app.internal.test'
    )
  })

  it('throws when neither X-Forwarded-Host nor Host is present', () => {
    expect(() => getRequestOrigin(new Headers())).toThrow('neither an X-Forwarded-Host nor a Host header')
  })

  it('takes the first item of a comma list from chained proxies', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'https , http', 'x-forwarded-host': ' a.com , b.com' })
    expect(getRequestOrigin(headers)).toBe('https://a.com')
  })

  it('reads the local-dev check against the first item only', () => {
    expect(getRequestOrigin(new Headers({ 'x-forwarded-host': 'localhost:3000, proxy.internal' }))).toBe(
      'http://localhost:3000'
    )
  })

  it('falls through to Host when X-Forwarded-Host is empty', () => {
    expect(getRequestOrigin(new Headers({ 'x-forwarded-host': '', host: 'app.example.com' }))).toBe(
      'https://app.example.com'
    )
  })

  it('throws when the host is blank', () => {
    expect(() => getRequestOrigin(new Headers({ host: ' , b.com' }))).toThrow('neither an X-Forwarded-Host')
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
