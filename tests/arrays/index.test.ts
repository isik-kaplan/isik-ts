import { fc, test } from '@fast-check/vitest'

import { describe, expect, it } from 'vitest'

import { allCombinations, notNone } from '../../src/arrays'

describe('notNone', () => {
  it('is false for null and undefined', () => {
    expect(notNone(null)).toBe(false)
    expect(notNone(undefined)).toBe(false)
  })

  it('is true for falsy-but-defined values', () => {
    expect(notNone(0)).toBe(true)
    expect(notNone('')).toBe(true)
    expect(notNone(false)).toBe(true)
  })

  it('is true for anything else', () => {
    expect(notNone('x')).toBe(true)
    expect(notNone(42)).toBe(true)
    expect(notNone({})).toBe(true)
  })

  test.prop([fc.oneof(fc.integer(), fc.string(), fc.boolean())])(
    'is always true for non-nullish primitives',
    (value) => {
      expect(notNone(value)).toBe(true)
    }
  )
})

describe('allCombinations', () => {
  it('returns every non-empty subset in size-ascending order', () => {
    expect(allCombinations(['a', 'b'])).toEqual([['a'], ['b'], ['a', 'b']])
  })

  it('matches the size-then-lexicographic order for three items', () => {
    expect(allCombinations(['a', 'b', 'c'])).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
      ['a', 'b', 'c'],
    ])
  })

  it('returns an empty array for an empty input', () => {
    expect(allCombinations([])).toEqual([])
  })

  test.prop([fc.uniqueArray(fc.integer(), { maxLength: 6 })])(
    'produces every non-empty subset, and only genuine subsets, of any unique-item array',
    (options) => {
      const combinations = allCombinations(options)
      const expectedCount = options.length === 0 ? 0 : 2 ** options.length - 1

      expect(combinations.length).toBe(expectedCount)
      expect(combinations.every((combo) => combo.length > 0)).toBe(true)
      expect(combinations.every((combo) => combo.every((item) => options.includes(item)))).toBe(true)
      expect(new Set(combinations.map((combo) => JSON.stringify(combo))).size).toBe(combinations.length)
    }
  )
})
