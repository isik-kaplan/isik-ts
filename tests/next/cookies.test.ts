// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => store),
}))

const { getCookie, removeCookie, setCookie } = await import('../../src/next/cookies')

describe('setCookie', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets the cookie via the next/headers cookie store', async () => {
    await setCookie('session', 'abc123')
    expect(store.set).toHaveBeenCalledWith('session', 'abc123')
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
