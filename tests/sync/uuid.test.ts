import { describe, expect, it } from 'vitest'

import { uuid7 } from '../../src/sync/uuid'

describe('uuid7', () => {
  it('is a version-7, variant-1 UUID carrying the time in its first 48 bits', () => {
    const id = uuid7(0x0190a0000001)
    expect(id).toMatch(/^0190a000-0001-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('sorts by the time it was made', () => {
    const ids = [1, 2, 300, 70_000, 1_700_000_000_000].map((ms) => uuid7(ms))
    expect([...ids].sort()).toEqual(ids)
  })

  it('defaults to now, and differs each time', () => {
    const before = Date.now()
    const id = uuid7()
    expect(parseInt(id.slice(0, 8) + id.slice(9, 13), 16)).toBeGreaterThanOrEqual(before)
    expect(uuid7()).not.toBe(id)
  })
})
