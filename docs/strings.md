# strings

## slugify

Django's `slugify` ported to TypeScript: lowercases, dasherizes whitespace, strips punctuation, collapses repeated dashes, and trims leading/trailing dashes and underscores.

```typescript
import { slugify } from '@isikk/core'

slugify('Hello World') // 'hello-world'
slugify("It's a Test!") // 'its-a-test'
slugify('Café Münster') // 'cafe-munster' - diacritics dropped to their base ASCII letter
```

By default, non-ASCII characters are transliterated down to their closest ASCII letter (via Unicode `NFKD` decomposition) rather than dropped outright - `é` becomes `e`, not nothing. Pass `allowUnicode: true` to keep non-ASCII letters and numbers as-is instead:

```typescript
slugify('Café Münster', true) // 'café-münster'
```
