import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { AFTER_PREFIX, encodeKey } from '../../src/sync/keys'

// The order a key's encoding sorts in must be the order of the values it encodes: null, false, true,
// numbers, strings, then anything else by its JSON; a tuple by its first difference, a prefix first.

const RANK = (value: unknown) => {
  if (value === null || value === undefined) return 0
  if (value === false) return 1
  if (value === true) return 2
  if (typeof value === 'number') return 3
  if (typeof value === 'string') return 4
  return 5
}

function compareValue(a: unknown, b: unknown): number {
  const rank = RANK(a) - RANK(b)
  if (rank !== 0) return rank
  if (typeof a === 'number' && typeof b === 'number') return Math.sign(a - b) || 0
  const left = typeof a === 'string' ? a : JSON.stringify(a ?? null)
  const right = typeof b === 'string' ? b : JSON.stringify(b ?? null)
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareTuple(a: unknown[], b: unknown[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const order = compareValue(a[i], b[i])
    if (order !== 0) return order
  }
  return a.length - b.length
}

const sign = (n: number) => Math.sign(n)
const scalar = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.double({ noNaN: true }),
  fc.integer(),
  fc.string({ unit: 'binary' }),
  fc.constantFrom('', '\u0000', '\u0001', '\u0002', '\u0003', 'a\u0000b', 'a'),
  fc.array(fc.integer(), { maxLength: 2 })
)
const tuple = fc.array(scalar, { maxLength: 3 })

const compareKeys = (a: string, b: string) => {
  if (a === b) return 0
  return a < b ? -1 : 1
}

describe('encodeKey', () => {
  it('sorts as the values it encodes do', () => {
    fc.assert(
      fc.property(tuple, tuple, (a, b) => {
        // -0 and 0 are one value.
        const normal = (t: unknown[]) => t.map((v) => (Object.is(v, -0) ? 0 : v))
        expect(sign(compareKeys(encodeKey(a), encodeKey(b)))).toBe(sign(compareTuple(normal(a), normal(b))))
      }),
      { numRuns: 2000 }
    )
  })

  it('starts every extension of a tuple with its key, below the prefix bound', () => {
    fc.assert(
      fc.property(tuple, tuple, (prefix, rest) => {
        const key = encodeKey([...prefix, ...rest])
        expect(key.startsWith(encodeKey(prefix))).toBe(true)
        expect(key < encodeKey(prefix) + AFTER_PREFIX).toBe(true)
      })
    )
  })

  it('never encodes NUL', () => {
    fc.assert(
      fc.property(tuple, (values) => {
        expect(encodeKey(values)).not.toContain('\u0000')
      })
    )
  })

  it('treats undefined as null, -0 as 0, and refuses NaN', () => {
    expect(encodeKey([undefined])).toBe(encodeKey([null]))
    expect(encodeKey([-0])).toBe(encodeKey([0]))
    expect(() => encodeKey([NaN])).toThrow(/NaN/)
  })

  it('encodes each type as its tag, its payload and a terminator', () => {
    expect(encodeKey([])).toBe('')
    expect(encodeKey([null, false, true])).toBe('\u0003\u0001\u0004\u0001\u0005\u0001')
    expect(encodeKey([1])).toBe('\u0006bff0000000000000\u0001')
    expect(encodeKey([-1])).toBe('\u0006400fffffffffffff\u0001')
    expect(encodeKey(['ab', 'c'])).toBe('\u0007ab\u0001\u0007c\u0001')
    expect(encodeKey(['\u0000\u0001\u0002\u0003'])).toBe('\u0007\u0002\u0002\u0002\u0003\u0002\u0004\u0003\u0001')
    expect(encodeKey(['\ud83d\ude00'])).toBe('\u0007\ud83d\ude00\u0001')
    expect(encodeKey([[1, 'a']])).toBe('\u0008[1,"a"]\u0001')
  })

  it('orders the escaped characters among themselves and the rest', () => {
    const strings = ['', '\u0000', '\u0000\u0000', '\u0001', '\u0002', '\u0003', 'a', 'a\u0000', 'a\u0002', 'ab']
    const keys = strings.map((s) => encodeKey([s]))
    expect([...keys].sort()).toEqual(keys)
  })

  it('orders numbers across signs, magnitudes, their low bits and infinities', () => {
    const numbers = [
      -Infinity,
      -1e300,
      -2,
      -1.5,
      -(1 + 2 ** -21),
      -(1 + 2 ** -40),
      -(1 + 2 ** -52),
      -1,
      -Number.MIN_VALUE,
      0,
      Number.MIN_VALUE,
      1,
      1 + 2 ** -52,
      1 + 2 ** -40,
      1 + 2 ** -21,
      1.5,
      2,
      1e300,
      Infinity,
    ]
    const keys = numbers.map((n) => encodeKey([n]))
    expect([...keys].sort()).toEqual(keys)
  })
})
