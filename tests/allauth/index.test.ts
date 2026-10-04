import { describe, expect, it } from 'vitest'

import { allauthEnvelope, detailOf, toFormErrors } from '../../src/allauth'

const refusal = (...errors: unknown[]) => ({ status: 400, errors })

describe('toFormErrors', () => {
  it('files each message under its param', () => {
    expect(
      toFormErrors(
        refusal(
          { message: 'That email is taken.', code: 'email_taken', param: 'email' },
          { message: 'Too short.', code: 'password_too_short', param: 'password' },
          { message: 'Too common.', code: 'password_too_common', param: 'password' }
        )
      )
    ).toEqual({ email: ['That email is taken.'], password: ['Too short.', 'Too common.'] })
  })

  it('files an error with no param under non_field_errors', () => {
    expect(toFormErrors(refusal({ message: 'Incorrect code.', code: 'incorrect_code' }))).toEqual({
      non_field_errors: ['Incorrect code.'],
    })
  })

  it('treats a param that is not a string as no param', () => {
    expect(toFormErrors(refusal({ message: 'Nope.', param: 3 }))).toEqual({ non_field_errors: ['Nope.'] })
  })

  it('keeps a param named __proto__ as a field', () => {
    const errors = toFormErrors(refusal({ message: 'Odd.', param: '__proto__' }))
    expect(Object.keys(errors!)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(errors)).toBe(Object.prototype)
  })

  it('skips entries with no string message', () => {
    expect(
      toFormErrors(refusal(null, 'Nope.', { code: 'x', param: 'email' }, { message: 3 }, { message: 'Kept.' }))
    ).toEqual({ non_field_errors: ['Kept.'] })
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty body', {}],
    ['an errors list with nothing readable', refusal({ code: 'x' })],
    ['an empty errors list', refusal()],
    ['errors that are not a list', { errors: { message: 'Nope.' } }],
    ["DRF's field shape", { email: ['Taken.'] }],
    ["allauth's pending-flow 401", { status: 401, data: { flows: [] }, meta: { is_authenticated: false } }],
  ])('reads %s as no errors', (_, body) => {
    expect(toFormErrors(body)).toBeUndefined()
  })
})

describe('detailOf', () => {
  it('joins every message into one line', () => {
    expect(
      detailOf({
        status: 429,
        errors: [{ message: 'Too many requests.' }, { message: 'Try later.', param: 'email' }],
      })
    ).toBe('Too many requests. Try later.')
  })

  it.each([
    ['nothing', undefined],
    ['an empty body', {}],
    ['an empty errors list', refusal()],
    ['entries with no message', refusal({ code: 'x' })],
  ])('reads %s as no sentence', (_, body) => {
    expect(detailOf(body)).toBeUndefined()
  })
})

describe('allauthEnvelope', () => {
  it('is the two readers', () => {
    expect(allauthEnvelope).toEqual({ toFormErrors, detailOf })
  })
})
