import { cache } from 'react'

import { redirect } from 'next/navigation'

export interface SessionGuards<T> {
  /** Returns the session, redirecting to `redirectTo` (default `loginPath`) if there isn't one. */
  requireSession: (redirectTo?: string) => Promise<T>
  /** Redirects to `redirectTo` (default `redirectPath`) if a session is present; no-ops otherwise. */
  redirectIfPresent: (redirectTo?: string) => Promise<void>
}

export interface CreateSessionGuardsOptions {
  /** Default redirect target for `requireSession`. Defaults to `/login`. */
  loginPath?: string
  /** Default redirect target for `redirectIfPresent`. Defaults to `/`. */
  redirectPath?: string
}

/**
 * Builds a pair of directional guards around a single session fetch, wrapped in React's `cache()`
 * so any number of layouts/pages calling either guard within one render pass dedupe to one
 * network call: `requireSession()` (redirect an anonymous visitor to a login page) and
 * `redirectIfPresent()` (redirect an already-authenticated visitor off an auth-only page, the
 * opposite direction).
 */
export function createSessionGuards<T>(
  fetchSession: () => Promise<T | null>,
  options: CreateSessionGuardsOptions = {}
): SessionGuards<T> {
  const { loginPath = '/login', redirectPath = '/' } = options
  const getSession = cache(fetchSession)

  return {
    async requireSession(redirectTo = loginPath) {
      const session = await getSession()
      if (!session) {
        redirect(redirectTo)
      }
      return session
    },
    async redirectIfPresent(redirectTo = redirectPath) {
      const session = await getSession()
      if (session) {
        redirect(redirectTo)
      }
    },
  }
}
