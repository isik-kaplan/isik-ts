// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { boolean, caster, commaSeparatedList, integer, string } from '../../src/node/casters'
import { ConfigError, config } from '../../src/node/config'

describe('config', () => {
  it('reads and casts values from process.env', () => {
    vi.stubEnv('PORT', '3000')
    vi.stubEnv('DEBUG', 'true')
    vi.stubEnv('HOSTS', 'a.com,b.com')

    const result = config({
      PORT: integer(),
      DEBUG: boolean(),
      HOSTS: commaSeparatedList(),
    })

    expect(result).toEqual({ PORT: 3000, DEBUG: true, HOSTS: ['a.com', 'b.com'] })
  })

  it('supports nested schemas, joined with the separator', () => {
    vi.stubEnv('DATABASE__HOST', 'localhost')
    vi.stubEnv('DATABASE__PORT', '5432')

    const result = config({
      DATABASE: {
        HOST: string(),
        PORT: integer(),
      },
    })

    expect(result).toEqual({ DATABASE: { HOST: 'localhost', PORT: 5432 } })
  })

  it('joins with a custom separator', () => {
    vi.stubEnv('DATABASE.HOST', 'localhost')

    const result = config(
      {
        DATABASE: { HOST: string() },
      },
      { sep: '.' }
    )

    expect(result).toEqual({ DATABASE: { HOST: 'localhost' } })
  })

  it('prefixes every environment variable name when prefix is given', () => {
    vi.stubEnv('MYAPP__PORT', '3000')

    const result = config({ PORT: integer() }, { prefix: 'MYAPP' })

    expect(result).toEqual({ PORT: 3000 })
  })

  it('falls back to missingDefault when the variable is not set', () => {
    vi.stubEnv('MISSING_VAR', undefined)

    const result = config({ MISSING_VAR: string({ missingDefault: 'fallback' }) })

    expect(result).toEqual({ MISSING_VAR: 'fallback' })
  })

  it('throws ConfigError when a required variable is missing and there is no missingDefault', () => {
    vi.stubEnv('REQUIRED_VAR', undefined)

    expect(() => config({ REQUIRED_VAR: string() })).toThrow(ConfigError)
  })

  it('falls back to errorDefault when the value fails to parse', () => {
    vi.stubEnv('BAD_INT', 'not-a-number')

    const result = config({ BAD_INT: integer({ errorDefault: -1 }) })

    expect(result).toEqual({ BAD_INT: -1 })
  })

  it('throws ConfigError when a value fails to parse and there is no errorDefault', () => {
    vi.stubEnv('BAD_INT', 'not-a-number')

    expect(() => config({ BAD_INT: integer() })).toThrow(ConfigError)
  })

  it('stringifies a non-Error throw from a custom caster instead of reading .message', () => {
    vi.stubEnv('WEIRD', 'anything')
    const throwsAString = caster((): string => {
      // eslint-disable-next-line no-throw-literal
      throw 'not an Error instance'
    })()

    expect(() => config({ WEIRD: throwsAString })).toThrow(/not an Error instance/)
  })
})
