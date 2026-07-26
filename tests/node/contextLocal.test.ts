// @vitest-environment node
import { fc, test } from '@fast-check/vitest'

import { describe, expect, it } from 'vitest'

import { contextLocal } from '../../src/node/contextLocal'

describe('contextLocal', () => {
  it('always returns the same storage instance for the same name', () => {
    expect(contextLocal('A')).toBe(contextLocal('A'))
  })

  it('returns different instances for different names', () => {
    expect(contextLocal('B')).not.toBe(contextLocal('C'))
  })

  it('isolates values across concurrent async contexts', async () => {
    const storage = contextLocal<{ id: number }>('REQUEST')
    const seenInsideRun: number[] = []

    await Promise.all(
      [1, 2, 3].map((id) =>
        storage.run({ id }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 1))
          seenInsideRun.push(storage.getStore()!.id)
        })
      )
    )

    expect(seenInsideRun.sort()).toEqual([1, 2, 3])
  })

  it('returns undefined outside of any run() call', () => {
    const storage = contextLocal<{ id: number }>('OUTSIDE')
    expect(storage.getStore()).toBeUndefined()
  })

  test.prop([fc.string()])('the same name always yields the same instance, any name', (name) => {
    expect(contextLocal(name)).toBe(contextLocal(name))
  })
})
