# cookies

## getCookie

Reads a single cookie's value from `document.cookie`. Browser-only - for reading cookies in a Next.js server context (Server Components, Server Actions), see [next/cookies](next/cookies.md) instead.

```typescript
import { getCookie } from '@isikk/core'

document.cookie = 'session=abc123'
getCookie('session') // 'abc123'
getCookie('missing') // undefined
```
