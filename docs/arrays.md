# arrays

## notNone

A predicate that's true for anything except `null`/`undefined` - including other falsy values like `0`, `''`, and `false`, which stay `true`. Written as a named predicate rather than an inline lambda so it reads well passed directly to `.filter()`/`.find()`.

```typescript
import { notNone } from '@isikk/core'

const values = [1, null, 0, undefined, 'x']
values.filter(notNone) // [1, 0, 'x'] - TypeScript also narrows the result to exclude null/undefined

const firstDefined = [null, null, 'x']
firstDefined.find(notNone) // 'x'
```

- If you already depend on [es-toolkit](https://es-toolkit.slash.page/), its `isNotNil` is the exact same predicate - this exists here mainly so a project depending only on `@isikk/core` doesn't need to pull in a whole utility library just for one predicate.

## allCombinations

Returns every non-empty subset (the powerset, minus the empty set) of an array's items, grouped by size ascending - all 1-item combinations first, then all 2-item combinations, and so on. Useful for generating test fixtures/permutations from a small option set.

```typescript
import { allCombinations } from '@isikk/core'

allCombinations(['a', 'b', 'c'])
// [['a'], ['b'], ['c'], ['a', 'b'], ['a', 'c'], ['b', 'c'], ['a', 'b', 'c']]
```

- For `n` items, produces `2^n - 1` combinations - grows fast, so this is meant for small option sets (a handful of items), not large arrays.
