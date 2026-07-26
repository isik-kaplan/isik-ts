import { fc, test } from '@fast-check/vitest'

import { describe, expect, it } from 'vitest'

import { forcedType, getKeys } from '../../src/types'

describe('getKeys', () => {
  it('returns typed object keys', () => {
    const obj = { a: 1, b: 2 }
    expect(getKeys(obj)).toEqual(['a', 'b'])
  })

  test.prop([fc.dictionary(fc.string(), fc.anything())])('always matches plain Object.keys exactly', (obj) => {
    expect(getKeys(obj)).toEqual(Object.keys(obj))
  })
})

describe('forcedType', () => {
  it('returns the input value unchanged', () => {
    const value: unknown = { a: 1 }
    expect(forcedType<{ a: number }>(value)).toBe(value)
  })
})
