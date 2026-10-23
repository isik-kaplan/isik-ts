import { cookies, headers } from 'next/headers'

import { isPlainHttpLocalDev } from './request'

export interface ServerCookieOptions {
  /** Out of reach of the page's JavaScript. Default `true`. */
  httpOnly?: boolean
  /** Sent over https only. Default `true`, except to a local-dev host over plain http, which would drop it. */
  secure?: boolean
  /** Default `'lax'`. `'none'` needs `secure`. */
  sameSite?: 'strict' | 'lax' | 'none'
  /** Seconds until it expires. Omit for a session cookie. */
  maxAge?: number
  /** Default `'/'`. */
  path?: string
}

/**
 * Sets a cookie on the response, for a Server Action or Route Handler. At its most guarded by
 * default - HttpOnly, Secure, SameSite=Lax - so a cookie the page's script must read says so with
 * `httpOnly: false`.
 *
 * Plain server functions, not Server Actions: a `'use server'` export is a public endpoint any
 * visitor can call with any name, which would hand an HttpOnly session cookie to the page. An app
 * that wants one wraps these in its own action, with its own list of names.
 */
export async function setCookie(name: string, value: string, options: ServerCookieOptions = {}): Promise<void> {
  const {
    httpOnly = true,
    secure = !isPlainHttpLocalDev(await headers()),
    sameSite = 'lax',
    maxAge,
    path = '/',
  } = options
  if (sameSite === 'none' && !secure) {
    throw new TypeError('setCookie: sameSite "none" needs secure - browsers drop it otherwise')
  }
  // Next writes no Max-Age for an undefined one.
  ;(await cookies()).set({ name, value, httpOnly, secure, sameSite, path, maxAge })
}

export async function getCookie(name: string): Promise<string | null> {
  return (await cookies()).get(name)?.value ?? null
}

export async function removeCookie(name: string): Promise<void> {
  ;(await cookies()).delete(name)
}
