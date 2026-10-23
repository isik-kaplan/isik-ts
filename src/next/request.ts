// Two bases, because any one of them can be named back: `//a.invalid` resolved against
// `http://a.invalid` keeps its origin. Only a path with no authority of its own keeps both.
const REDIRECT_PROBE_BASES = ['http://a.invalid', 'http://b.invalid']

function staysOnOrigin(next: string): boolean {
  return REDIRECT_PROBE_BASES.every((base) => URL.canParse(next, base) && new URL(next, base).origin === base)
}

export interface SafeRedirectOptions {
  /** Where to go when `next` is refused. Default `'/'`. */
  fallback?: string
  /**
   * Lets an absolute http(s) URL through when it answers true - an OAuth authorize endpoint on
   * another host, say. Only ever asked about an absolute `http:` or `https:` URL, never a
   * `javascript:` or `data:` one or a protocol-relative path. The rule is the caller's.
   */
  allow?: (url: URL) => boolean
}

/**
 * Only a same-origin relative path passes, so a `next` query param can't be turned into an open
 * redirect. The URL parser decides rather than a prefix check: browsers read `\` as `/` and strip
 * tabs and newlines, so `/\evil.com` and `/<tab>/evil.com` are protocol-relative too.
 *
 * The second argument is the fallback, or `{ fallback, allow }`.
 */
export function getSafeRedirect(next: unknown, fallbackOrOptions: string | SafeRedirectOptions = '/'): string {
  const { fallback = '/', allow } =
    typeof fallbackOrOptions === 'string' ? { fallback: fallbackOrOptions } : fallbackOrOptions
  if (typeof next !== 'string') return fallback
  if (next.startsWith('/')) return staysOnOrigin(next) ? next : fallback
  if (allow && URL.canParse(next)) {
    const url = new URL(next)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && allow(url)) return url.href
  }
  return fallback
}

const DEFAULT_LOCAL_DEV_HOSTS: RegExp[] = [/^localhost(:\d+)?$/, /^127\.0\.0\.1(:\d+)?$/]

function isDefaultLocalDevHost(host: string): boolean {
  return DEFAULT_LOCAL_DEV_HOSTS.some((pattern) => pattern.test(host))
}

export interface GetRequestOriginOptions {
  /** Overrides how a "known local-dev host" (assumed http, not https) is detected. */
  isLocalDevHost?: (host: string) => boolean
  /**
   * The hosts this deployment answers on, port included when there is one. A string matches the
   * whole host, ignoring case; a RegExp is tested against it; a function is asked. Required: `X-Forwarded-Host` and
   * `Host` are whatever the caller sent, so without a list any caller names the origin. `'any'`
   * turns the check off, for a deployment behind a proxy that sets them itself.
   */
  allowedHosts: AllowedHost[] | 'any'
  /**
   * The host to use when the request's is missing or not allowed, instead of throwing. Its protocol
   * comes from `isLocalDevHost`, never from the refused request's `X-Forwarded-Proto`. For a
   * single-origin deployment only: in a multi-tenant one it would render another tenant's page where
   * a refusal belongs.
   */
  fallbackHost?: string
}

/** A header's first item: each proxy in a chain appends its own, so the first is the client's. */
function firstHeaderItem(headers: Headers, name: string): string | undefined {
  return headers.get(name)?.split(',')[0].trim() || undefined
}

/** An `allowedHosts` entry: a whole host, a pattern, or a check asked about the host. */
export type AllowedHost = string | RegExp | ((host: string) => boolean)

function allows(allowed: AllowedHost, host: string): boolean {
  if (typeof allowed === 'string') return allowed.toLowerCase() === host.toLowerCase()
  if (typeof allowed === 'function') return allowed(host)
  return allowed.test(host)
}

function isAllowedHost(host: string, allowedHosts: AllowedHost[]): boolean {
  return allowedHosts.some((allowed) => allows(allowed, host))
}

/**
 * Resolves the true external origin (e.g. `https://real.host`) of an incoming request from its
 * `X-Forwarded-*` headers, for server-side code that needs to build an absolute URL back to
 * itself behind a reverse proxy. Trusts `X-Forwarded-Proto` when present; otherwise falls back to
 * `isLocalDevHost` to decide between `http`/`https`, since local dev typically has no proxy
 * setting that header.
 *
 * A host outside `allowedHosts`, or none at all, gives `fallbackHost`'s origin, or throws without one.
 */
export function getRequestOrigin(headers: Headers, options: GetRequestOriginOptions): string {
  const { isLocalDevHost = isDefaultLocalDevHost, allowedHosts, fallbackHost } = options
  const host = firstHeaderItem(headers, 'x-forwarded-host') ?? firstHeaderItem(headers, 'host')
  if (host && (allowedHosts === 'any' || isAllowedHost(host, allowedHosts))) {
    const protocol = firstHeaderItem(headers, 'x-forwarded-proto') ?? (isLocalDevHost(host) ? 'http' : 'https')
    return `${protocol}://${host}`
  }
  if (fallbackHost !== undefined) return `${isLocalDevHost(fallbackHost) ? 'http' : 'https'}://${fallbackHost}`
  throw new Error(
    host
      ? `getRequestOrigin: host ${JSON.stringify(host)} is not in allowedHosts`
      : 'getRequestOrigin: request has neither an X-Forwarded-Host nor a Host header'
  )
}

/** A request served over plain http to a local-dev host - where a `Secure` cookie would be dropped. */
export function isPlainHttpLocalDev(headers: Headers, isLocalDevHost = isDefaultLocalDevHost): boolean {
  const host = firstHeaderItem(headers, 'x-forwarded-host') ?? firstHeaderItem(headers, 'host')
  const protocol = firstHeaderItem(headers, 'x-forwarded-proto')
  return host !== undefined && isLocalDevHost(host) && protocol !== 'https'
}
