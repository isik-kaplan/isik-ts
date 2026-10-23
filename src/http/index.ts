import { getCookie } from '../cookies'

const DAYS = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)'
const LONG_DAYS = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = `(${MONTHS.join('|')})`
const TIME = '(\\d{2}):(\\d{2}):(\\d{2})'

// The three forms RFC 9110 has a recipient accept. Matched exactly rather than handed to
// `Date.parse`, which reads `1.5` as a day in 2001 and an asctime date as local time.
const IMF_FIXDATE = new RegExp(`^${DAYS}, (\\d{2}) ${MONTH} (\\d{4}) ${TIME} GMT$`)
const RFC_850 = new RegExp(`^${LONG_DAYS}, (\\d{2})-${MONTH}-(\\d{2}) ${TIME} GMT$`)
const ASCTIME = new RegExp(`^${DAYS} ${MONTH} ( \\d|\\d{2}) ${TIME} (\\d{4})$`)

function utc(year: number, month: string, day: string, hours: string, minutes: string, seconds: string): number {
  return Date.UTC(year, MONTHS.indexOf(month), Number(day), Number(hours), Number(minutes), Number(seconds))
}

/** An HTTP-date as epoch milliseconds, or `undefined` for anything else. */
function parseHTTPDate(value: string, now: number): number | undefined {
  let match = IMF_FIXDATE.exec(value)
  if (match) {
    const [, day, month, year, ...time] = match
    return utc(Number(year), month, day, ...(time as [string, string, string]))
  }
  match = RFC_850.exec(value)
  if (match) {
    const [, day, month, shortYear, ...time] = match
    // A two-digit year more than 50 years ahead is read as the most recent past one, as RFC 9110 asks.
    let year = 2000 + Number(shortYear)
    if (year > new Date(now).getUTCFullYear() + 50) year -= 100
    return utc(year, month, day, ...(time as [string, string, string]))
  }
  match = ASCTIME.exec(value)
  if (match) {
    const [, month, day, hours, minutes, seconds, year] = match
    return utc(Number(year), month, day, hours, minutes, seconds)
  }
  return undefined
}

/**
 * How many seconds a response asks the client to wait, from its `Retry-After` header - either form
 * the header takes, delta-seconds (`120`) or an HTTP-date. `null` when there is no response, no
 * header, or one that is neither form.
 *
 * Never negative: a date already past reads as `0`. A date is rounded up to whole seconds, so waiting
 * the answer is always enough.
 */
export function retryAfterOf(response: { headers: Headers } | null | undefined): number | null {
  // `Headers` trims a value already, and an empty one matches neither form below.
  // Stryker disable next-line StringLiteral: equivalent mutant - any fallback that is neither form
  // reads as null the same way.
  const value = response?.headers.get('Retry-After') ?? ''
  if (/^\d+$/.test(value)) return Number(value)
  const now = Date.now()
  const date = parseHTTPDate(value, now)
  return date === undefined ? null : Math.max(0, Math.ceil((date - now) / 1000))
}

/**
 * A response's `ETag`, exactly as sent - quotes and any `W/` kept, so it goes back into `If-Match`
 * unchanged and the server compares what it issued. `null` with no response or no header.
 *
 * A cross-origin page reads it only if the server lists `ETag` in `Access-Control-Expose-Headers`.
 */
export function etagOf(response: { headers: Headers } | null | undefined): string | null {
  return response?.headers.get('ETag') ?? null
}

declare const versioned: unique symbol
declare const keyed: unique symbol

/**
 * Marks headers whose write decided its version: `ifMatch`, `anyVersion`, or a submit given an
 * `etag` - `null` included, the deliberate "no version, expect a 428". A client method that takes
 * `headers: WriteHeaders & Versioned` then refuses headers built without that decision, at compile
 * time rather than as a 428.
 *
 * Type-only: nothing at runtime carries it, so the headers stay a plain record. It survives a
 * spread, `{ ...headers, Authorization }`, and is lost by picking keys into a new object.
 */
export type Versioned = { readonly [versioned]: true }

/** `Versioned`'s twin for an `Idempotency-Key`: headers, or a key, that a submit or `idempotencyKey` made. */
export type Keyed = { readonly [keyed]: true }

/** An idempotency key from `useIdempotencyKey` or a submit - still a string wherever one is taken. */
export type IdempotencyKey = string & Keyed

/** The `If-Match` header for a write, to spread into a client's headers. `'*'` matches any version. */
export function ifMatch(etag: string): { 'If-Match': string } & Versioned {
  if (etag === '') throw new TypeError('ifMatch: an empty ETag matches nothing - pass the one the server sent, or "*"')
  return { 'If-Match': etag } as { 'If-Match': string } & Versioned
}

/**
 * `If-Match: *` - write over whatever version is there. Its own name so an overwrite is a choice
 * someone can find; send it only when a person made it. A server may refuse it with a 428.
 */
export function anyVersion(): { 'If-Match': '*' } & Versioned {
  return ifMatch('*') as { 'If-Match': '*' } & Versioned
}

/** The `Idempotency-Key` header for a key, to spread into a client's headers. */
export function idempotencyKey(key: string): { 'Idempotency-Key': IdempotencyKey } & Keyed {
  if (key === '') throw new TypeError('idempotencyKey: an empty key names no attempt')
  return { 'Idempotency-Key': key } as { 'Idempotency-Key': IdempotencyKey } & Keyed
}

/** A 412: the `If-Match` sent names a version someone else has since replaced. */
export function isPreconditionFailed(response: { status: number } | null | undefined): boolean {
  return response?.status === 412
}

/** A 428: the server needs an `If-Match` and the write sent none. */
export function isPreconditionRequired(response: { status: number } | null | undefined): boolean {
  return response?.status === 428
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input)
}

/** The URL without its query and fragment, which can carry tokens. A relative URL is cut by hand. */
function withoutQuery(url: string): string {
  return url.split(/[?#]/, 1)[0]
}

export interface NameFetchFailuresOptions {
  /** Keep the query string in the message. Off by default: a query can carry a token, and the message lands in logs. */
  includeQuery?: boolean
}

/**
 * Wraps a fetch so a network failure names the call that failed: `fetch failed: POST
 * https://api.example.com/v0/orders/ (ECONNREFUSED)`, the original kept on `cause`. undici's own
 * `fetch failed` carries only its own frames, so Next's error digest reads every network failure
 * alike without this.
 */
export function nameFetchFailures(baseFetch: typeof fetch, options: NameFetchFailuresOptions = {}): typeof fetch {
  return async (input, init) => {
    try {
      return await baseFetch(input, init)
    } catch (cause) {
      const method = (init?.method ?? (input instanceof Request ? input.method : undefined) ?? 'GET').toUpperCase()
      const url = options.includeQuery ? urlOf(input) : withoutQuery(urlOf(input))
      const code = (cause as { cause?: { code?: unknown } } | null | undefined)?.cause?.code
      const suffix = typeof code === 'string' ? ` (${code})` : ''
      throw Object.assign(new Error(`fetch failed: ${method} ${url}${suffix}`), { cause })
    }
  }
}

// RFC 9110's safe methods: they change nothing, so Django checks no CSRF token on them.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

export interface DjangoFetchOptions {
  /** The API's base URL. Its origin is the one the session cookie and the CSRF token are sent to. */
  baseUrl: string
  /** Default `'csrftoken'`, Django's `CSRF_COOKIE_NAME`. */
  csrfCookieName?: string
  /** Default `'X-CSRFToken'`, the header Django's `CSRF_HEADER_NAME` reads. */
  csrfHeaderName?: string
  /**
   * Server-side only: the incoming request's `Cookie` header. It is forwarded to the API, and the
   * CSRF token is read from it, since there is no `document.cookie` on the server.
   */
  cookieHeader?: string
  /** The fetch to wrap. Default: the global one, looked up at call time. */
  baseFetch?: typeof fetch
  /** Sent with requests to a trusted origin. Default `'include'`. */
  credentials?: RequestCredentials
  /**
   * A URL that sets the CSRF cookie - Django's `ensure_csrf_cookie`. In the browser, an unsafe request
   * made while the cookie is missing GETs it first. Requests made together share that one GET, and a
   * failed one lets the request go ahead and be refused as it would have been.
   */
  primeUrl?: string
  /**
   * The origins that receive the `Cookie` header, the CSRF token and `credentials`. Default: only
   * `baseUrl`'s, so a request this fetch makes anywhere else carries none of them. `'any'` turns the
   * check off.
   */
  forwardTo?: string[] | 'any'
}

function originOf(url: string, base?: string): string | undefined {
  return URL.canParse(url, base) ? new URL(url, base).origin : undefined
}

/**
 * A fetch for a Django API, to hand a typed client such as openapi-fetch: it sends the CSRF token in
 * the header Django reads, forwards the session cookie on the server, and keeps the headers of a
 * `Request` it is given, which openapi-fetch's own fetch call would otherwise drop.
 *
 * Nothing goes into a request body - the token travels as a header.
 */
export function createDjangoFetch(options: DjangoFetchOptions): typeof fetch {
  const {
    baseUrl,
    csrfCookieName = 'csrftoken',
    csrfHeaderName = 'X-CSRFToken',
    cookieHeader,
    baseFetch = (input, init) => fetch(input, init),
    credentials = 'include',
    primeUrl,
    forwardTo,
  } = options
  const baseOrigin = originOf(baseUrl)
  if (baseOrigin === undefined) {
    throw new TypeError(`createDjangoFetch: baseUrl ${JSON.stringify(baseUrl)} is not an absolute URL`)
  }
  const trusted = forwardTo === 'any' ? undefined : new Set(forwardTo ?? [baseOrigin])
  const inBrowser = typeof document !== 'undefined'

  function readToken(): string | undefined {
    if (cookieHeader !== undefined) return getCookie(csrfCookieName, { from: cookieHeader })
    return inBrowser ? getCookie(csrfCookieName) : undefined
  }

  let priming: Promise<void> | undefined
  function prime(url: string): Promise<void> {
    priming ??= baseFetch(url, { credentials }).then(
      () => undefined,
      () => undefined
    )
    return priming.finally(() => {
      priming = undefined
    })
  }

  return async (input, init) => {
    const request = input instanceof Request ? input : undefined
    // A relative URL is resolved against the page, so it is trusted only when the page is the API.
    const origin = originOf(urlOf(input), globalThis.location?.href)
    const headers = new Headers(request?.headers)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))

    if (origin === undefined || !(trusted?.has(origin) ?? true)) {
      return baseFetch(input, { ...init, headers })
    }

    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    let token = readToken()
    if (
      token === undefined &&
      primeUrl !== undefined &&
      inBrowser &&
      cookieHeader === undefined &&
      !SAFE_METHODS.has(method)
    ) {
      await prime(primeUrl)
      token = readToken()
    }
    if (token !== undefined) headers.set(csrfHeaderName, token)
    if (cookieHeader !== undefined) headers.set('Cookie', cookieHeader)
    return baseFetch(input, { ...init, headers, credentials })
  }
}
