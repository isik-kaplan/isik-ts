import { act, renderHook } from '@testing-library/react'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { useIdempotencyKey, useIdempotencyKeyOf } from '../../src/hooks'

// Numbered keys, so a test can say which attempt a key belonged to.
function counter() {
  let minted = 0
  return () => `key-${++minted}`
}

function renderKey() {
  const generateKey = counter()
  return renderHook(() => useIdempotencyKey({ generateKey })).result
}

describe('useIdempotencyKey', () => {
  // A retry after a lost response has to be recognized as the same attempt.
  it('answers the same key for the same payload', () => {
    const result = renderKey()
    expect(result.current.keyFor({ amount: 5 })).toBe('key-1')
    expect(result.current.keyFor({ amount: 5 })).toBe('key-1')
  })

  it('compares payloads by content, not identity', () => {
    const result = renderKey()
    const first = result.current.keyFor({ amount: 5, to: ['ada'] })
    expect(result.current.keyFor({ amount: 5, to: ['ada'] })).toBe(first)
  })

  it('mints a new key when the payload changes', () => {
    const result = renderKey()
    expect(result.current.keyFor({ amount: 5 })).toBe('key-1')
    expect(result.current.keyFor({ amount: 6 })).toBe('key-2')
  })

  // Only the latest attempt is remembered. Going back to an earlier payload is a new attempt, which is
  // always a safe answer, where reusing an old key could replay a result the person already moved past.
  it('does not return to an earlier key when the payload changes back', () => {
    const result = renderKey()
    result.current.keyFor({ amount: 5 })
    result.current.keyFor({ amount: 6 })
    expect(result.current.keyFor({ amount: 5 })).toBe('key-3')
  })

  it('starts a new attempt once the last one is used', () => {
    const result = renderKey()
    expect(result.current.keyFor({ amount: 5 })).toBe('key-1')
    result.current.used()
    expect(result.current.keyFor({ amount: 5 })).toBe('key-2')
  })

  it('mints nothing until a key is asked for', () => {
    const generateKey = vi.fn(() => 'key')
    const { result } = renderHook(() => useIdempotencyKey({ generateKey }))
    result.current.used()
    expect(generateKey).not.toHaveBeenCalled()
  })

  // A write with no body - a button - still wants one key per attempt.
  it('keys a write with no payload', () => {
    const result = renderKey()
    expect(result.current.keyFor()).toBe('key-1')
    expect(result.current.keyFor()).toBe('key-1')
  })

  it('tells no payload apart from a null one', () => {
    const result = renderKey()
    expect(result.current.keyFor()).toBe('key-1')
    expect(result.current.keyFor(null)).toBe('key-2')
  })

  it('keeps the attempt across re-renders', () => {
    const generateKey = counter()
    const { result, rerender } = renderHook(() => useIdempotencyKey({ generateKey }))
    result.current.keyFor({ amount: 5 })
    rerender()
    expect(result.current.keyFor({ amount: 5 })).toBe('key-1')
  })

  it('keeps one attempt per component', () => {
    const generateKey = counter()
    const first = renderHook(() => useIdempotencyKey({ generateKey })).result
    const second = renderHook(() => useIdempotencyKey({ generateKey })).result
    expect(first.current.keyFor({ amount: 5 })).toBe('key-1')
    expect(second.current.keyFor({ amount: 5 })).toBe('key-2')
  })

  it('uses crypto.randomUUID when no generator is given', () => {
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('0-0-0-0-0')
    const { result } = renderHook(() => useIdempotencyKey())
    expect(result.current.keyFor({ amount: 5 })).toBe('0-0-0-0-0')
    uuid.mockRestore()
  })

  // A page on plain http behind a hostname is not a secure context, so it has no randomUUID.
  describe('without crypto.randomUUID', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    function withBytes(fill: (bytes: Uint8Array) => void) {
      vi.stubGlobal('crypto', {
        getRandomValues: <T extends ArrayBufferView>(array: T) => {
          fill(array as unknown as Uint8Array)
          return array
        },
      })
      return renderHook(() => useIdempotencyKey()).result
    }

    it('builds a v4 UUID from getRandomValues', () => {
      const result = withBytes((bytes) => bytes.forEach((_, index) => (bytes[index] = index)))
      expect(result.current.keyFor({ amount: 5 })).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    })

    // Every bit set shows the version and variant bits are forced, not merely or-ed in.
    it('sets the version and variant bits whatever the bytes', () => {
      const result = withBytes((bytes) => bytes.fill(0xff))
      expect(result.current.keyFor({ amount: 5 })).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    })

    // Fresh bytes on every draw, so a repeated key can only come from the attempt being kept.
    it('keeps the key across retries of the same payload', () => {
      let draws = 0
      const result = withBytes((bytes) => bytes.fill(++draws))
      expect(result.current.keyFor({ amount: 5 })).toBe('01010101-0101-4101-8101-010101010101')
      expect(result.current.keyFor({ amount: 5 })).toBe('01010101-0101-4101-8101-010101010101')
      expect(result.current.keyFor({ amount: 6 })).toBe('02020202-0202-4202-8202-020202020202')
    })

    it('names generateKey and the polyfill when there is no crypto to draw on', () => {
      vi.stubGlobal('crypto', {})
      const { result } = renderHook(() => useIdempotencyKey())
      expect(() => result.current.keyFor()).toThrow(
        new TypeError(
          'useIdempotencyKey: this runtime has neither crypto.randomUUID nor crypto.getRandomValues - pass ' +
            '`generateKey`, or install a polyfill such as react-native-get-random-values'
        )
      )
    })

    // Bare Hermes, where `crypto` itself is missing.
    it('names generateKey when there is no crypto at all', () => {
      vi.stubGlobal('crypto', undefined)
      const { result } = renderHook(() => useIdempotencyKey())
      expect(() => result.current.keyFor()).toThrow(/`generateKey`/)
    })
  })

  describe('the snapshot is JSON.stringify', () => {
    // Harmless: a new attempt is always a safe answer.
    it('reads a reordered object as a new payload', () => {
      const result = renderKey()
      result.current.keyFor({ amount: 5, to: 'ada' })
      expect(result.current.keyFor({ to: 'ada', amount: 5 })).toBe('key-2')
    })

    // Not harmless, which is why a multipart form passes its own snapshot instead.
    it('reads two different files as the same payload', () => {
      const result = renderKey()
      result.current.keyFor({ file: new File(['a'], 'a.txt') })
      expect(result.current.keyFor({ file: new File(['bb'], 'b.txt') })).toBe('key-1')
    })

    it('throws for a payload JSON cannot write', () => {
      const result = renderKey()
      expect(() => result.current.keyFor({ amount: BigInt(5) })).toThrow(TypeError)
    })
  })
})

describe('useIdempotencyKeyOf', () => {
  function renderKeyOf(values: unknown) {
    const generateKey = counter()
    return renderHook(({ values }) => useIdempotencyKeyOf(values, { generateKey }), { initialProps: { values } })
  }

  it('keeps the key while the values stay the same', () => {
    const { result, rerender } = renderKeyOf({ amount: 5 })
    expect(result.current.key).toBe('key-1')
    rerender({ values: { amount: 5 } })
    expect(result.current.key).toBe('key-1')
  })

  it('mints a new key when the values change', () => {
    const { result, rerender } = renderKeyOf({ amount: 5 })
    rerender({ values: { amount: 6 } })
    expect(result.current.key).toBe('key-2')
  })

  // The key is a value read during render, so ending the attempt has to render again to replace it.
  it('renders a fresh key once the attempt is used', () => {
    const { result } = renderKeyOf({ amount: 5 })
    act(() => result.current.used())
    expect(result.current.key).toBe('key-2')
  })

  it('uses crypto.randomUUID when no generator is given', () => {
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('0-0-0-0-0')
    const { result } = renderHook(() => useIdempotencyKeyOf({ amount: 5 }))
    expect(result.current.key).toBe('0-0-0-0-0')
    uuid.mockRestore()
  })
})
