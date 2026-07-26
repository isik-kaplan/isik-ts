import { format } from 'date-fns'

export function formatDate(date: Date, pattern: string): string {
  return format(date, pattern)
}
