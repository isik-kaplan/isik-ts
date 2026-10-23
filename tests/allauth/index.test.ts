import { describe, expect, it } from 'vitest'

import {
  allauthEnvelope,
  detailOf,
  errorsOf,
  hasPendingVerifyEmail,
  needsReauthentication,
  pendingFlow,
  pendingMfaTypes,
  toFormErrors,
} from '../../src/allauth'

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
        status: 409,
        errors: [{ message: 'Already logged in.' }, { message: 'Log out first.', param: 'email' }],
      })
    ).toBe('Already logged in. Log out first.')
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

describe('errorsOf', () => {
  it('answers the entries with a string message', () => {
    expect(
      errorsOf(refusal({ message: 'Taken.', code: 'email_taken', param: 'email' }, { code: 'no_message' }, null))
    ).toEqual([{ message: 'Taken.', code: 'email_taken', param: 'email' }])
  })

  it('answers an empty list when no entry has a message', () => {
    expect(errorsOf(refusal({ code: 'x' }))).toEqual([])
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a body with no errors', { status: 401, data: {} }],
    ['errors that are not a list', { errors: 'nope' }],
  ])('answers undefined for %s', (_, body) => {
    expect(errorsOf(body)).toBeUndefined()
  })
})

describe('flow readers', () => {
  const pending = (...flows: unknown[]) => ({ status: 401, data: { flows }, meta: { is_authenticated: false } })

  it('finds a pending flow by id, and only a pending one', () => {
    const body = pending({ id: 'login' }, { id: 'verify_email', is_pending: true }, { id: 'mfa_authenticate' })
    expect(pendingFlow(body, 'verify_email')).toEqual({ id: 'verify_email', is_pending: true })
    expect(pendingFlow(body, 'mfa_authenticate')).toBeUndefined()
    expect(pendingFlow(body, 'login')).toBeUndefined()
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['no data', { status: 401 }],
    ['flows that are not a list', { data: { flows: {} } }],
    ['entries with no string id', { data: { flows: [null, { id: 3, is_pending: true }] } }],
  ])('finds nothing in %s', (_, body) => {
    expect(pendingFlow(body, '3')).toBeUndefined()
    expect(hasPendingVerifyEmail(body)).toBe(false)
    expect(pendingMfaTypes(body)).toBeNull()
    expect(needsReauthentication(body)).toBe(false)
  })

  it('reads a pending email verification', () => {
    expect(hasPendingVerifyEmail(pending({ id: 'verify_email', is_pending: true }))).toBe(true)
    expect(hasPendingVerifyEmail(pending({ id: 'verify_email' }))).toBe(false)
  })

  it('reads the second factors a login still owes', () => {
    expect(pendingMfaTypes(pending({ id: 'mfa_authenticate', is_pending: true, types: ['totp', 'webauthn'] }))).toEqual(
      ['totp', 'webauthn']
    )
    expect(pendingMfaTypes(pending({ id: 'mfa_authenticate', is_pending: true }))).toEqual([])
  })

  it.each(['reauthenticate', 'mfa_reauthenticate'])('reads a %s flow as needing reauthentication', (id) => {
    expect(needsReauthentication(pending({ id }))).toBe(true)
  })

  it('does not read another flow as reauthentication', () => {
    expect(needsReauthentication(pending({ id: 'login' }))).toBe(false)
  })
})
