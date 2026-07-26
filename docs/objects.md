# objects

Small helpers for validating and building up plain objects.

## checkRequiredKeys

Checks that an object's defined (non-`undefined`) keys match exactly one of several named key-groups - for functions that accept a few different, mutually exclusive sets of arguments and need to figure out at runtime which one the caller used.

```typescript
import { checkRequiredKeys } from '@isikk/core'

const conditions = {
  byUrl: ['url'],
  byHostPort: ['host', 'port'],
} as const

checkRequiredKeys({ url: 'https://example.com' }, conditions) // 'byUrl'
checkRequiredKeys({ host: 'localhost', port: 8080 }, conditions) // 'byHostPort'
checkRequiredKeys({ url: '...', host: 'localhost' }, conditions) // throws
```

- Throws when zero or more than one condition group matches.
- Keys not mentioned in any group are ignored (not forbidden) as long as they're `undefined`.

## requireExclusiveKeys

A decorator form of the same validation `checkRequiredKeys` does, applied once at the call boundary of a function that takes a single options object, instead of something you call manually inside the function body. Any key on the options object that isn't mentioned in any condition group is fully unconstrained - unlike `checkRequiredKeys`, its value doesn't matter at all, since this is meant to validate one options object that may legitimately carry other, unrelated fields alongside the mutually-exclusive ones.

```typescript
import { requireExclusiveKeys } from '@isikk/core'

const conditions = {
  byUrl: ['url'],
  byHost: ['host', 'port'],
} as const

const connect = requireExclusiveKeys(conditions)((options: {
  url?: string
  host?: string
  port?: number
  db?: number
}) => {
  // ...
})

connect({ url: 'https://example.com' }) // OK - matches byUrl
connect({ url: 'https://example.com', db: 1 }) // OK - matches byUrl, db is unrelated and ignored
connect({ host: 'localhost', port: 8080 }) // OK - matches byHost
connect({ url: '...', host: 'localhost' }) // throws - matches both
connect({}) // throws - matches neither
```

- Pass `{ allowEmpty: true }` to also accept a call where none of the governed keys are provided at all, not just exactly one group:

  ```typescript
  const suppressCallable = requireExclusiveKeys(
    { byReturnValue: ['returnValue'], byReturnFunc: ['returnFunc'] } as const,
    { allowEmpty: true }
  )((options: { returnValue?: unknown; returnFunc?: () => unknown }) => {
    /* ... */
  })

  suppressCallable({}) // OK - neither provided, allowed because allowEmpty is set
  ```

- Throws immediately (before ever wrapping a function) if called with no conditions at all.

## setKeyValueToObjectIfValue

Sets `object[key] = value`, but only when `value` is truthy - a one-line guard against sprinkling `if (value) obj.key = value` throughout object-building code.

```typescript
import { setKeyValueToObjectIfValue } from '@isikk/core'

const params: Record<string, unknown> = {}
setKeyValueToObjectIfValue('search', searchTerm, params)
setKeyValueToObjectIfValue('page', 0, params) // 0 is falsy, skipped
```

- Uses `Object.defineProperty` internally rather than a plain assignment, so a dynamic/caller-supplied `key` of `'__proto__'` sets a real own property instead of reassigning `object`'s prototype - safe to use with keys that aren't hardcoded literals.
