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
