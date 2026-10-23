import { renderHook } from '@testing-library/react'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { SubmitHeaders } from '../../src/hooks'
import { useAPISubmit, useIdempotencyKey, useValidatedFormState, useVersionedFormState } from '../../src/hooks'
import type { IdempotencyKey, Keyed, Versioned } from '../../src/http'
import { anyVersion, idempotencyKey, ifMatch } from '../../src/http'

// These are compile-time tests: each `@ts-expect-error` fails `tsc` if its line ever compiles, and
// each unmarked line fails it if it ever stops. The bodies never run - only `tsc` reads them.

// A client method as the template writes one: it takes only headers whose write decided its version.
declare function versionedWrite(headers: SubmitHeaders & Versioned): Promise<object>
declare function keyedWrite(headers: SubmitHeaders & Versioned & Keyed): Promise<object>
declare function keyedBy(key: IdempotencyKey): Promise<object>
declare const maybeEtag: string | undefined

const schema = z.object({ name: z.string() })

function typeChecks() {
  const { submit } = renderHook(() => useAPISubmit({ success: () => {}, error: () => {} })).result.current

  // An etag, `null` included, brands the headers.
  submit((headers) => versionedWrite(headers), { failure: 'x', etag: '"v1"' })
  submit((headers) => versionedWrite(headers), { failure: 'x', etag: null })
  // @ts-expect-error - a forgotten etag leaves the headers unbranded.
  submit((headers) => versionedWrite(headers), { failure: 'x' })
  // @ts-expect-error - an etag that may be undefined does too: the fix is `?? null`.
  submit((headers) => versionedWrite(headers), { failure: 'x', etag: maybeEtag })
  submit((headers) => versionedWrite(headers), { failure: 'x', etag: maybeEtag ?? null })
  // A call that takes no headers still compiles either way.
  submit(async () => ({}), { failure: 'x' })

  // The constructors brand, and a spread keeps it.
  versionedWrite(ifMatch('"v1"'))
  versionedWrite(anyVersion())
  versionedWrite({ ...ifMatch('"v1"'), Authorization: 'Bearer t' })
  keyedWrite({ ...ifMatch('"v1"'), ...idempotencyKey('k') })
  // @ts-expect-error - a hand-built header is not a decision.
  versionedWrite({ 'If-Match': '"v1"' })
  // @ts-expect-error - nor is a key.
  keyedWrite({ ...ifMatch('"v1"'), 'Idempotency-Key': 'k' })

  const { keyFor, headerFor } = renderHook(() => useIdempotencyKey()).result.current
  keyedBy(keyFor({}))
  keyedWrite({ ...ifMatch('"v1"'), ...headerFor({}) })
  // @ts-expect-error - a plain string is not a key the hooks made.
  keyedBy('plain')
  // An `IdempotencyKey` is still a string wherever one is taken.
  const asString: string = keyFor({})

  const validated = renderHook(() =>
    useValidatedFormState(schema, { name: '' }, { success: () => {}, error: () => {} })
  ).result.current
  validated.submit((_value, key) => keyedBy(key), { failure: 'x' })
  validated.submit((_value, key: string) => keyedBy(key as IdempotencyKey), { failure: 'x' })

  const versioned = renderHook(() =>
    useVersionedFormState(schema, { name: '' }, { success: () => {}, error: () => {} }, { etag: null })
  ).result.current
  versioned.submit((_value, headers) => keyedWrite(headers), { failure: 'x' })
  versioned.submit((_value, headers) => versionedWrite(headers), { failure: 'x', idempotencyKey: false })
  // @ts-expect-error - without a key the headers are not `Keyed`.
  versioned.submit((_value, headers) => keyedWrite(headers), { failure: 'x', idempotencyKey: false })
  const flag = Math.random() > 0.5
  versioned.submit((_value, headers) => versionedWrite(headers), { failure: 'x', idempotencyKey: flag })
  // @ts-expect-error - nor with a flag known only at runtime.
  versioned.submit((_value, headers) => keyedWrite(headers), { failure: 'x', idempotencyKey: flag })

  // openapi-fetch's result: a success branch and an error branch.
  type Result =
    | { data: { id: number }; error?: never; response: Response }
    | { data?: never; error: { detail: string }; response: Response }
  const call = async () => ({}) as Result

  // With the default test, onSuccess gets the success branch: `data` is present.
  submit(call, { failure: 'x', onSuccess: (result) => result.data.id })
  // With isSuccess given, success can be the error branch, so it gets the whole result.
  submit(call, {
    failure: 'x',
    isSuccess: () => true,
    // @ts-expect-error - `data` may be undefined here.
    onSuccess: (result) => result.data.id,
  })
  submit(call, { failure: 'x', isSuccess: () => true, onSuccess: (result) => result.data?.id ?? result.error?.detail })
  validated.submit(async () => ({}) as Result, { failure: 'x', onSuccess: (result) => result.data.id })
  versioned.submit(async () => ({}) as Result, { failure: 'x', onSuccess: (result) => result.data.id })

  return asString
}

describe('branded headers', () => {
  it('are checked by tsc, not at runtime', () => {
    expect(typeChecks).toBeTypeOf('function')
  })
})
