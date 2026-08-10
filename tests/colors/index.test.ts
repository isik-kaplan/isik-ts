import { fc, test } from '@fast-check/vitest'

import { describe, expect, it } from 'vitest'

import { generateNamedTailwindColorScale, generateTailwindColorScale, hexToHslTriplet } from '../../src/colors'

describe('generateTailwindColorScale', () => {
  it('keeps 500 as the input color, normalized to lowercase 6-digit hex', () => {
    const scale = generateTailwindColorScale('#3B82F6')
    expect(scale[500]).toBe('#3b82f6')
  })

  it('accepts hex without a leading #', () => {
    const scale = generateTailwindColorScale('3b82f6')
    expect(scale[500]).toBe('#3b82f6')
  })

  it('expands 3-digit shorthand hex', () => {
    const scale = generateTailwindColorScale('#fff')
    expect(scale[500]).toBe('#ffffff')
  })

  it('expands each shorthand digit independently, not by repeating the whole string', () => {
    const scale = generateTailwindColorScale('#3af')
    expect(scale[500]).toBe('#33aaff')
  })

  it('trims surrounding whitespace before validating', () => {
    const scale = generateTailwindColorScale('  #3b82f6  ')
    expect(scale[500]).toBe('#3b82f6')
  })

  it('pads single-digit channels to two hex digits', () => {
    const scale = generateTailwindColorScale('#010101')
    expect(scale[500]).toBe('#010101')
  })

  it('requires the whole string to be a hex color, not just a trailing match', () => {
    expect(() => generateTailwindColorScale('zz3b82f6')).toThrow('Invalid hex color')
  })

  it('throws on invalid hex input', () => {
    expect(() => generateTailwindColorScale('not-a-color')).toThrow('Invalid hex color')
    expect(() => generateTailwindColorScale('#ff')).toThrow('Invalid hex color')
  })

  it('produces all 11 Tailwind shades', () => {
    const scale = generateTailwindColorScale('#3b82f6')
    expect(
      Object.keys(scale)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])
  })

  it('lightens shades below 500 towards white and darkens shades above 500 towards black', () => {
    const scale = generateTailwindColorScale('#3b82f6')
    const toRgbSum = (hex: string) =>
      [1, 3, 5].reduce((sum, offset) => sum + parseInt(hex.slice(offset, offset + 2), 16), 0)

    expect(toRgbSum(scale[50])).toBeGreaterThan(toRgbSum(scale[400]))
    expect(toRgbSum(scale[400])).toBeGreaterThan(toRgbSum(scale[500]))
    expect(toRgbSum(scale[500])).toBeGreaterThan(toRgbSum(scale[600]))
    expect(toRgbSum(scale[600])).toBeGreaterThan(toRgbSum(scale[950]))
  })

  it('mixes each of r, g, and b towards white/black independently, not just in aggregate', () => {
    const scale = generateTailwindColorScale('#112233')
    const channelAt = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16)

    for (const offset of [1, 3, 5]) {
      expect(channelAt(scale[50], offset)).toBeGreaterThan(channelAt(scale[500], offset))
      expect(channelAt(scale[500], offset)).toBeGreaterThan(channelAt(scale[950], offset))
    }
  })

  test.prop([fc.integer({ min: 0, max: 0xffffff })])('always returns valid 6-digit hex codes', (int) => {
    const hex = `#${int.toString(16).padStart(6, '0')}`
    const scale = generateTailwindColorScale(hex)
    for (const value of Object.values(scale)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('generateNamedTailwindColorScale', () => {
  it('prefixes every shade key with the given name', () => {
    const scale = generateNamedTailwindColorScale('#3b82f6', 'primary')
    expect(Object.keys(scale).sort()).toEqual(
      [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((shade) => `primary${shade}`).sort()
    )
  })

  it('matches the plain scale values for the same base color', () => {
    const plain = generateTailwindColorScale('#3b82f6')
    const named = generateNamedTailwindColorScale('#3b82f6', 'primary')
    expect(named.primary500).toBe(plain[500])
    expect(named.primary50).toBe(plain[50])
    expect(named.primary950).toBe(plain[950])
  })

  it('supports multiple named scales spread into one palette object', () => {
    const palette = {
      ...generateNamedTailwindColorScale('#3b82f6', 'primary'),
      ...generateNamedTailwindColorScale('#f43f5e', 'accent'),
    }
    expect(palette.primary500).toBe('#3b82f6')
    expect(palette.accent500).toBe('#f43f5e')
  })

  it('throws on invalid hex input', () => {
    expect(() => generateNamedTailwindColorScale('nope', 'primary')).toThrow('Invalid hex color')
  })
})

describe('hexToHslTriplet', () => {
  it('formats an achromatic (gray) color', () => {
    expect(hexToHslTriplet('#808080')).toBe('0 0% 50.2%')
  })

  it('formats a color where red is the max channel and green < blue', () => {
    expect(hexToHslTriplet('#c83296')).toBe('320 60% 49%')
  })

  it('formats a color where red is the max channel and green >= blue', () => {
    expect(hexToHslTriplet('#c86432')).toBe('20 60% 49%')
  })

  it('formats a color where green is the max channel', () => {
    expect(hexToHslTriplet('#32c864')).toBe('140 60% 49%')
  })

  it('formats a color where blue is the max channel', () => {
    expect(hexToHslTriplet('#3264c8')).toBe('220 60% 49%')
  })

  it('takes the l > 0.5 branch for light colors', () => {
    expect(hexToHslTriplet('#add8e6')).toBe('194.7 53.3% 79%')
  })

  it('picks the 0-6 wraparound branch by strict inequality when green equals blue', () => {
    // r is max, g === b: (gN - bN) is 0 either way, so only the ternary's strictness shows up.
    expect(hexToHslTriplet('#ff8080')).toBe('0 100% 75.1%')
  })

  it('respects a custom precision', () => {
    expect(hexToHslTriplet('#3b82f6', 2)).toBe('217.22 91.22% 59.8%')
  })

  it('throws on invalid hex input', () => {
    expect(() => hexToHslTriplet('nope')).toThrow('Invalid hex color')
  })
})
