import type { FormErrors } from '../drf'

/** One entry of allauth's `errors` list. `param` names the field; without one it is about the request. */
export type AllauthError = { message: string; code?: string; param?: string }

/** allauth's headless refusal, whatever the status. */
export type AllauthErrorResponse = { status: number; errors: AllauthError[] }

/**
 * django-allauth's headless API refuses in one shape whatever the status:
 *
 *     {"status": 400, "errors": [{"message": "...", "code": "email_taken", "param": "email"}]}
 *
 * An entry with a `param` is about that field and one without is about the request as a whole. Only
 * entries carrying a string `message` are read - that is the part written for a person - so a
 * malformed entry never reaches a page. `undefined` when the body has no `errors` list.
 */
export function errorsOf(body: unknown): AllauthError[] | undefined {
  const errors = body && (body as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return undefined
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
  for (const { message, param } of errorsOf(body) ?? []) {
    const field = typeof param === 'string' ? param : 'non_field_errors'
    errors.set(field, [...(errors.get(field) ?? []), message])
  }
  // Built through entries so a `param` of `__proto__` is a field.
  return errors.size > 0 ? Object.fromEntries(errors) : undefined
}

/**
 * Every message allauth sent, as one line - a refusal not about a field, a 409 among them, carries
 * the sentence a person should read in the same list a 400 uses. A 429 often carries none, which is
 * why `useAPISubmit` reports its own `throttled` message for one rather than reading the body.
 */
export function detailOf(body: unknown): string | undefined {
  const messages = (errorsOf(body) ?? []).map(({ message }) => message)
  return messages.length > 0 ? messages.join(' ') : undefined
}

/** For `useAPISubmit`, `useValidatedFormState` and `createSubmitHooks` on an allauth endpoint. */
export const allauthEnvelope = { toFormErrors, detailOf }

/** A flow allauth lists in a 401: what the session still owes, or may start. */
export type AllauthFlow = { id: string; is_pending?: boolean; types?: string[]; provider?: unknown }

function flowsOf(body: unknown): AllauthFlow[] {
  const flows = (body as { data?: { flows?: unknown } } | null | undefined)?.data?.flows
  // Both are equivalent mutants. Flows are only ever matched by their string `id`, so neither an
  // extra entry in the fallback list nor a string let through the filter can ever match one.
  // Stryker disable next-line ArrayDeclaration
  if (!Array.isArray(flows)) return []
  // Stryker disable next-line ConditionalExpression
  return flows.filter((flow): flow is AllauthFlow => flow !== null && typeof flow === 'object')
}

/**
 * The flow named `id` that allauth's 401 says is still owed, or `undefined`. allauth answers a request it
 * cannot finish yet - an unverified email, a second factor - with a 401 naming the flow, which is a
 * step to take, not a refusal.
 */
export function pendingFlow(body: unknown, id: string): AllauthFlow | undefined {
  return flowsOf(body).find((flow) => flow.id === id && flow.is_pending === true)
}

/** A login, or a signup, owes an email verification: allauth has mailed a fresh link. */
export function hasPendingVerifyEmail(body: unknown): boolean {
  return pendingFlow(body, 'verify_email') !== undefined
}

/** The factors a login still owes after the password, or `null` when no second factor is pending. */
export function pendingMfaTypes(body: unknown): string[] | null {
  const flow = pendingFlow(body, 'mfa_authenticate')
  return flow ? (flow.types ?? []) : null
}

/** The action needs the person to prove who they are again - by password or by a second factor. */
export function needsReauthentication(body: unknown): boolean {
  return flowsOf(body).some((flow) => flow.id === 'reauthenticate' || flow.id === 'mfa_reauthenticate')
}
