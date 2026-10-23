// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}))

const requestHeaders = vi.hoisted(() => ({ current: new Headers({ host: 'app.example.com' }) }))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => store),
  headers: vi.fn(async () => requestHeaders.current),
}))

const { getCookie, removeCookie, setCookie } = await import('../../src/next/cookies')

describe('setCookie', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets it HttpOnly, Secure and SameSite=Lax on path / by default', async () => {
    await setCookie('session', 'abc123')
    expect(store.set).toHaveBeenCalledExactlyOnceWith({
      name: 'session',
      value: 'abc123',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    })
  })

  it('leaves Secure off for a local-dev host over plain http', async () => {
    requestHeaders.current = new Headers({ host: 'localhost:3000' })
    await setCookie('session', 'abc123')
    expect(store.set).toHaveBeenCalledWith(expect.objectContaining({ secure: false }))
    requestHeaders.current = new Headers({ host: 'app.example.com' })
  })

  it('takes every attribute as an option', async () => {
    await setCookie('theme', 'dark', { httpOnly: false, secure: false, sameSite: 'strict', maxAge: 60, path: '/app' })
    expect(store.set).toHaveBeenCalledExactlyOnceWith({
      name: 'theme',
      value: 'dark',
      httpOnly: false,
      secure: false,
      sameSite: 'strict',
      path: '/app',
      maxAge: 60,
    })
  })

  it('refuses SameSite=none without Secure', async () => {
    await expect(setCookie('a', 'b', { sameSite: 'none', secure: false })).rejects.toThrow(
      new TypeError('setCookie: sameSite "none" needs secure - browsers drop it otherwise')
    )
    expect(store.set).not.toHaveBeenCalled()
    await setCookie('a', 'b', { sameSite: 'none' })
    expect(store.set).toHaveBeenCalledWith(expect.objectContaining({ sameSite: 'none', secure: true }))
  })
})

describe('getCookie', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the cookie value when present', async () => {
    store.get.mockReturnValueOnce({ value: 'abc123' })
    expect(await getCookie('session')).toBe('abc123')
  })

  it('returns null when the cookie is absent', async () => {
    store.get.mockReturnValueOnce(undefined)
    expect(await getCookie('session')).toBeNull()
  })

  it('returns an empty string value as-is instead of treating it as absent', async () => {
    store.get.mockReturnValueOnce({ value: '' })
    expect(await getCookie('session')).toBe('')
  })
})

describe('removeCookie', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the cookie via the next/headers cookie store', async () => {
    await removeCookie('session')
    expect(store.delete).toHaveBeenCalledWith('session')
  })
})
