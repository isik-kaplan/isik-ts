import { act, renderHook } from '@testing-library/react'

import { describe, expect, it, vi } from 'vitest'

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
  // A retry after a lost response has to be recognised as the same attempt.
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
