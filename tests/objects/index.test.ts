import { fc, test } from '@fast-check/vitest'

import { describe, expect, it } from 'vitest'

import { checkRequiredKeys, requireExclusiveKeys, setKeyValueToObjectIfValue } from '../../src/objects'

describe('checkRequiredKeys', () => {
  type Obj = { a?: number; b?: number; c?: number }

  const conditions: Record<string, Array<keyof Obj>> = {
    conditionName: ['a'],
    condition2Name: ['b', 'c'],
  }

  it('returns the matching condition name', () => {
    expect(checkRequiredKeys({ a: 1, b: undefined, c: undefined }, conditions)).toBe('conditionName')
    expect(checkRequiredKeys({ a: undefined, b: 1, c: 2 }, conditions)).toBe('condition2Name')
  })

  it('throws when no condition matches exactly', () => {
    const message = /do not match exactly one required condition/
    expect(() => checkRequiredKeys({ a: 1, b: 2, c: 3 }, conditions)).toThrow(message)
    expect(() => checkRequiredKeys({ a: undefined, b: undefined, c: undefined }, conditions)).toThrow(message)
  })

  it('excludes a condition when one of its required keys is present but undefined', () => {
    // Every other key is absent, so a buggy "always satisfied" required-keys check would be the
    // only thing standing between this and a false match.
    expect(() => checkRequiredKeys({ a: undefined }, { onlyCond: ['a'] })).toThrow(
      /do not match exactly one required condition/
    )
  })

  it('excludes a condition when an unrelated key carries a defined value', () => {
    // 'extra' is neither one of the condition's keys nor undefined, so it must fail the
    // "every other key is undefined" check - a buggy .some/OR/always-true here would wrongly
    // ignore it.
    expect(() => checkRequiredKeys({ a: 1, extra: 5 }, { onlyCond: ['a'] })).toThrow(
      /do not match exactly one required condition/
    )
  })

  it('excludes a condition when only some, not all, of its required keys are present', () => {
    // A buggy .some in place of .every on the required-keys check would be satisfied by 'a'
    // alone and never notice 'b' is missing.
    expect(() => checkRequiredKeys({ a: 1, b: undefined }, { onlyCond: ['a', 'b'] })).toThrow(
      /do not match exactly one required condition/
    )
  })
})

describe('requireExclusiveKeys', () => {
  type Options = { url?: string; host?: string; port?: number; db?: number }

  const conditions: Record<string, Array<keyof Options>> = {
    byUrl: ['url'],
    byHost: ['host', 'port'],
  }

  it('calls the wrapped function when exactly one condition matches', () => {
    const connect = requireExclusiveKeys(conditions)((options: Options) => options)
    expect(connect({ url: 'https://example.com' })).toEqual({ url: 'https://example.com' })
    expect(connect({ host: 'localhost', port: 8080 })).toEqual({ host: 'localhost', port: 8080 })
  })

  it('throws when both or neither condition group is satisfied', () => {
    const connect = requireExclusiveKeys(conditions)((options: Options) => options)
    expect(() => connect({ url: 'https://example.com', host: 'localhost' })).toThrow()
    expect(() => connect({})).toThrow()
  })

  it('ignores keys not mentioned in any condition group', () => {
    const connect = requireExclusiveKeys(conditions)((options: Options) => options)
    expect(connect({ url: 'https://example.com', db: 1 })).toEqual({ url: 'https://example.com', db: 1 })
  })

  it('allows an empty (fully ungoverned) call when allowEmpty is set', () => {
    const suppressCallable = requireExclusiveKeys(conditions, { allowEmpty: true })((options: Options) => options)
    expect(suppressCallable({})).toEqual({})
    expect(suppressCallable({ db: 1 })).toEqual({ db: 1 })
  })

  it('still enforces exclusivity when allowEmpty is set and some governed keys are provided', () => {
    const suppressCallable = requireExclusiveKeys(conditions, { allowEmpty: true })((options: Options) => options)
    expect(() => suppressCallable({ url: 'https://example.com', host: 'localhost' })).toThrow()
  })

  it('throws at wrap time when given no conditions at all', () => {
    expect(() => requireExclusiveKeys({})).toThrow('At least one condition must be provided.')
  })

  test.prop([fc.integer()])('an ungoverned key never changes whether the call succeeds', (dbValue) => {
    const connect = requireExclusiveKeys(conditions)((options: Options) => options)
    expect(connect({ url: 'https://example.com', db: dbValue })).toEqual({
      url: 'https://example.com',
      db: dbValue,
    })
  })
})

describe('setKeyValueToObjectIfValue', () => {
  it('sets the key when value is truthy', () => {
    const object: Record<string, unknown> = {}
    setKeyValueToObjectIfValue('key', 'value', object)
    expect(object).toEqual({ key: 'value' })
  })

  it('skips the key when value is falsy', () => {
    const object: Record<string, unknown> = {}
    setKeyValueToObjectIfValue('key', 0, object)
    // hasOwnProperty rather than toEqual({}): toEqual treats a `key: undefined` own property as
    // equal to a missing key, so it wouldn't notice a check that always ran and defined `key`
    // with an undefined/falsy value.
    expect(Object.prototype.hasOwnProperty.call(object, 'key')).toBe(false)
  })

  it('sets an own "__proto__" property instead of reassigning the object prototype', () => {
    const object: Record<string, unknown> = {}
    setKeyValueToObjectIfValue('__proto__', { polluted: true }, object)

    expect(Object.prototype.hasOwnProperty.call(object, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(object)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('defines the key as writable, configurable, and enumerable', () => {
    const object: Record<string, unknown> = {}
    setKeyValueToObjectIfValue('key', 'value', object)

    const descriptor = Object.getOwnPropertyDescriptor(object, 'key')

    expect(descriptor).toMatchObject({ writable: true, configurable: true, enumerable: true })
  })

  test.prop([fc.string(), fc.anything()])(
    'sets the key on the object exactly when the value is truthy, and never otherwise',
    (key, value) => {
      const object: Record<string, unknown> = {}
      setKeyValueToObjectIfValue(key, value, object)

      if (value) {
        expect(object[key]).toBe(value)
      } else {
        // hasOwnProperty, not `key in object`: `in` walks the prototype chain, so for any key
        // inherited from Object.prototype - valueOf, toString, hasOwnProperty, __defineGetter__ -
        // it reports true on a fresh {} even though nothing was set. That made this property fail
        // for whichever seeds happened to generate one of those names with a falsy value (seed
        // 1770714701 found ["valueOf", 0]), which is what blocked the 0.5.0 publish. Own-property
        // presence is what the implementation actually promises.
        expect(Object.prototype.hasOwnProperty.call(object, key)).toBe(false)
      }
    }
  )
})
