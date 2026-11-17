export type FormErrors = Record<string, string[]> & { non_field_errors?: string[] }

/** The machine-readable code of each message, keyed as `FormErrors` is. */
export type FormErrorCodes = Record<string, string[]> & { non_field_errors?: string[] }

/** One message as DRF's `get_full_details()` writes it. */
type Detail = { message: string; code?: string }

/**
 * DRF refuses in two shapes, and which one arrives is decided by the status.
 *
 * A 400 is a validation failure and carries the fields: `{name: ["This field may not be blank."]}`,
 * with `non_field_errors` for anything about the form as a whole. Everything else - 401, 403, 404,
 * 409 - carries `{detail: "one sentence"}`, written for a person by whoever raised it.
 *
 * Either message may also arrive as `{message, code}`, DRF's `get_full_details()`, which isik
 * renders for a 400: `{name: [{message: "This field may not be blank.", code: "blank"}]}`.
 *
 * This reads the first shape; `detailOf` reads the second.
 */
export function toFormErrors(body: unknown): FormErrors | undefined {
  return collect(body, (detail) => detail.message)
}

/**
 * The codes of a 400's messages, keyed as `toFormErrors` keys them: `{kinds.0.kind: ["kind_not_sent_on_webhook"]}`.
 * A page branches on these rather than on the message, which is translated. A message sent as a bare
 * string has no code, so a field whose messages all are has no entry. `undefined` when no message
 * carries one.
 */
export function codesOf(body: unknown): FormErrorCodes | undefined {
  return collect(body, (detail) => detail.code)
}

function collect(body: unknown, pick: (detail: Detail) => string | undefined): FormErrors | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined

  // The one-sentence shape, where a string `code` names the same refusal for a machine and is no more
  // a field than `detail` is. Gated on `detail` rather than skipped outright, so a serializer's own
  // `code` field - an invitation code, an MFA code - still reports on a 400, which has no `detail`.
  const { detail, code } = body as { detail?: unknown; code?: unknown }
  const isTheSentenceShape = typeof detail === 'string' && typeof code === 'string'

  const found = new Map<string, Detail[]>()
  for (const [field, value] of Object.entries(body as Record<string, unknown>)) {
    // `detail` is the other shape, not a field. A serializer with a field genuinely called `detail`
    // would lose it here - that is the price of keeping the two shapes apart.
    if (field === 'detail') continue
    if (field === 'code' && isTheSentenceShape) continue
    flattenInto(found, field, value)
  }
  const errors = new Map<string, string[]>()
  for (const [key, details] of found) {
    const picked = details.map(pick).filter((value): value is string => value !== undefined)
    // A field's empty list is kept as it came; a field with messages but no codes is left out.
    if (picked.length > 0 || details.length === 0) errors.set(key, picked)
  }
  // Built through entries so a field named `__proto__` is a field.
  return errors.size > 0 ? Object.fromEntries(errors) : undefined
}

/**
 * A message: a string, or DRF's full detail. The detail is recognised by its exact keys, `message`
 * and `code`, both strings - allauth's entries carry a `param` as well and stay another envelope.
 */
function detailFrom(value: unknown): Detail | undefined {
  if (typeof value === 'string') return { message: value }
  // `!value` is the whole guard: a number or a list has no string `message`, so the check below
  // refuses it as it does any other object that isn't a detail.
  if (!value) return undefined
  const { message, code, ...rest } = value as { message?: unknown; code?: unknown }
  if (typeof message !== 'string' || typeof code !== 'string' || Object.keys(rest).length > 0) return undefined
  return { message, code }
}

/**
 * A nested serializer refuses with an object, `{address: {city: [...]}}`, and a `many=True` one with
 * a list of them, `{items: [{}, {qty: [...]}]}` - one entry per item, `{}` for the ones that passed.
 * Both flatten to dotted keys, `address.city` and `items.1.qty`, so the message survives as a flat
 * field error.
 *
 * Below the top level only a list of messages counts. That is all a serializer nests, and a bare
 * message there is what another server's envelope looks like: allauth's `{errors: [{message, code,
 * param}]}` would otherwise read as three fields, one of them saying `email_taken`. A list that is
 * not all messages is read by index like an object, and anything that is not a message - a number,
 * `null` - is skipped rather than rendered.
 */
function flattenInto(found: Map<string, Detail[]>, key: string, value: unknown, nested = false): void {
  const single = detailFrom(value)
  const list = Array.isArray(value) ? value.map(detailFrom) : undefined
  if (single) {
    if (!nested) found.set(key, [single])
  } else if (list?.every((entry) => entry !== undefined)) {
    found.set(key, list as Detail[])
  } else if (value != null) {
    // An object, or a list of them read as one keyed by index. A number or a boolean has no entries,
    // so it contributes nothing without a check of its own.
    for (const [field, inner] of Object.entries(value)) flattenInto(found, `${key}.${field}`, inner, true)
  }
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
