import { fc, test } from '@fast-check/vitest'

import { describe, expect, it } from 'vitest'

import {
  formattedDate,
  longFormattedDate,
  optionalDate,
  shortFormattedDate,
  shortFormattedDateTime,
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
