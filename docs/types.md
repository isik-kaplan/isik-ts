# types

Type-level helpers plus a couple of small runtime escape hatches for working around TypeScript's stricter corners.

## getKeys

`Object.keys` typed to return `Array<keyof T>` instead of `string[]`.

```typescript
import { getKeys } from '@isikk/core'

const config = { host: 'localhost', port: 5432 }
getKeys(config) // ('host' | 'port')[], not string[]
```

## RecursivePartial

Like `Partial<T>`, but applied at every nesting level instead of just the top one.

```typescript
import type { RecursivePartial } from '@isikk/core'

type Config = { server: { host: string; port: number } }

const patch: RecursivePartial<Config> = { server: { port: 5433 } } // host is optional too
```

## RecursiveRecord

A JSON-like value type: strings, numbers, booleans, nested `RecursiveRecord`s, or arrays of them. Useful for typing arbitrary user-supplied config/metadata objects without reaching for `any`.

```typescript
import type { RecursiveRecord } from '@isikk/core'

const metadata: RecursiveRecord = {
  title: 'Post',
  views: 10,
  published: true,
  author: { name: 'Jane' },
}
```

## forcedType

A type assertion function - `obj as unknown as T` wrapped as a call so the cast is visible at every call site instead of buried in an inline `as` chain.

```typescript
import { forcedType } from '@isikk/core'

const value: unknown = JSON.parse(raw)
const config = forcedType<Config>(value)
```

- This does not validate anything at runtime - it is exactly as unsafe as the `as unknown as T` it replaces. Use it only where you already know the shape is correct (e.g. right after `JSON.parse` of a payload from a trusted source).
