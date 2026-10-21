import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { retryAfterOf } from '../../src/http'

function withRetryAfter(value?: string) {
  return { headers: new Headers(value === undefined ? {} : { 'Retry-After': value }) }
}

describe('retryAfterOf', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['delta-seconds', '120', 120],
    ['zero', '0', 0],
    ['delta-seconds with whitespace around it', ' 30 ', 30],
    ['an IMF-fixdate', 'Wed, 21 Oct 2026 12:01:30 GMT', 90],
    ['an RFC 850 date', 'Wednesday, 21-Oct-26 12:00:10 GMT', 10],
    ['an asctime date', 'Wed Oct 21 12:00:05 2026', 5],
    ['an asctime date with a one-digit day', 'Fri Oct  2 12:00:00 2026', 0],
    ['a date already past', 'Sun, 06 Nov 1994 08:49:37 GMT', 0],
  ])('reads %s', (_, value, seconds) => {
    expect(retryAfterOf(withRetryAfter(value))).toBe(seconds)
  })

  it('rounds a date up to the whole second', () => {
    vi.setSystemTime(new Date('2026-10-21T12:00:00.200Z'))
    expect(retryAfterOf(withRetryAfter('Wed, 21 Oct 2026 12:00:02 GMT'))).toBe(2)
  })

  it('reads a two-digit RFC 850 year more than 50 years ahead as the past century', () => {
    // 2094 would be 68 years ahead, so 94 is 1994 - long past.
    expect(retryAfterOf(withRetryAfter('Sunday, 06-Nov-94 08:49:37 GMT'))).toBe(0)
  })

  it('reads a two-digit RFC 850 year exactly 50 years ahead as this century', () => {
    expect(retryAfterOf(withRetryAfter('Wednesday, 21-Oct-76 12:00:00 GMT'))).toBeGreaterThan(0)
  })

  it('reads a two-digit RFC 850 year within 50 years ahead as this century', () => {
    expect(retryAfterOf(withRetryAfter('Thursday, 21-Oct-27 12:00:00 GMT'))).toBe(365 * 24 * 60 * 60)
  })

  it.each(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, index) => [
      month,
      index,
    ])
  )('reads the month %s', (month, index) => {
    const expected = (Date.UTC(2027, index as number, 1) - Date.now()) / 1000
    expect(retryAfterOf(withRetryAfter(`Mon, 01 ${month} 2027 00:00:00 GMT`))).toBe(expected)
  })

  it.each([
    ['no response', undefined],
    ['a null response', null],
    ['no header', withRetryAfter()],
    ['an empty header', withRetryAfter('')],
    ['a negative number', withRetryAfter('-1')],
    ['a fraction', withRetryAfter('1.5')],
    ['words', withRetryAfter('soon')],
    ['a date in another form', withRetryAfter('2026-10-21T12:01:00Z')],
    ['a date in another zone', withRetryAfter('Wed, 21 Oct 2026 12:01:30 CET')],
  ])('answers null for %s', (_, response) => {
    expect(retryAfterOf(response)).toBeNull()
  })
})
