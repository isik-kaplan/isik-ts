import { act, renderHook } from '@testing-library/react'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { allauthEnvelope } from '../../src/allauth'
import type { APIResult, Reporter, StandardSchemaV1 } from '../../src/hooks'
import { createSubmitHooks, useAPISubmit, useValidatedFormState } from '../../src/hooks'

function reporter() {
  return { success: vi.fn(), error: vi.fn() } satisfies Reporter
}

// Only what the hook reads off a Response. A real one would work as well; this keeps `ok` and
// `status` from disagreeing by accident.
function response(status: number, headers?: HeadersInit) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers) } as Response
}

function refusal(status: number, error: unknown): APIResult {
  return { error, response: response(status) }
}

async function submitWith(result: APIResult, options: Parameters<ReturnType<typeof useAPISubmit>['submit']>[1]) {
  const report = reporter()
  const { result: hook } = renderHook(() => useAPISubmit(report))
  let ok: boolean | undefined
  await act(async () => {
    ok = await hook.current.submit(async () => result, options)
  })
  return { ok, report }
}

describe('useAPISubmit', () => {
  describe('success', () => {
    it('counts a result with no error and an ok response as success', async () => {
      const onSuccess = vi.fn()
      const result = { data: { id: 1 }, response: response(200) }
      const { ok, report } = await submitWith(result, { failure: 'Could not save.', onSuccess })
      expect(ok).toBe(true)
      expect(onSuccess).toHaveBeenCalledWith(result, { replayed: false })
      expect(report.success).not.toHaveBeenCalled()
      expect(report.error).not.toHaveBeenCalled()
    })

    // A 204 has no body, so a missing `data` must not read as a failure.
    it('counts an ok response with no data as success', async () => {
      const { ok } = await submitWith({ response: response(204) }, { failure: 'Could not save.' })
      expect(ok).toBe(true)
    })

    it('counts a result with no response and no error as success', async () => {
      const { ok } = await submitWith({}, { failure: 'Could not save.' })
      expect(ok).toBe(true)
    })

    it('reports the success message only when one is given', async () => {
      const { report } = await submitWith({ response: response(200) }, { failure: 'Nope.', success: 'Saved.' })
      expect(report.success).toHaveBeenCalledExactlyOnceWith('Saved.')
    })

    it('lets the caller say what success is, for an endpoint that answers with a non-2xx', async () => {
      const onSuccess = vi.fn()
      const result = refusal(409, { detail: 'Already logged in.' })
      const { ok, report } = await submitWith(result, {
        failure: 'Nope.',
        isSuccess: (r) => r.response?.status === 409,
        onSuccess,
      })
      expect(ok).toBe(true)
      expect(onSuccess).toHaveBeenCalledWith(result, { replayed: false })
      expect(report.error).not.toHaveBeenCalled()
    })

    it('lets the caller refuse a result the default would accept', async () => {
      const { ok, report } = await submitWith({ response: response(200) }, { failure: 'Nope.', isSuccess: () => false })
      expect(ok).toBe(false)
      expect(report.error).toHaveBeenCalledWith('Nope.')
    })
  })

  describe('replay', () => {
    async function outcomeOf(result: APIResult) {
      const onSuccess = vi.fn()
      await submitWith(result, { failure: 'Nope.', onSuccess })
      return onSuccess.mock.calls[0][1]
    }

    // The server answered from an earlier attempt, so the work is already done rather than just done.
    it('tells onSuccess the server replayed an earlier attempt', async () => {
      expect(await outcomeOf({ response: response(201, { 'Idempotent-Replayed': 'true' }) })).toEqual({
        replayed: true,
      })
    })

    it('reads a response without the header as done now', async () => {
      expect(await outcomeOf({ response: response(201) })).toEqual({ replayed: false })
    })

    it('reads only "true" as a replay', async () => {
      expect(await outcomeOf({ response: response(201, { 'Idempotent-Replayed': 'false' }) })).toEqual({
        replayed: false,
      })
    })

    it('reads a result with no response as done now', async () => {
      expect(await outcomeOf({})).toEqual({ replayed: false })
    })
  })

  describe('failure', () => {
    it('fails on an error even when the response says ok', async () => {
      const onSuccess = vi.fn()
      const { ok, report } = await submitWith(refusal(200, { detail: 'Odd.' }), { failure: 'Nope.', onSuccess })
      expect(ok).toBe(false)
      expect(onSuccess).not.toHaveBeenCalled()
      expect(report.error).toHaveBeenCalledWith('Odd.')
    })

    it('fails on a response that is not ok even without an error body', async () => {
      const { ok, report } = await submitWith({ response: response(502) }, { failure: 'Nope.' })
      expect(ok).toBe(false)
      expect(report.error).toHaveBeenCalledWith('Nope.')
    })

    it("puts a 400's fields into the form and reports nothing", async () => {
      const setFormErrors = vi.fn()
      const { ok, report } = await submitWith(refusal(400, { name: ['Taken.'] }), { failure: 'Nope.', setFormErrors })
      expect(ok).toBe(false)
      expect(setFormErrors).toHaveBeenCalledExactlyOnceWith({ name: ['Taken.'] })
      expect(report.error).not.toHaveBeenCalled()
    })

    it('reports every message of a 400 as one line when there is no form to put them in', async () => {
      const { report } = await submitWith(refusal(400, { non_field_errors: ['Clash.'], name: ['Taken.'] }), {
        failure: 'Nope.',
      })
      expect(report.error).toHaveBeenCalledExactlyOnceWith('Clash. Taken.')
    })

    it('reports a 400 with no fields in it rather than handing the form nothing', async () => {
      const setFormErrors = vi.fn()
      const { report } = await submitWith(refusal(400, { detail: 'Malformed.' }), { failure: 'Nope.', setFormErrors })
      expect(setFormErrors).not.toHaveBeenCalled()
      expect(report.error).toHaveBeenCalledWith('Malformed.')
    })

    // A ParseError is a 400 in the sentence shape, and its code is not a field for the form to hold.
    it('reports the sentence of a 400 that carries its code beside it', async () => {
      const setFormErrors = vi.fn()
      const body = { detail: 'Malformed request.', code: 'parse_error' }
      const { report } = await submitWith(refusal(400, body), { failure: 'Nope.', setFormErrors })
      expect(setFormErrors).not.toHaveBeenCalled()
      expect(report.error).toHaveBeenCalledExactlyOnceWith('Malformed request.')
    })

    it('reports the sentence DRF wrote for a refusal that is not about a field', async () => {
      const { report } = await submitWith(refusal(403, { detail: 'Not yours.' }), { failure: 'Nope.' })
      expect(report.error).toHaveBeenCalledWith('Not yours.')
    })

    // Only a 400 is a validation failure. A field-shaped body on anything else is not read as one.
    it('does not read fields off a refusal that is not a 400', async () => {
      const setFormErrors = vi.fn()
      const { report } = await submitWith(refusal(409, { name: ['Taken.'] }), { failure: 'Nope.', setFormErrors })
      expect(setFormErrors).not.toHaveBeenCalled()
      expect(report.error).toHaveBeenCalledWith('Nope.')
    })

    it('shows the last 4xx in its own words', async () => {
      const { report } = await submitWith(refusal(499, { detail: 'Closed.' }), { failure: 'Nope.' })
      expect(report.error).toHaveBeenCalledWith('Closed.')
    })

    it('does not show a 5xx in its own words, from the first one on', async () => {
      const { report } = await submitWith(refusal(500, { detail: 'Traceback...' }), { failure: 'Nope.' })
      expect(report.error).toHaveBeenCalledWith('Nope.')
    })

    it('does not show a detail when the server was never reached', async () => {
      const { report } = await submitWith({ error: { detail: 'Failed to fetch' } }, { failure: 'Nope.' })
      expect(report.error).toHaveBeenCalledWith('Nope.')
    })

    it('falls back to the failure message for a body it cannot read', async () => {
      const { report } = await submitWith(refusal(400, '<html>Bad Request</html>'), { failure: 'Nope.' })
      expect(report.error).toHaveBeenCalledWith('Nope.')
    })
  })

  describe('isSubmitting', () => {
    it('is true while the call is pending and false once it settles', async () => {
      const { result } = renderHook(() => useAPISubmit(reporter()))
      expect(result.current.isSubmitting).toBe(false)

      let finish!: (value: APIResult) => void
      let submitted!: Promise<boolean>
      act(() => {
        submitted = result.current.submit(() => new Promise<APIResult>((resolve) => (finish = resolve)), {
          failure: 'Nope.',
        })
      })
      expect(result.current.isSubmitting).toBe(true)

      await act(async () => {
        finish({})
        await submitted
      })
      expect(result.current.isSubmitting).toBe(false)
    })

    it('is released when the call throws, and the throw reaches the caller', async () => {
      const report = reporter()
      const { result } = renderHook(() => useAPISubmit(report))
      await act(async () => {
        await expect(
          result.current.submit(
            async () => {
              throw new Error('offline')
            },
            { failure: 'Nope.' }
          )
        ).rejects.toThrow('offline')
      })
      expect(result.current.isSubmitting).toBe(false)
      expect(report.error).not.toHaveBeenCalled()
    })
  })

  describe('in-flight guard', () => {
    function pending() {
      let finish!: (value: APIResult) => void
      const call = vi.fn(() => new Promise<APIResult>((resolve) => (finish = resolve)))
      return { call, finish: (value: APIResult) => finish(value) }
    }

    it('refuses a second submit while the first is in flight, without making its call', async () => {
      const { result } = renderHook(() => useAPISubmit(reporter()))
      const first = pending()
      const second = vi.fn(async () => ({}))
      let firstSubmitted!: Promise<boolean>
      let secondSubmitted!: Promise<boolean>
      // Both in one act, so React has not committed between them - two clicks in one frame.
      act(() => {
        firstSubmitted = result.current.submit(first.call, { failure: 'Nope.' })
        secondSubmitted = result.current.submit(second, { failure: 'Nope.' })
      })
      expect(await secondSubmitted).toBe(false)
      expect(second).not.toHaveBeenCalled()

      await act(async () => {
        first.finish({})
        expect(await firstSubmitted).toBe(true)
      })
    })

    it.each([
      ['a success', {}],
      ['a refusal', refusal(500, {})],
    ])('accepts another submit after %s', async (_, outcome) => {
      const { result } = renderHook(() => useAPISubmit(reporter()))
      const next = vi.fn(async () => ({}))
      await act(async () => {
        await result.current.submit(async () => outcome, { failure: 'Nope.' })
      })
      await act(async () => {
        expect(await result.current.submit(next, { failure: 'Nope.' })).toBe(true)
      })
      expect(next).toHaveBeenCalledOnce()
    })

    it('accepts another submit after a throw', async () => {
      const { result } = renderHook(() => useAPISubmit(reporter()))
      await act(async () => {
        await expect(
          result.current.submit(
            async () => {
              throw new Error('offline')
            },
            { failure: 'Nope.' }
          )
        ).rejects.toThrow('offline')
      })
      const next = vi.fn(async () => ({}))
      await act(async () => {
        expect(await result.current.submit(next, { failure: 'Nope.' })).toBe(true)
      })
    })
  })

  describe('leavesOnSuccess', () => {
    it('keeps isSubmitting set after a success, and refuses every submit after it', async () => {
      const onSuccess = vi.fn()
      const { result } = renderHook(() => useAPISubmit(reporter()))
      await act(async () => {
        expect(
          await result.current.submit(async () => ({}), { failure: 'Nope.', onSuccess, leavesOnSuccess: true })
        ).toBe(true)
      })
      expect(onSuccess).toHaveBeenCalledOnce()
      expect(result.current.isSubmitting).toBe(true)

      const again = vi.fn(async () => ({}))
      await act(async () => {
        expect(await result.current.submit(again, { failure: 'Nope.' })).toBe(false)
      })
      expect(again).not.toHaveBeenCalled()
    })

    it('releases on a refusal, since the screen stays', async () => {
      const report = reporter()
      const { result } = renderHook(() => useAPISubmit(report))
      await act(async () => {
        await result.current.submit(async () => refusal(500, {}), { failure: 'Nope.', leavesOnSuccess: true })
      })
      expect(result.current.isSubmitting).toBe(false)
      expect(report.error).toHaveBeenCalledExactlyOnceWith('Nope.')
    })

    it('releases on a throw', async () => {
      const { result } = renderHook(() => useAPISubmit(reporter()))
      await act(async () => {
        await expect(
          result.current.submit(
            async () => {
              throw new Error('offline')
            },
            { failure: 'Nope.', leavesOnSuccess: true }
          )
        ).rejects.toThrow('offline')
      })
      expect(result.current.isSubmitting).toBe(false)
    })

    it('is honored by useValidatedFormState', async () => {
      const { result } = renderForm()
      await act(async () => {
        await result.current.submit(async () => ({}), { failure: 'Nope.', leavesOnSuccess: true })
      })
      expect(result.current.isSubmitting).toBe(true)
    })
  })
})

const schema = z
  .object({
    name: z.string().trim().min(1, 'Required.').max(5, 'Too long.'),
    password: z.string(),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, 'Passwords differ.')

const valid = { name: '  Ada ', password: 'x', confirm: 'x' }

function renderForm(initial = valid, report = reporter()) {
  const { result } = renderHook(() => useValidatedFormState(schema, initial, report))
  return { result, report }
}

// A schema written against the interface alone, for shapes zod never produces.
function standard(
  validate: StandardSchemaV1<{ name: string }>['~standard']['validate']
): StandardSchemaV1<{ name: string }> {
  return { '~standard': { version: 1, vendor: 'test', validate } }
}

describe('useValidatedFormState', () => {
  describe('validate', () => {
    function validateNow(hook: { current: { validate: () => boolean } }) {
      let ok: boolean | undefined
      act(() => {
        ok = hook.current.validate()
      })
      return ok
    }

    // A boolean and not a Promise: `!promise` is always false, so `if (!validate()) return` would let
    // every invalid form through, and TypeScript does not flag the negated check.
    it('answers synchronously, so a negated check refuses an invalid form', () => {
      const { result } = renderForm({ ...valid, name: '' })
      let refused = false
      act(() => {
        if (!result.current.validate()) refused = true
      })
      expect(refused).toBe(true)
    })

    it('accepts valid state and clears errors left from before', () => {
      const { result } = renderForm()
      act(() => result.current.setFormErrors({ name: ['Stale.'] }))
      expect(validateNow(result)).toBe(true)
      expect(result.current.formErrors).toBeUndefined()
    })

    it('files each issue under its field and a form-wide one under non_field_errors', () => {
      const { result } = renderForm({ name: '', password: 'a', confirm: 'b' })
      expect(validateNow(result)).toBe(false)
      expect(result.current.formErrors).toEqual({ name: ['Required.'], non_field_errors: ['Passwords differ.'] })
    })

    it('keeps every message for a field, in order', () => {
      const both = standard(() => ({
        issues: [
          { message: 'First.', path: ['name'] },
          { message: 'Second.', path: [{ key: 'name' }] },
          { message: 'Whole form.' },
        ],
      }))
      const { result } = renderHook(() => useValidatedFormState(both, { name: '' }, reporter()))
      validateNow(result)
      expect(result.current.formErrors).toEqual({ name: ['First.', 'Second.'], non_field_errors: ['Whole form.'] })
    })

    // A nested issue belongs to the input that holds the nested value.
    it('files a nested issue under the top-level field it starts at', () => {
      const nested = standard(() => ({ issues: [{ message: 'Bad street.', path: ['name', 'street'] }] }))
      const { result } = renderHook(() => useValidatedFormState(nested, { name: '' }, reporter()))
      validateNow(result)
      expect(result.current.formErrors).toEqual({ name: ['Bad street.'] })
    })

    it('reads a field named __proto__ as a field', () => {
      const proto = standard(() => ({ issues: [{ message: 'Odd name.', path: ['__proto__'] }] }))
      const { result } = renderHook(() => useValidatedFormState(proto, { name: '' }, reporter()))
      validateNow(result)
      expect(Object.keys(result.current.formErrors ?? {})).toEqual(['__proto__'])
      expect(Object.getPrototypeOf(result.current.formErrors)).toBe(Object.prototype)
    })

    it('refuses an async schema loudly rather than returning a Promise that reads as valid', () => {
      const slow = standard(async () => ({ issues: [{ message: 'Taken.', path: ['name'] }] }))
      const { result } = renderHook(() => useValidatedFormState(slow, { name: 'ada' }, reporter()))
      expect(() => result.current.validate()).toThrow(
        new TypeError('useValidatedFormState: validate() needs a synchronous schema - submit() awaits an async one')
      )
      expect(result.current.formErrors).toBeUndefined()
    })

    // A Promise from another realm fails `instanceof Promise`; anything with a `then` is awaited-shaped.
    it('refuses any thenable, not only a native Promise', () => {
      const thenable = standard(
        () =>
          ({ then: (resolve: (r: { value: { name: string } }) => void) => resolve({ value: { name: '' } }) }) as never
      )
      const { result } = renderHook(() => useValidatedFormState(thenable, { name: '' }, reporter()))
      expect(() => result.current.validate()).toThrow(TypeError)
    })

    it('validates the state as it is now, not as it started', () => {
      const { result } = renderForm({ ...valid, name: '' })
      act(() => result.current.handleFormStateValue('name')('Grace'))
      expect(validateNow(result)).toBe(true)
    })
  })

  describe('submit', () => {
    it('never makes the call when the schema refuses', async () => {
      const call = vi.fn()
      const { result } = renderForm({ ...valid, name: '' })
      let ok: boolean | undefined
      await act(async () => {
        ok = await result.current.submit(call, { failure: 'Nope.' })
      })
      expect(ok).toBe(false)
      expect(call).not.toHaveBeenCalled()
      expect(result.current.formErrors).toEqual({ name: ['Required.'] })
    })

    it("hands the call the schema's output, so a transform is not lost", async () => {
      const call = vi.fn(async () => ({ response: response(200) }))
      const onSuccess = vi.fn()
      const { result } = renderForm()
      let ok: boolean | undefined
      await act(async () => {
        ok = await result.current.submit(call, { failure: 'Nope.', onSuccess })
      })
      expect(ok).toBe(true)
      expect(call).toHaveBeenCalledWith({ name: 'Ada', password: 'x', confirm: 'x' }, expect.any(String))
      expect(onSuccess).toHaveBeenCalledOnce()
    })

    it('waits for an async schema before deciding', async () => {
      const call = vi.fn()
      const slow = standard(async () => ({ issues: [{ message: 'Taken.', path: ['name'] }] }))
      const { result } = renderHook(() => useValidatedFormState(slow, { name: 'ada' }, reporter()))
      let ok: boolean | undefined
      await act(async () => {
        ok = await result.current.submit(call, { failure: 'Nope.' })
      })
      expect(ok).toBe(false)
      expect(call).not.toHaveBeenCalled()
      expect(result.current.formErrors).toEqual({ name: ['Taken.'] })
    })

    it("hands the call an async schema's output", async () => {
      const call = vi.fn(async () => ({}))
      const slow = standard(async () => ({ value: { name: 'from schema' } }))
      const { result } = renderHook(() => useValidatedFormState(slow, { name: 'ada' }, reporter()))
      await act(async () => {
        await result.current.submit(call, { failure: 'Nope.' })
      })
      expect(call).toHaveBeenCalledWith({ name: 'from schema' }, expect.any(String))
    })

    it("puts the server's field errors where the schema's would go", async () => {
      const { result } = renderForm()
      await act(async () => {
        await result.current.submit(async () => refusal(400, { name: ['Taken.'] }), { failure: 'Nope.' })
      })
      expect(result.current.formErrors).toEqual({ name: ['Taken.'] })
    })

    it('moves a refused field the form does not hold into non_field_errors, after the form-wide ones', async () => {
      const { result, report } = renderForm()
      await act(async () => {
        await result.current.submit(
          async () => refusal(400, { non_field_errors: ['Clash.'], slug: ['Slug taken.'], name: ['Taken.'] }),
          { failure: 'Nope.' }
        )
      })
      expect(result.current.formErrors).toEqual({ name: ['Taken.'], non_field_errors: ['Clash.', 'Slug taken.'] })
      expect(report.error).not.toHaveBeenCalled()
    })

    it('keeps form-wide server errors as they came', async () => {
      const { result } = renderForm()
      await act(async () => {
        await result.current.submit(async () => refusal(400, { non_field_errors: ['Clash.'] }), { failure: 'Nope.' })
      })
      expect(result.current.formErrors).toEqual({ non_field_errors: ['Clash.'] })
    })

    it('moves a field orphaned alone into non_field_errors', async () => {
      const { result } = renderForm()
      await act(async () => {
        await result.current.submit(async () => refusal(400, { slug: ['Slug taken.'] }), { failure: 'Nope.' })
      })
      expect(result.current.formErrors).toEqual({ non_field_errors: ['Slug taken.'] })
    })

    it("shows a nested serializer's refusal rather than the generic failure", async () => {
      const { result, report } = renderForm()
      await act(async () => {
        await result.current.submit(async () => refusal(400, { address: { city: ['Required.'] } }), {
          failure: 'Nope.',
        })
      })
      expect(result.current.formErrors).toEqual({ non_field_errors: ['Required.'] })
      expect(report.error).not.toHaveBeenCalled()
    })

    // Every object answers to `toString`, but no form holds a field by that name.
    it('does not mistake an inherited property for a field the form holds', async () => {
      const { result } = renderForm()
      await act(async () => {
        await result.current.submit(async () => refusal(400, { toString: ['Odd.'] }), { failure: 'Nope.' })
      })
      expect(result.current.formErrors).toEqual({ non_field_errors: ['Odd.'] })
    })

    it('reports a refusal that is not about the fields', async () => {
      const { result, report } = renderForm()
      await act(async () => {
        await result.current.submit(async () => refusal(403, { detail: 'Not yours.' }), { failure: 'Nope.' })
      })
      expect(report.error).toHaveBeenCalledWith('Not yours.')
      expect(result.current.formErrors).toBeUndefined()
    })

    it('exposes the submitting flag of the call it makes', async () => {
      const { result } = renderForm()
      let finish!: (value: APIResult) => void
      let submitted!: Promise<boolean>
      await act(async () => {
        submitted = result.current.submit(() => new Promise<APIResult>((resolve) => (finish = resolve)), {
          failure: 'Nope.',
        })
      })
      expect(result.current.isSubmitting).toBe(true)
      await act(async () => {
        finish({})
        await submitted
      })
      expect(result.current.isSubmitting).toBe(false)
    })
  })

  describe('idempotency key', () => {
    // Numbered keys, so a test can say which attempt a call belonged to.
    function keyed(initial = valid) {
      let minted = 0
      const report = reporter()
      const { result } = renderHook(() =>
        useValidatedFormState(schema, initial, report, { generateKey: () => `key-${++minted}` })
      )
      return { result, report }
    }

    async function keysSentBy(
      hook: ReturnType<typeof keyed>['result'],
      ...results: Array<APIResult | Error>
    ): Promise<string[]> {
      const keys: string[] = []
      for (const outcome of results) {
        await act(async () => {
          await hook.current
            .submit(
              async (_value, key) => {
                keys.push(key)
                if (outcome instanceof Error) throw outcome
                return outcome
              },
              { failure: 'Nope.' }
            )
            .catch(() => undefined)
        })
      }
      return keys
    }

    // The case a key exists for: the server did the work, the answer never arrived, and the person
    // pressed submit again.
    it('sends the same key again after a call that never answered', async () => {
      const { result } = keyed()
      expect(await keysSentBy(result, new Error('offline'), {})).toEqual(['key-1', 'key-1'])
    })

    it('sends the same key again after a refusal, for the same payload', async () => {
      const { result } = keyed()
      expect(await keysSentBy(result, refusal(409, { detail: 'Busy.' }), {})).toEqual(['key-1', 'key-1'])
    })

    it('starts a new attempt after a success', async () => {
      const { result } = keyed()
      expect(await keysSentBy(result, { response: response(201) }, {})).toEqual(['key-1', 'key-2'])
    })

    it('starts a new attempt when the payload is edited', async () => {
      const { result } = keyed()
      const first = await keysSentBy(result, new Error('offline'))
      act(() => result.current.handleFormStateValue('name')('Grace'))
      expect([...first, ...(await keysSentBy(result, {}))]).toEqual(['key-1', 'key-2'])
    })

    // Keyed on what is sent, so an edit the schema undoes is still the same attempt.
    it("keys on the schema's output, not the state as typed", async () => {
      const { result } = keyed()
      const first = await keysSentBy(result, new Error('offline'))
      act(() => result.current.handleFormStateValue('name')('Ada'))
      expect([...first, ...(await keysSentBy(result, {}))]).toEqual(['key-1', 'key-1'])
    })

    it('mints no key for a payload the schema refuses', async () => {
      const { result } = keyed({ ...valid, name: '' })
      expect(await keysSentBy(result, {})).toEqual([])
      act(() => result.current.handleFormStateValue('name')('Ada'))
      expect(await keysSentBy(result, {})).toEqual(['key-1'])
    })

    it('still hands onSuccess the result and whether it was replayed', async () => {
      const onSuccess = vi.fn()
      const { result } = keyed()
      const replayed = { response: response(201, { 'Idempotent-Replayed': 'true' }) }
      await act(async () => {
        await result.current.submit(async () => replayed, { failure: 'Nope.', onSuccess })
      })
      expect(onSuccess).toHaveBeenCalledExactlyOnceWith(replayed, { replayed: true })
    })

    it('uses crypto.randomUUID when no generator is given', async () => {
      const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('0-0-0-0-0')
      const call = vi.fn(async () => ({}))
      const { result } = renderForm()
      await act(async () => {
        await result.current.submit(call, { failure: 'Nope.' })
      })
      expect(call).toHaveBeenCalledWith(expect.anything(), '0-0-0-0-0')
      uuid.mockRestore()
    })

    describe('idempotencyKey: false', () => {
      afterEach(() => {
        vi.unstubAllGlobals()
      })

      it('mints no key and hands the call none', async () => {
        const generateKey = vi.fn(() => 'key')
        const call = vi.fn(async (_value: unknown) => ({}))
        const { result } = renderHook(() => useValidatedFormState(schema, valid, reporter(), { generateKey }))
        let ok: boolean | undefined
        await act(async () => {
          ok = await result.current.submit(call, { failure: 'Nope.', idempotencyKey: false })
        })
        expect(ok).toBe(true)
        expect(generateKey).not.toHaveBeenCalled()
        expect(call).toHaveBeenCalledExactlyOnceWith({ name: 'Ada', password: 'x', confirm: 'x' }, undefined)
      })

      // The case it exists for: a PATCH that sends no key, on a runtime that could not make one.
      it('needs no generator at all', async () => {
        vi.stubGlobal('crypto', undefined)
        const { result } = renderForm()
        let ok: boolean | undefined
        await act(async () => {
          ok = await result.current.submit(async () => ({}), { failure: 'Nope.', idempotencyKey: false })
        })
        expect(ok).toBe(true)
      })

      it('still sends a key when the option is true', async () => {
        const call = vi.fn(async () => ({}))
        const { result } = renderHook(() =>
          useValidatedFormState(schema, valid, reporter(), { generateKey: () => 'key-1' })
        )
        await act(async () => {
          await result.current.submit(call, { failure: 'Nope.', idempotencyKey: true })
        })
        expect(call).toHaveBeenCalledWith(expect.anything(), 'key-1')
      })

      it('refuses, at compile time, a call that reads a key it will not get', () => {
        const { result } = renderForm()
        const submit = () =>
          // @ts-expect-error - with idempotencyKey: false the call takes the value alone.
          result.current.submit(async (_value, _key: string) => ({}), { failure: 'Nope.', idempotencyKey: false })
        expect(submit).toBeTypeOf('function')
      })
    })
  })
})

describe('createSubmitHooks', () => {
  it('reports through the bound reporter from useAPISubmit', async () => {
    const report = reporter()
    const hooks = createSubmitHooks(report)
    const { result } = renderHook(() => hooks.useAPISubmit())
    await act(async () => {
      await result.current.submit(async () => refusal(500, {}), { failure: 'Could not save.' })
    })
    expect(report.error).toHaveBeenCalledExactlyOnceWith('Could not save.')
  })

  it('reports through the bound reporter from useValidatedFormState', async () => {
    const report = reporter()
    const hooks = createSubmitHooks(report)
    const { result } = renderHook(() => hooks.useValidatedFormState(schema, valid))
    await act(async () => {
      await result.current.submit(async () => ({ response: response(200) }), { failure: 'Nope.', success: 'Saved.' })
    })
    expect(report.success).toHaveBeenCalledExactlyOnceWith('Saved.')
  })

  it('passes the idempotency options through', async () => {
    const call = vi.fn(async () => ({}))
    const hooks = createSubmitHooks(reporter())
    const { result } = renderHook(() => hooks.useValidatedFormState(schema, valid, { generateKey: () => 'bound-key' }))
    await act(async () => {
      await result.current.submit(call, { failure: 'Nope.' })
    })
    expect(call).toHaveBeenCalledWith({ name: 'Ada', password: 'x', confirm: 'x' }, 'bound-key')
  })
})

describe('error envelope', () => {
  const taken = { status: 400, errors: [{ message: 'That email is taken.', code: 'email_taken', param: 'name' }] }
  const throttled = { status: 429, errors: [{ message: 'Too many requests.', code: 'too_many' }] }

  async function submitThrough(hook: () => ReturnType<typeof useAPISubmit>, result: APIResult) {
    const { result: rendered } = renderHook(hook)
    await act(async () => {
      await rendered.current.submit(async () => result, { failure: 'Could not save.' })
    })
  }

  it('reads an allauth refusal through useAPISubmit when given the allauth envelope', async () => {
    const report = reporter()
    await submitThrough(() => useAPISubmit(report, allauthEnvelope), refusal(400, taken))
    expect(report.error).toHaveBeenCalledExactlyOnceWith('That email is taken.')
  })

  it("reads allauth's sentence on another 4xx", async () => {
    const report = reporter()
    await submitThrough(() => useAPISubmit(report, allauthEnvelope), refusal(429, throttled))
    expect(report.error).toHaveBeenCalledExactlyOnceWith('Too many requests.')
  })

  it('reads an allauth refusal as a plain failure under the default envelope', async () => {
    const report = reporter()
    await submitThrough(() => useAPISubmit(report), refusal(400, taken))
    expect(report.error).toHaveBeenCalledExactlyOnceWith('Could not save.')
  })

  it('puts allauth field errors beside the field in useValidatedFormState', async () => {
    const { result } = renderHook(() => useValidatedFormState(schema, valid, reporter(), { envelope: allauthEnvelope }))
    await act(async () => {
      await result.current.submit(async () => refusal(400, taken), { failure: 'Nope.' })
    })
    expect(result.current.formErrors).toEqual({ name: ['That email is taken.'] })
  })

  it('binds the envelope in createSubmitHooks for useAPISubmit', async () => {
    const report = reporter()
    const hooks = createSubmitHooks(report, allauthEnvelope)
    await submitThrough(() => hooks.useAPISubmit(), refusal(429, throttled))
    expect(report.error).toHaveBeenCalledExactlyOnceWith('Too many requests.')
  })

  it('binds the envelope in createSubmitHooks for useValidatedFormState', async () => {
    const hooks = createSubmitHooks(reporter(), allauthEnvelope)
    const { result } = renderHook(() => hooks.useValidatedFormState(schema, valid))
    await act(async () => {
      await result.current.submit(async () => refusal(400, taken), { failure: 'Nope.' })
    })
    expect(result.current.formErrors).toEqual({ name: ['That email is taken.'] })
  })
})
