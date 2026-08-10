export type TailwindShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950

export type TailwindColorScale = Record<TailwindShade, string>

interface Rgb {
  r: number
  g: number
  b: number
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

function hexToRgb(hex: string): Rgb {
  const match = HEX_PATTERN.exec(hex.trim())
  if (!match) {
    throw new Error(`Invalid hex color: "${hex}"`)
  }

  const digits = match[1]
  const normalized =
    digits.length === 3
      ? digits
          .split('')
          .map((char) => char + char)
          .join('')
      : digits

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

function mixRgb(base: Rgb, target: Rgb, weight: number): Rgb {
  return {
    r: base.r + (target.r - base.r) * weight,
    g: base.g + (target.g - base.g) * weight,
    b: base.b + (target.b - base.b) * weight,
  }
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

// Weight of white/black mixed into the base color at each shade, tuned so 500 is the input
// color unchanged and the rest approximate the spread of Tailwind's own default palettes.
const TINT_WEIGHTS: Record<50 | 100 | 200 | 300 | 400, number> = { 50: 0.95, 100: 0.9, 200: 0.75, 300: 0.6, 400: 0.3 }
const SHADE_WEIGHTS: Record<600 | 700 | 800 | 900 | 950, number> = {
  600: 0.15,
  700: 0.3,
  800: 0.45,
  900: 0.6,
  950: 0.8,
}

/**
 * Generates a Tailwind-style 50-950 color scale from a single base hex color, treated as the 500 shade.
 */
export function generateTailwindColorScale(baseColor: string): TailwindColorScale {
  const base = hexToRgb(baseColor)

  return {
    50: rgbToHex(mixRgb(base, WHITE, TINT_WEIGHTS[50])),
    100: rgbToHex(mixRgb(base, WHITE, TINT_WEIGHTS[100])),
    200: rgbToHex(mixRgb(base, WHITE, TINT_WEIGHTS[200])),
    300: rgbToHex(mixRgb(base, WHITE, TINT_WEIGHTS[300])),
    400: rgbToHex(mixRgb(base, WHITE, TINT_WEIGHTS[400])),
    500: rgbToHex(base),
    600: rgbToHex(mixRgb(base, BLACK, SHADE_WEIGHTS[600])),
    700: rgbToHex(mixRgb(base, BLACK, SHADE_WEIGHTS[700])),
    800: rgbToHex(mixRgb(base, BLACK, SHADE_WEIGHTS[800])),
    900: rgbToHex(mixRgb(base, BLACK, SHADE_WEIGHTS[900])),
    950: rgbToHex(mixRgb(base, BLACK, SHADE_WEIGHTS[950])),
  }
}

/**
 * Like {@link generateTailwindColorScale}, but prefixes each shade with `name` (e.g. `primary500`)
 * so multiple scales can be spread into one flat palette object.
 */
export function generateNamedTailwindColorScale<T extends string>(
  baseColor: string,
  name: T
): Record<`${T}${TailwindShade}`, string> {
  const scale = generateTailwindColorScale(baseColor)

  return Object.fromEntries(Object.entries(scale).map(([shade, hex]) => [`${name}${shade}`, hex])) as Record<
    `${T}${TailwindShade}`,
    string
  >
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rN = r / 255
  const gN = g / 255
  const bN = b / 255

  const max = Math.max(rN, gN, bN)
  const min = Math.min(rN, gN, bN)
  const l = (max + min) / 2

  if (max === min) {
    return { h: 0, s: 0, l: l * 100 }
  }

  const delta = max - min
  // Stryker disable next-line EqualityOperator: equivalent mutant. l === 0.5 iff max + min === 1,
  // in which case 2 - max - min === max + min too, so both branches compute the same value and
  // no test can ever distinguish `>` from `>=` here.
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)

  let h: number
  if (max === rN) {
    h = ((gN - bN) / delta + (gN < bN ? 6 : 0)) * 60
  } else if (max === gN) {
    h = ((bN - rN) / delta + 2) * 60
  } else {
    h = ((rN - gN) / delta + 4) * 60
  }

  return { h, s: s * 100, l: l * 100 }
}

/**
 * Formats a hex color as the "H S% L%" triplet shadcn/Tailwind CSS variable themes expect,
 * e.g. for `--primary: 240 5.9% 10%;` consumed as `hsl(var(--primary))`.
 */
export function hexToHslTriplet(hex: string, precision: number = 1): string {
  const { h, s, l } = rgbToHsl(hexToRgb(hex))
  const round = (value: number) => Number(value.toFixed(precision))

  return `${round(h)} ${round(s)}% ${round(l)}%`
}
