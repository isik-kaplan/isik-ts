/**
 * Validates that `next` is safe to pass to `redirect()` as a post-auth (or similar) redirect
 * target: a same-origin relative path. Rejects anything that isn't a string, doesn't start with
 * `/`, or starts with `//` (protocol-relative, i.e. an off-site redirect) - falling back to
 * `fallback` otherwise, so callers always get a definite path back.
 */
export function getSafeRedirect(next: unknown, fallback: string = '/'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) {
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
}

/**
 * Resolves the true external origin (e.g. `https://real.host`) of an incoming request from its
 * `X-Forwarded-*` headers, for server-side code that needs to build an absolute URL back to
 * itself behind a reverse proxy. Trusts `X-Forwarded-Proto` when present; otherwise falls back to
 * `isLocalDevHost` to decide between `http`/`https`, since local dev typically has no proxy
 * setting that header. Throws if neither `X-Forwarded-Host` nor `Host` is present.
 */
export function getRequestOrigin(headers: Headers, options: GetRequestOriginOptions = {}): string {
  const isLocalDevHost = options.isLocalDevHost ?? isDefaultLocalDevHost
  const host = headers.get('x-forwarded-host') ?? headers.get('host')
  if (!host) {
    throw new Error('getRequestOrigin: request has neither an X-Forwarded-Host nor a Host header')
  }

  const protocol = headers.get('x-forwarded-proto') ?? (isLocalDevHost(host) ? 'http' : 'https')
  return `${protocol}://${host}`
}
