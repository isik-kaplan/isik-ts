import { fc, test } from '@fast-check/vitest'

import { describe, expect, it, vi } from 'vitest'

import {
  cloned,
  enabledIf,
  getLazyValue,
  getLazyValueAsync,
  isPathMatched,
  makeCallable,
  preventDefault,
  raises,
  suppress,
  transformExceptions,
  withAttributes,
} from '../../src/functions'

describe('withAttributes', () => {
  it('attaches typed attributes onto the function', () => {
    const fn = withAttributes(function () {}, { foo: 'bar' })
    expect(fn.foo).toBe('bar')
    expect(typeof fn).toBe('function')
  })

  it('sets an own "__proto__" attribute instead of reassigning the function prototype', () => {
    // JSON.parse (unlike an object literal, where `{ __proto__: x }` sets the prototype at parse
    // time instead of creating an own key) produces a genuine own property literally named
    // "__proto__" - this is the actual shape a caller-controlled attributes object would take in
    // practice (e.g. parsed from JSON), and the shape that previously allowed prototype pollution.
    const attributes = JSON.parse('{"__proto__":{"evil":true}}') as Record<string, unknown>
    const fn = withAttributes(function () {}, attributes)

    expect(fn instanceof Function).toBe(true)
    expect(typeof fn.call).toBe('function')
    expect(Object.prototype.hasOwnProperty.call(fn, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).evil).toBeUndefined()
  })

  it('defines attributes as writable, configurable, and enumerable', () => {
    const fn = withAttributes(function () {}, { foo: 'bar' })

    const descriptor = Object.getOwnPropertyDescriptor(fn, 'foo')

    expect(descriptor).toMatchObject({ writable: true, configurable: true, enumerable: true })
  })
})

describe('makeCallable', () => {
  it('curries a function into a callable-returning function', () => {
    const double = (n: number) => n * 2
    const callable = makeCallable(double)
    expect(callable(21)()).toBe(42)
  })
})

describe('getLazyValue', () => {
  it('returns plain values unchanged', () => {
    expect(getLazyValue(5)).toBe(5)
  })

  it('invokes function values', () => {
    expect(getLazyValue(() => 5)).toBe(5)
  })

  test.prop([fc.anything().filter((value) => typeof value !== 'function')])(
    'any non-function value passes through unchanged',
    (value) => {
      expect(getLazyValue(value)).toBe(value)
    }
  )
})

describe('getLazyValueAsync', () => {
  it('returns plain values unchanged', async () => {
    expect(await getLazyValueAsync(5)).toBe(5)
  })

  it('invokes sync function values', async () => {
    expect(await getLazyValueAsync(() => 5)).toBe(5)
  })

  it('awaits async function values', async () => {
    expect(await getLazyValueAsync(async () => 5)).toBe(5)
  })
})

describe('suppress', () => {
  class CustomError extends Error {}

  it('returns the function result when no error is thrown', () => {
    expect(suppress([CustomError], () => 42)).toBe(42)
  })

  it('returns undefined when a listed exception is thrown', () => {
    expect(
      suppress([CustomError], () => {
        throw new CustomError()
      })
    ).toBeUndefined()
  })

  it('calls onError when a listed exception is thrown', () => {
    const result = suppress(
      [CustomError],
      () => {
        throw new CustomError('boom')
      },
      (error) => (error as Error).message
    )
    expect(result).toBe('boom')
  })

  it('rethrows exceptions not in the list', () => {
    expect(() =>
      suppress([CustomError], () => {
        throw new TypeError('nope')
      })
    ).toThrow(TypeError)
  })

  it('suppresses when the error matches only one of several listed exception types', () => {
    // A multi-entry list where the thrown error matches just one entry: distinguishes checking
    // whether *some* type matches (correct) from requiring *every* listed type to match.
    expect(
      suppress([CustomError, TypeError], () => {
        throw new CustomError()
      })
    ).toBeUndefined()
  })
})

describe('preventDefault', () => {
  it('calls event.preventDefault before the wrapped handler', async () => {
    const event = { preventDefault: vi.fn() } as unknown as Event
    const handler = vi.fn().mockResolvedValue('done')
    const wrapped = preventDefault(handler)

    const result = await wrapped(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(event)
    expect(result).toBe('done')
  })

  it('always returns a promise, even when the wrapped handler is synchronous', () => {
    const event = { preventDefault: vi.fn() } as unknown as Event
    const wrapped = preventDefault((_event: Event) => 'sync result')

    const result = wrapped(event)

    expect(result).toBeInstanceOf(Promise)
  })
})

describe('isPathMatched', () => {
  it('matches a pathname against the pattern', () => {
    expect(isPathMatched('/posts/1', /^\/posts/)).toBe(true)
    expect(isPathMatched('/users/1', /^\/posts/)).toBe(false)
  })

  it('treats exempt patterns as never matching', () => {
    expect(isPathMatched('/posts/_next/chunk', /^\/posts/, [/_next/])).toBe(false)
  })

  test.prop([fc.webPath()])(
    'a pathname is always exempt from an exempt pattern derived from that same pathname, no matter the main pattern',
    (pathname) => {
      const exemptPattern = new RegExp(pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      expect(isPathMatched(pathname, /.*/, [exemptPattern])).toBe(false)
    }
  )
})

describe('raises', () => {
  it('creates a function that always throws the given error', () => {
    const error = new Error('boom')
    expect(() => raises(error)()).toThrow(error)
  })

  test.prop([fc.array(fc.anything())])('throws regardless of what arguments it is called with', (args) => {
    const error = new Error('boom')
    const fn = raises(error)
    expect(() => fn(...args)).toThrow(error)
  })
})

describe('cloned', () => {
  it('returns a function that delegates to the original', () => {
    const original = (a: number, b: number) => a + b
    const clone = cloned(original)
    expect(clone(2, 3)).toBe(5)
    expect(clone).not.toBe(original)
  })

  it('does not mutate the original when the clone is later mutated', () => {
    function original() {}
    const clone = withAttributes(cloned(original), { tag: 'clone' })
    expect(clone.tag).toBe('clone')
    expect((original as unknown as { tag?: string }).tag).toBeUndefined()
  })

  test.prop([fc.integer(), fc.integer()])(
    'always produces the same result as calling the original directly',
    (a, b) => {
      const original = (x: number, y: number) => x + y
      expect(cloned(original)(a, b)).toBe(original(a, b))
    }
  )
})

describe('enabledIf', () => {
  it('leaves the function behavior unchanged when the condition is true', () => {
    const fn = enabledIf(true, { ifNotEnabledReturnValue: 'disabled' })(() => 'enabled')
    expect(fn()).toBe('enabled')
  })

  it('replaces the function with one returning the fallback when the condition is false', () => {
    const fn = enabledIf(false, { ifNotEnabledReturnValue: 'disabled' })(() => 'enabled')
    expect(fn()).toBe('disabled')
  })

  it('accepts a zero-arg predicate for condition, evaluated once at wrap time', () => {
    let calls = 0
    const condition = () => {
      calls += 1
      return true
    }
    const fn = enabledIf(condition, { ifNotEnabledReturnValue: 'disabled' })(() => 'enabled')
    fn()
    fn()
    expect(calls).toBe(1)
  })

  it('returns a clone rather than the original function in both branches', () => {
    function original() {
      return 'enabled'
    }
    const enabled = enabledIf(true, { ifNotEnabledReturnValue: 'disabled' })(original)
    const disabled = enabledIf(false, { ifNotEnabledReturnValue: 'disabled' })(original)
    expect(enabled).not.toBe(original)
    expect(disabled).not.toBe(original)
  })
})

describe('transformExceptions', () => {
  class SourceError extends Error {}
  class TargetError extends Error {}

  it('returns the result unchanged when no error is thrown', () => {
    const fn = transformExceptions([SourceError], (error) => new TargetError(error.message))(() => 'ok')
    expect(fn()).toBe('ok')
  })

  it('lets errors not in the list pass through unchanged', () => {
    const fn = transformExceptions(
      [SourceError],
      (error) => new TargetError(error.message)
    )(() => {
      throw new TypeError('nope')
    })
    expect(() => fn()).toThrow(TypeError)
  })

  it('transforms a matching error into the new error type', () => {
    const fn = transformExceptions(
      [SourceError],
      (error) => new TargetError(`wrapped: ${error.message}`)
    )(() => {
      throw new SourceError('boom')
    })
    expect(() => fn()).toThrow(TargetError)
    expect(() => fn()).toThrow('wrapped: boom')
  })

  it('chains the original error via cause by default', () => {
    const original = new SourceError('boom')
    const fn = transformExceptions(
      [SourceError],
      () => new TargetError('wrapped')
    )(() => {
      throw original
    })
    try {
      fn()
      expect.unreachable()
    } catch (error) {
      expect((error as Error).cause).toBe(original)
    }
  })

  it('does not set cause when keepOriginal is false', () => {
    const fn = transformExceptions([SourceError], () => new TargetError('wrapped'), { keepOriginal: false })(() => {
      throw new SourceError('boom')
    })
    try {
      fn()
      expect.unreachable()
    } catch (error) {
      expect((error as Error).cause).toBeUndefined()
    }
  })
})
