// Two bases, because any one of them can be named back: `//a.invalid` resolved against
// `http://a.invalid` keeps its origin. Only a path with no authority of its own keeps both.
const REDIRECT_PROBE_BASES = ['http://a.invalid', 'http://b.invalid']

function staysOnOrigin(next: string): boolean {
  return REDIRECT_PROBE_BASES.every((base) => URL.canParse(next, base) && new URL(next, base).origin === base)
}

/**
 * Only a same-origin relative path passes, so a `next` query param can't be turned into an open
 * redirect. The URL parser decides rather than a prefix check: browsers read `\` as `/` and strip
 * tabs and newlines, so `/\evil.com` and `/<tab>/evil.com` are protocol-relative too.
 */
export function getSafeRedirect(next: unknown, fallback: string = '/'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || !staysOnOrigin(next)) {
    return fallback
  }
  return next
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
   * whole host, ignoring case; a RegExp is tested against it. Pass it whenever no trusted proxy
   * strips `X-Forwarded-Host`, or any caller can name the host.
   */
  allowedHosts?: Array<string | RegExp>
}

/** A header's first item: each proxy in a chain appends its own, so the first is the client's. */
function firstHeaderItem(headers: Headers, name: string): string | undefined {
  return headers.get(name)?.split(',')[0].trim() || undefined
}

function isAllowedHost(host: string, allowedHosts: Array<string | RegExp>): boolean {
  return allowedHosts.some((allowed) =>
    typeof allowed === 'string' ? allowed.toLowerCase() === host.toLowerCase() : allowed.test(host)
  )
}

/**
 * Resolves the true external origin (e.g. `https://real.host`) of an incoming request from its
 * `X-Forwarded-*` headers, for server-side code that needs to build an absolute URL back to
 * itself behind a reverse proxy. Trusts `X-Forwarded-Proto` when present; otherwise falls back to
 * `isLocalDevHost` to decide between `http`/`https`, since local dev typically has no proxy
 * setting that header. Throws if neither `X-Forwarded-Host` nor `Host` is present, or if
 * `allowedHosts` is given and the host is not in it.
 */
export function getRequestOrigin(headers: Headers, options: GetRequestOriginOptions = {}): string {
  const { isLocalDevHost = isDefaultLocalDevHost, allowedHosts } = options
  const host = firstHeaderItem(headers, 'x-forwarded-host') ?? firstHeaderItem(headers, 'host')
  if (!host) {
    throw new Error('getRequestOrigin: request has neither an X-Forwarded-Host nor a Host header')
  }
  if (allowedHosts && !isAllowedHost(host, allowedHosts)) {
    throw new Error(`getRequestOrigin: host ${JSON.stringify(host)} is not in allowedHosts`)
  }

  const protocol = firstHeaderItem(headers, 'x-forwarded-proto') ?? (isLocalDevHost(host) ? 'http' : 'https')
  return `${protocol}://${host}`
}
