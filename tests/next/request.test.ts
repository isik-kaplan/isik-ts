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

  it('accepts a custom isLocalDevHost predicate', () => {
    const headers = new Headers({ host: 'app.internal.test' })
    expect(getRequestOrigin(headers, { isLocalDevHost: (host) => host.endsWith('.internal.test') })).toBe(
      'http://app.internal.test'
    )
  })

  it('throws when neither X-Forwarded-Host nor Host is present', () => {
    expect(() => getRequestOrigin(new Headers())).toThrow('neither an X-Forwarded-Host nor a Host header')
  })
})
