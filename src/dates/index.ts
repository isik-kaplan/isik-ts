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
