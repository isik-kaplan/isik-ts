import type { FormErrors } from '../drf'

type AllauthError = { message: string; param?: string }

/**
 * django-allauth's headless API refuses in one shape whatever the status:
 *
 *     {"status": 400, "errors": [{"message": "...", "code": "email_taken", "param": "email"}]}
 *
 * An entry with a `param` is about that field and one without is about the request as a whole. Only
 * entries carrying a string `message` are read - that is the part written for a person.
 */
function errorsOf(body: unknown): AllauthError[] {
  const errors = body && (body as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return []
  return errors.filter(
    (entry): entry is AllauthError => Boolean(entry) && typeof (entry as { message?: unknown }).message === 'string'
  )
}

/**
 * Reads allauth's refusal into `{ field: string[] }`, the same shape `@isikk/core/drf`'s reader
 * gives, so a form renders either server's errors in the same place. An error with no `param` goes
 * to `non_field_errors`. Returns `undefined` when there is nothing to read.
 */
export function toFormErrors(body: unknown): FormErrors | undefined {
  const errors = new Map<string, string[]>()
  for (const { message, param } of errorsOf(body)) {
    const field = typeof param === 'string' ? param : 'non_field_errors'
    errors.set(field, [...(errors.get(field) ?? []), message])
  }
  // Built through entries so a `param` of `__proto__` is a field.
  return errors.size > 0 ? Object.fromEntries(errors) : undefined
}

/**
 * Every message allauth sent, as one line - its 409s and 429s carry the sentence a person should
 * read in the same list a 400 uses.
 */
export function detailOf(body: unknown): string | undefined {
  const messages = errorsOf(body).map(({ message }) => message)
  return messages.length > 0 ? messages.join(' ') : undefined
}

/** For `useAPISubmit`, `useValidatedFormState` and `createSubmitHooks` on an allauth endpoint. */
export const allauthEnvelope = { toFormErrors, detailOf }
