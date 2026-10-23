import { cache } from 'react'

import { redirect } from 'next/navigation'

export interface SessionGuards<T, S = T | null> {
  /** Returns the session, redirecting to `redirectTo` (default `loginPath`) if there isn't one. */
  requireSession: (redirectTo?: string) => Promise<T>
  /** Redirects to `redirectTo` (default `redirectPath`) if a session is present; no-ops otherwise. */
  redirectIfPresent: (redirectTo?: string) => Promise<void>
  /** The fetched state itself, from the same cached fetch - for a page that reads more than the session. */
  getState: () => Promise<S>
}

export interface CreateSessionGuardsOptions<T, S> {
  /** Default redirect target for `requireSession`. Defaults to `/login`. */
  loginPath?: string
  /** Default redirect target for `redirectIfPresent`. Defaults to `/`. */
  redirectPath?: string
  /**
   * The session within what the fetch returns, or `null`/`undefined` for none. Default: the fetched
   * value itself, for a fetch that returns the session or `null`.
   */
  sessionOf?: (state: S) => T | null | undefined
  /**
   * Asked first by both guards: a path to send this visitor to whatever the session says - a signup
   * still waiting on a provider, say - or `null` to go on. The rule is the caller's.
   */
  redirectFor?: (state: S) => string | null | undefined
}

/**
 * Builds a pair of directional guards around a single session fetch, wrapped in React's `cache()`
 * so any number of layouts/pages calling either guard within one render pass dedupe to one
 * network call: `requireSession()` (redirect an anonymous visitor to a login page) and
 * `redirectIfPresent()` (redirect an already-authenticated visitor off an auth-only page, the
 * opposite direction).
 *
 * The fetch may return more than the session - a state object with pending steps beside it - and
 * `sessionOf` picks the session out. The session type comes first, so `createSessionGuards<Session>`
 * keeps meaning a fetch of `Session | null`.
 */
export function createSessionGuards<T, S = T | null>(
  fetchState: () => Promise<S>,
  options: CreateSessionGuardsOptions<T, S> = {}
): SessionGuards<T, S> {
  const {
    loginPath = '/login',
    redirectPath = '/',
    sessionOf = (state: S) => state as unknown as T | null,
    redirectFor,
  } = options
  const getState = cache(fetchState)

  // `redirect` throws, so a path here never returns.
  async function sessionAfterDetours(): Promise<T | null | undefined> {
    const state = await getState()
    const detour = redirectFor?.(state)
    if (detour) redirect(detour)
    return sessionOf(state)
  }

  return {
    async requireSession(redirectTo = loginPath) {
      const session = await sessionAfterDetours()
      if (!session) {
        redirect(redirectTo)
      }
      return session
    },
    async redirectIfPresent(redirectTo = redirectPath) {
      const session = await sessionAfterDetours()
      if (session) {
        redirect(redirectTo)
      }
    },
    getState,
  }
}
