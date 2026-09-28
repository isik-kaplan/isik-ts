export type FormErrors = Record<string, string[]> & { non_field_errors?: string[] }

/**
 * DRF refuses in two shapes, and which one arrives is decided by the status.
 *
 * A 400 is a validation failure and carries the fields: `{name: ["This field may not be blank."]}`,
 * with `non_field_errors` for anything about the form as a whole. Everything else - 401, 403, 404,
 * 409 - carries `{detail: "one sentence"}`, written for a person by whoever raised it.
 *
 * This reads the first shape; `detailOf` reads the second.
 */
export function toFormErrors(body: unknown): FormErrors | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined

  // The one-sentence shape, where a string `code` names the same refusal for a machine and is no more
  // a field than `detail` is. Gated on `detail` rather than skipped outright, so a serializer's own
  // `code` field - an invitation code, an MFA code - still reports on a 400, which has no `detail`.
  const { detail, code } = body as { detail?: unknown; code?: unknown }
  const isTheSentenceShape = typeof detail === 'string' && typeof code === 'string'

  const errors: FormErrors = {}
  for (const [field, value] of Object.entries(body as Record<string, unknown>)) {
    // `detail` is the other shape, not a field. A serializer with a field genuinely called `detail`
    // would lose it here - that is the price of keeping the two shapes apart.
    if (field === 'detail') continue
    if (field === 'code' && isTheSentenceShape) continue
    if (typeof value === 'string') errors[field] = [value]
    else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) errors[field] = value
  }
  return Object.keys(errors).length > 0 ? errors : undefined
}

/** The sentence DRF wrote for a refusal that is not about a field. */
export function detailOf(body: unknown): string | undefined {
  // `!body` is the whole guard: reading a property off a primitive is legal, and the two values that
  // would throw are the two this catches.
  if (!body) return undefined
  const detail = (body as { detail?: unknown }).detail
  return typeof detail === 'string' ? detail : undefined
}

/**
 * Every message in a refusal, as one line, for a caller with nowhere to put them per field.
 *
 * A button or a switch gets the same 400 body a form does. Keeping only `non_field_errors` there
 * would lose the only thing the server said.
 *
 * The field names are left out: they are the serializer's `snake_case`, and DRF's messages read as
 * whole sentences without them.
 */
export function messagesOf(errors: FormErrors | undefined): string | undefined {
  if (!errors) return undefined
  const { non_field_errors: nonField = [], ...fields } = errors
  const messages = [...nonField, ...Object.values(fields).flat()]
  return messages.length > 0 ? messages.join(' ') : undefined
}
