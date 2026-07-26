import { describe, expect, it } from 'vitest'

import * as isik from '../src/index'

describe('package entry point', () => {
  it('imports without throwing', () => {
    expect(isik).toBeDefined()
  })
})
