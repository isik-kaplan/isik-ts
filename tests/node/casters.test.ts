// @vitest-environment node
import { fc, test } from '@fast-check/vitest'

import { describe, expect, it } from 'vitest'

import {
  boolean,
  caster,
  commaSeparatedFloatList,
  commaSeparatedIntList,
  commaSeparatedList,
  float,
  integer,
  string,
} from '../../src/node/casters'

describe('caster', () => {
  it('creates a caster that applies the given function', () => {
    const upper = caster((value: string) => value.toUpperCase())()
    expect(upper('hi')).toBe('HI')
  })

  it('attaches missingDefault and errorDefault when given, and only when given', () => {
    const withDefaults = caster((value: string) => value)({ missingDefault: 'a', errorDefault: 'b' })
    expect(withDefaults.missingDefault).toBe('a')
    expect(withDefaults.errorDefault).toBe('b')

    const withoutDefaults = caster((value: string) => value)()
    expect('missingDefault' in withoutDefaults).toBe(false)
    expect('errorDefault' in withoutDefaults).toBe(false)
  })

  it('distinguishes an explicit undefined default from no default at all', () => {
    const withExplicitUndefined = caster((value: string) => value)({ missingDefault: undefined })
    expect('missingDefault' in withExplicitUndefined).toBe(true)
  })

  it('each call produces an independent caster instance', () => {
    const factory = caster((value: string) => value)
    const first = factory({ missingDefault: 'a' })
    const second = factory({ missingDefault: 'b' })
    expect(first.missingDefault).toBe('a')
    expect(second.missingDefault).toBe('b')
  })
})

describe('string', () => {
  it('passes the value through unchanged', () => {
    expect(string()('hello')).toBe('hello')
  })
})

describe('integer', () => {
  it('parses a valid integer string', () => {
    expect(integer()('42')).toBe(42)
    expect(integer()('-7')).toBe(-7)
    expect(integer()(' 42 ')).toBe(42)
  })

  it('throws on unparseable input, including partial-prefix and empty/whitespace values', () => {
    expect(() => integer()('abc')).toThrow()
    expect(() => integer()('123abc')).toThrow()
    expect(() => integer()('12.5')).toThrow()
    expect(() => integer()('')).toThrow()
    expect(() => integer()('   ')).toThrow()
    expect(() => integer()('abc')).toThrow('Value "abc" can not be parsed into an integer.')
  })

  test.prop([fc.integer()])('round-trips any integer through its own string form', (n) => {
    expect(integer()(String(n))).toBe(n)
  })
})

describe('float', () => {
  it('parses a valid float string', () => {
    expect(float()('3.14')).toBe(3.14)
    expect(float()('42')).toBe(42)
  })

  it('throws on unparseable input', () => {
    expect(() => float()('abc')).toThrow()
    expect(() => float()('')).toThrow()
    expect(() => float()('   ')).toThrow()
    expect(() => float()('abc')).toThrow('Value "abc" can not be parsed into a float.')
  })

  test.prop([fc.float({ noNaN: true })])('round-trips any float through its own string form', (n) => {
    expect(float()(String(n))).toBeCloseTo(n)
  })
})

describe('boolean', () => {
  it('parses recognized truthy/falsy strings', () => {
    expect(boolean()('true')).toBe(true)
    expect(boolean()('True')).toBe(true)
    expect(boolean()('1')).toBe(true)
    expect(boolean()('false')).toBe(false)
    expect(boolean()('False')).toBe(false)
    expect(boolean()('0')).toBe(false)
  })

  it('throws on anything else', () => {
    expect(() => boolean()('yes')).toThrow()
    expect(() => boolean()('')).toThrow()
    expect(() => boolean()('yes')).toThrow('Value "yes" can not be parsed into a boolean.')
  })
})

describe('commaSeparatedList', () => {
  it('splits on commas', () => {
    expect(commaSeparatedList()('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('reads an empty variable as an empty list, not one empty item', () => {
    expect(commaSeparatedList()('')).toEqual([])
  })

  it('keeps the empty items between commas', () => {
    expect(commaSeparatedList()(',')).toEqual(['', ''])
  })
})

describe('commaSeparatedIntList', () => {
  it('splits and parses each element as an integer', () => {
    expect(commaSeparatedIntList()('1,2,3')).toEqual([1, 2, 3])
  })

  it('reads an empty variable as an empty list rather than throwing', () => {
    expect(commaSeparatedIntList()('')).toEqual([])
  })

  it('throws if any element is unparseable', () => {
    expect(() => commaSeparatedIntList()('1,abc,3')).toThrow()
  })
})

describe('commaSeparatedFloatList', () => {
  it('splits and parses each element as a float', () => {
    expect(commaSeparatedFloatList()('1.5,2.5')).toEqual([1.5, 2.5])
  })

  it('reads an empty variable as an empty list rather than throwing', () => {
    expect(commaSeparatedFloatList()('')).toEqual([])
  })

  it('still throws for an item left empty between commas', () => {
    expect(() => commaSeparatedFloatList()('1.5,')).toThrow()
  })

  it('throws if any element is unparseable', () => {
    expect(() => commaSeparatedFloatList()('1.5,abc')).toThrow()
  })
})
