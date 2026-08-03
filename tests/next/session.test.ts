// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  })
)

vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, cache: (fn: (...args: never[]) => unknown) => fn }
})

const { createSessionGuards } = await import('../../src/next/session')

describe('createSessionGuards', () => {
  beforeEach(() => {
    redirectMock.mockClear()
  })

  describe('requireSession', () => {
    it('returns the session when one is present', async () => {
      const guards = createSessionGuards(async () => ({ userId: '1' }))
      await expect(guards.requireSession()).resolves.toEqual({ userId: '1' })
      expect(redirectMock).not.toHaveBeenCalled()
    })

    it('redirects to the default loginPath when there is no session', async () => {
      const guards = createSessionGuards(async () => null)
      await expect(guards.requireSession()).rejects.toThrow('NEXT_REDIRECT:/login')
      expect(redirectMock).toHaveBeenCalledWith('/login')
    })

    it('redirects to a custom loginPath from options', async () => {
      const guards = createSessionGuards(async () => null, { loginPath: '/signin' })
      await expect(guards.requireSession()).rejects.toThrow('NEXT_REDIRECT:/signin')
    })

    it('redirects to a per-call redirectTo override', async () => {
      const guards = createSessionGuards(async () => null)
      await expect(guards.requireSession('/custom')).rejects.toThrow('NEXT_REDIRECT:/custom')
    })
  })

  describe('redirectIfPresent', () => {
    it('does nothing when there is no session', async () => {
      const guards = createSessionGuards(async () => null)
      await expect(guards.redirectIfPresent()).resolves.toBeUndefined()
      expect(redirectMock).not.toHaveBeenCalled()
    })

    it('redirects to the default redirectPath when a session is present', async () => {
      const guards = createSessionGuards(async () => ({ userId: '1' }))
      await expect(guards.redirectIfPresent()).rejects.toThrow('NEXT_REDIRECT:/')
      expect(redirectMock).toHaveBeenCalledWith('/')
    })

    it('redirects to a custom redirectPath from options', async () => {
      const guards = createSessionGuards(async () => ({ userId: '1' }), { redirectPath: '/dashboard' })
      await expect(guards.redirectIfPresent()).rejects.toThrow('NEXT_REDIRECT:/dashboard')
    })

    it('redirects to a per-call redirectTo override', async () => {
      const guards = createSessionGuards(async () => ({ userId: '1' }))
      await expect(guards.redirectIfPresent('/custom')).rejects.toThrow('NEXT_REDIRECT:/custom')
    })
  })
})
