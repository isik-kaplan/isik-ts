# @isikk/core

Everyday TypeScript utilities - the small stuff every project ends up rewriting: object/string
helpers, date formatting, browser file handling, a couple of React hooks, and some Next.js glue.
Framework-specific pieces are split into their own entry points so you never pay for peer
dependencies you don't use.

```typescript
import { formattedDate, slugify } from '@isikk/core'

slugify('Café Münster') // 'cafe-munster'
formattedDate('yyyy-MM-dd', new Date(2026, 0, 5)) // '2026-01-05'
```

## Install

```sh
npm install @isikk/core
```

See [docs/INDEX.md](docs/INDEX.md) for everything else - every exported utility, its entry point,
and a usage example.
