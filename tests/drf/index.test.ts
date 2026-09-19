import { describe, expect, it } from 'vitest'

import { detailOf, messagesOf, toFormErrors } from '../../src/drf'

describe('toFormErrors', () => {
  it('reads the shape a DRF 400 actually sends', () => {
    expect(toFormErrors({ name: ['This field may not be blank.'] })).toEqual({
      name: ['This field may not be blank.'],
    })
  })

  it('keeps non_field_errors, which is about the form rather than a field', () => {
    expect(toFormErrors({ non_field_errors: ['Those two do not go together.'] })).toEqual({
      non_field_errors: ['Those two do not go together.'],
    })
  })

  // A ValidationError raised with a plain string per key rather than a list, which DRF permits.
  it('accepts a bare string for a field as well as a list', () => {
    expect(toFormErrors({ scopes: 'Not approved.' })).toEqual({ scopes: ['Not approved.'] })
  })

  // `detail` is the other shape entirely - a refusal about the request, not about a field.
  it('ignores detail, which belongs to detailOf', () => {
    expect(toFormErrors({ detail: 'Not found.' })).toBeUndefined()
  })

  it('keeps the fields when detail arrives alongside them', () => {
    expect(toFormErrors({ detail: 'Invalid input.', name: ['Taken.'] })).toEqual({ name: ['Taken.'] })
  })

  it('returns nothing for the shapes that carry no field errors', () => {
    expect(toFormErrors(undefined)).toBeUndefined()
    expect(toFormErrors(null)).toBeUndefined()
    expect(toFormErrors('a string')).toBeUndefined()
    expect(toFormErrors(['a list'])).toBeUndefined()
    expect(toFormErrors({})).toBeUndefined()
  })

  it('skips a value that is neither a string nor a list of them, rather than rendering an object', () => {
    expect(toFormErrors({ settings: { idp: ['bad'] }, name: ['ok'] })).toEqual({ name: ['ok'] })
    expect(toFormErrors({ count: [1, 2] })).toBeUndefined()
  })

  // Every entry, not some: a list carrying one string among other things is not a list of messages,
  // and rendering the rest of it would put `[object Object]` under an input.
  it('skips a list that is only partly strings', () => {
    expect(toFormErrors({ mixed: ['a real message', 5] })).toBeUndefined()
    expect(toFormErrors({ mixed: [5, 'a real message'] })).toBeUndefined()
  })

  it('keeps an empty list, since it is vacuously a list of messages', () => {
    expect(toFormErrors({ name: [] })).toEqual({ name: [] })
  })
})

describe('detailOf', () => {
  it('reads the sentence DRF wrote for a refusal that is not about a field', () => {
    expect(detailOf({ detail: 'You do not have permission to perform this action.' })).toBe(
      'You do not have permission to perform this action.'
    )
  })

  it('returns nothing when there is no sentence to read', () => {
    expect(detailOf({ name: ['nope'] })).toBeUndefined()
    expect(detailOf({ detail: { nested: true } })).toBeUndefined()
    expect(detailOf(undefined)).toBeUndefined()
    expect(detailOf(null)).toBeUndefined()
    expect(detailOf('a string')).toBeUndefined()
  })

  it('does not throw on the falsy primitives', () => {
    expect(detailOf(0)).toBeUndefined()
    expect(detailOf('')).toBeUndefined()
    expect(detailOf(false)).toBeUndefined()
  })
})

describe('messagesOf', () => {
  // A button or a switch gets the same 400 body a form does, and has nowhere to put it per field.
  it('carries every field message, not only the non-field ones', () => {
    expect(messagesOf({ non_field_errors: ['Those clash.'], value: ['Not a valid choice.'] })).toBe(
      'Those clash. Not a valid choice.'
    )
  })

  it('reads as a sentence when only one field failed', () => {
    expect(messagesOf({ scopes: ['Not approved.'] })).toBe('Not approved.')
  })

  it('puts what is wrong with the request as a whole before the fields', () => {
    expect(messagesOf({ name: ['Taken.'], non_field_errors: ['Pick one or the other.'] })).toBe(
      'Pick one or the other. Taken.'
    )
  })

  it('joins every message of a field, not only the first', () => {
    expect(messagesOf({ name: ['Too short.', 'Taken.'] })).toBe('Too short. Taken.')
  })

  it('leaves the field names out', () => {
    expect(messagesOf({ first_name: ['Required.'] })).not.toContain('first_name')
  })

  it('returns nothing when there is nothing to say', () => {
    expect(messagesOf(undefined)).toBeUndefined()
    expect(messagesOf({})).toBeUndefined()
    expect(messagesOf({ non_field_errors: [], name: [] })).toBeUndefined()
  })
})
