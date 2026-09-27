import { formatDate } from './_format'

export const LONG_DATE_FORMAT = "EEEE, MMMM dd, yyyy 'at' hh:mm a"
export const SHORT_DATE_FORMAT = 'dd.MM.yyyy'
export const SHORT_DATETIME_FORMAT = 'dd.MM.yyyy HH:mm a'

export function formattedDate(pattern: string, date: Date = new Date()): string {
  return formatDate(date, pattern)
}

export function longFormattedDate(date: Date = new Date()): string {
  return formattedDate(LONG_DATE_FORMAT, date)
}

export function shortFormattedDate(date: Date = new Date()): string {
  return formattedDate(SHORT_DATE_FORMAT, date)
}

export function shortFormattedDateTime(date: Date = new Date()): string {
  return formattedDate(SHORT_DATETIME_FORMAT, date)
}

export function optionalDate(date?: string): Date | undefined {
  return date ? new Date(date) : undefined
}

const MILLISECONDS_PER = {
  seconds: 1000,
  milliseconds: 1,
} as const

/**
 * A number means nothing without its unit, and allauth's session and passkey payloads carry epoch
 * seconds where `Date` expects milliseconds. Naming the unit at the call site is what stops the
 * `* 1000` being rediscovered - forgetting it gives a date in January 1970 rather than an error.
 *
 * The unit only applies to a number. A string is parsed as `new Date` would, and a `Date` is
 * returned as it came.
 */
export function toDate(value: string | number | Date, unit: 'seconds' | 'milliseconds' = 'milliseconds'): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value * MILLISECONDS_PER[unit])
  return new Date(value)
}
