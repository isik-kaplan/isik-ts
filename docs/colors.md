# colors

## generateTailwindColorScale

Generates a Tailwind-style `50`-`950` color scale from a single base hex color, treated as the `500` shade. Lighter shades are mixed towards white, darker shades towards black - no external color library required.

```typescript
import { generateTailwindColorScale } from '@isikk/core'

generateTailwindColorScale('#3b82f6')
// {
//   50: '#f5f9ff', 100: '#ebf3fe', 200: '#cee0fd', 300: '#b1cdfb', 400: '#76a8f9',
//   500: '#3b82f6', 600: '#326fd1', 700: '#295bac', 800: '#204887', 900: '#183462',
//   950: '#0c1a31',
// }
```

Accepts hex with or without a leading `#`, and 3-digit shorthand (`'fff'`). Throws if the input isn't a valid hex color.

## generateNamedTailwindColorScale

Same as `generateTailwindColorScale`, but prefixes each shade key with a name (e.g. `primary500`) so multiple scales can be spread into one flat palette object - handy for theme files that need `primary100`...`primary900`, `accent100`...`accent900`, etc. side by side.

```typescript
import { generateNamedTailwindColorScale } from '@isikk/core'

const palette = {
  ...generateNamedTailwindColorScale('#3b82f6', 'primary'),
  ...generateNamedTailwindColorScale('#f43f5e', 'accent'),
}
// { primary50: '#f5f9ff', ..., primary950: '#0c1a31', accent50: '...', ..., accent950: '...' }

palette.primary500 // '#3b82f6'
```

## hexToHslTriplet

Formats a hex color as the `"H S% L%"` triplet that shadcn/Tailwind CSS-variable themes expect - e.g. for `--primary: 240 5.9% 10%;`, consumed as `hsl(var(--primary))` in `tailwind.config.ts`.

```typescript
import { hexToHslTriplet } from '@isikk/core'

hexToHslTriplet('#3b82f6') // '217.2 91.2% 59.8%'
```

An optional second argument controls rounding precision (default `1`):

```typescript
hexToHslTriplet('#3b82f6', 2) // '217.22 91.22% 59.8%'
```
