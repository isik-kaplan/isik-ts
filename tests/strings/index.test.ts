import { fc, test } from '@fast-check/vitest'

import { describe, expect, it } from 'vitest'

import { slugify } from '../../src/strings'

describe('slugify', () => {
  it('lowercases and dasherizes spaces', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('strips punctuation', () => {
    expect(slugify("It's a Test!")).toBe('its-a-test')
  })

  it('collapses repeated dashes/whitespace and trims edges', () => {
    expect(slugify('  --Hello   World--  ')).toBe('hello-world')
  })

  it('drops diacritics down to their base ASCII letter by default', () => {
    expect(slugify('Café Münster')).toBe('cafe-munster')
  })

  it('keeps unicode when allowUnicode is true', () => {
    expect(slugify('Café Münster', true)).toBe('café-münster')
  })

  it('treats embedded line breaks as whitespace instead of deleting them', () => {
    expect(slugify('Hello\r\nWorld')).toBe('hello-world')
  })

  test.prop([fc.string()])(
    'output never has uppercase letters, never starts/ends with "-"/"_", never has consecutive dashes',
    (value) => {
      const result = slugify(value)
      expect(result).toBe(result.toLowerCase())
      expect(result).not.toMatch(/^[-_]|[-_]$/)
      expect(result).not.toContain('--')
    }
  )

  test.prop([fc.string()])('is idempotent - slugifying an already-slugified string changes nothing', (value) => {
    const once = slugify(value)
    expect(slugify(once)).toBe(once)
  })
})
