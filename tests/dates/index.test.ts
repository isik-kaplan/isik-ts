import { fc, test } from '@fast-check/vitest'

import { describe, expect, it } from 'vitest'

import {
  formattedDate,
  longFormattedDate,
  optionalDate,
  shortFormattedDate,
  shortFormattedDateTime,
  toDate,
} from '../../src/dates'

const date = new Date('2026-01-05T14:30:00Z')

describe('formattedDate', () => {
  it('formats a date with the given pattern', () => {
    expect(formattedDate('yyyy-MM-dd', date)).toBe('2026-01-05')
  })
})

describe('longFormattedDate', () => {
  it('formats with the long date format', () => {
    expect(longFormattedDate(date)).toMatch(/^Monday, January 05, 2026 at \d{2}:\d{2} (AM|PM)$/)
  })
})

describe('shortFormattedDate', () => {
  it('formats with the short date format', () => {
    expect(shortFormattedDate(date)).toBe('05.01.2026')
  })
})

describe('shortFormattedDateTime', () => {
  it('formats with the short date-time format', () => {
    expect(shortFormattedDateTime(date)).toMatch(/^05\.01\.2026 \d{2}:\d{2} (AM|PM)$/)
  })
})

describe('optionalDate', () => {
  it('returns undefined for an undefined input', () => {
    expect(optionalDate(undefined)).toBeUndefined()
  })

  it('parses a date string', () => {
    expect(optionalDate('2026-01-05T14:30:00Z')).toEqual(date)
  })

  test.prop([fc.date({ noInvalidDate: true })])('round-trips any valid Date through its own ISO string', (d) => {
    expect(optionalDate(d.toISOString())).toEqual(d)
  })
})

describe('toDate', () => {
  it('reads epoch seconds when told the unit', () => {
    expect(toDate(1767623400, 'seconds')).toEqual(date)
  })

  it('reads a number as milliseconds by default, as Date does', () => {
    expect(toDate(1767623400000)).toEqual(date)
  })

  it('reads milliseconds when told so explicitly', () => {
    expect(toDate(1767623400000, 'milliseconds')).toEqual(date)
  })

  it('parses a string as new Date would', () => {
    expect(toDate('2026-01-05T14:30:00Z')).toEqual(date)
  })

  // A string is never a count of anything, so a unit given alongside one must not scale it.
  it('ignores the unit for a string', () => {
    expect(toDate('2026-01-05T14:30:00Z', 'seconds')).toEqual(date)
  })

  it('returns a Date as it came, whatever the unit', () => {
    expect(toDate(date, 'seconds')).toBe(date)
  })

  test.prop([fc.integer({ min: -8_640_000_000, max: 8_640_000_000 })])(
    'agrees with the hand-written multiplication for any whole second',
    (seconds) => {
      expect(toDate(seconds, 'seconds').getTime()).toBe(seconds * 1000)
    }
  )
})
