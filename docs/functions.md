# functions

Small function-shaped building blocks: attaching data to functions, adapting callbacks for inline use, lazy values, scoped exception suppression/transformation, and conditionally-enabled functions.

## withAttributes

Attaches typed properties directly onto a function object, and returns it typed as `Fn & Attrs` so the attributes are visible to TypeScript at every call site - no separate object needed to carry both the callable and its metadata.

```typescript
import { withAttributes } from '@isikk/core'

const greet = withAttributes(
  function (name: string) {
    return `Hello, ${name}`
  },
  { version: 1 }
)

greet('Jane') // 'Hello, Jane'
greet.version // 1, and TypeScript knows it's there
```

- Uses `Object.defineProperty` internally rather than a plain assignment, so a dynamic/caller-supplied attribute key of `'__proto__'` sets a real own property instead of reassigning the function's own prototype - safe to use with `attributes` objects that aren't hardcoded literals (e.g. parsed from JSON).

## makeCallable

Curries a one-argument function into a function that returns a zero-argument callable - for inline event handlers where you'd otherwise write `() => someFunction(data)` every time.

```typescript
import { makeCallable } from '@isikk/core'

const logId = makeCallable((id: string) => console.log(id))

// <button onClick={logId(item.id)}>...</button>
// instead of
// <button onClick={() => console.log(item.id)}>...</button>
```

## getLazyValue / getLazyValueAsync

Resolves a value that might be given directly or as a thunk - useful for options objects that accept either a static value or a function computing one lazily. `getLazyValueAsync` additionally accepts (and awaits) an async thunk.

```typescript
import { getLazyValue, getLazyValueAsync } from '@isikk/core'

getLazyValue(5) // 5
getLazyValue(() => 5) // 5

await getLazyValueAsync(5) // 5
await getLazyValueAsync(() => 5) // 5
await getLazyValueAsync(async () => 5) // 5
```

## suppress

Runs `fn`, and if it throws one of the listed exception constructors, returns `undefined` (or the result of `onError(error)`, if given) instead of letting it propagate. Anything not in the list is rethrown.

```typescript
import { suppress } from '@isikk/core'

class NotFoundError extends Error {}

const user = suppress(
  [NotFoundError],
  () => fetchUserOrThrow(id),
  (error) => null
)
```

## preventDefault

Wraps an event handler so `event.preventDefault()` is called before the handler runs, then awaits and returns the handler's result.

```typescript
import { preventDefault } from '@isikk/core'

const onSubmit = preventDefault(async (event: Event) => {
  await submitForm()
})

form.addEventListener('submit', onSubmit)
```

## isPathMatched

Checks whether a pathname matches a given pattern, unless it first matches one of a caller-supplied list of exempt patterns (checked first, and short-circuits to `false`). Framework-agnostic - this is the matching logic behind [`runProxyIfPathMatches`](next/middleware.md), which adapts it to Next.js's `NextRequest`.

```typescript
import { isPathMatched } from '@isikk/core'

isPathMatched('/posts/1', /^\/posts/) // true
isPathMatched('/users/1', /^\/posts/) // false
isPathMatched('/posts/_next/chunk', /^\/posts/, [/_next/]) // false - exempt pattern wins
```

## raises

Builds a function that always throws the given error when called, ignoring any arguments - a stand-in for a callback slot that should never actually be reached (a default `onError`, an unimplemented branch), or for tests.

```typescript
import { raises } from '@isikk/core'

const notImplemented = raises(new Error('not implemented'))
doSomething({ onError: notImplemented })
```

## cloned

Wraps `fn` in a fresh function that delegates to it, leaving `fn` itself untouched - needed when applying a mutating helper (like `withAttributes`) to the same base function more than once, since each call would otherwise mutate the same underlying function object.

```typescript
import { cloned, withAttributes } from '@isikk/core'

function original() {}

const foo = withAttributes(cloned(original), { tag: 'foo' })
const bar = withAttributes(cloned(original), { tag: 'bar' })
// foo.tag === 'foo', bar.tag === 'bar', original itself has no `tag`
```

## enabledIf

`enabledIf(condition, { ifNotEnabledReturnValue })` builds a decorator: applied to a function, it returns that function unchanged when `condition` is truthy, or a function that always returns `ifNotEnabledReturnValue` when falsy. `condition` may be a boolean or a zero-argument function, evaluated once at wrap time, not on every call.

```typescript
import { enabledIf } from '@isikk/core'

const trackEvent = enabledIf(process.env.ANALYTICS_ENABLED === 'true', { ifNotEnabledReturnValue: undefined })(
  (name: string) => analytics.track(name)
)
```

- Both branches return a [`cloned`](#cloned) function, never the original - stacking another mutating decorator on top of the result never affects the function you passed in.

## transformExceptions

Wraps a function so that if it throws one of the given error types, the error is caught and re-thrown as a different one - built via a `transform` callback you provide. The original error is chained onto the new one's [`cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) by default, so nothing about the original failure is lost; pass `{ keepOriginal: false }` to suppress that.

```typescript
import { transformExceptions } from '@isikk/core'

class ParseError extends Error {}

const parse = transformExceptions(
  [SyntaxError],
  (error) => new ParseError(`Could not parse config: ${error.message}`)
)((raw: string) => JSON.parse(raw))

parse('not json') // throws ParseError, with the original SyntaxError as .cause
```

- Only errors matching one of the given types are transformed - anything else propagates unchanged.
- Synchronous only, like [`suppress`](#suppress) - it doesn't catch rejections from a returned `Promise`.
