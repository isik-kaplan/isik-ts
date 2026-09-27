# dates

Date formatting helpers built on top of [`date-fns`](https://date-fns.org/) - the only place in the package that depends on it. `date-fns`'s `format` is isolated behind an internal adapter (`src/dates/_format.ts`) so nothing else in the package touches it directly, and the public functions only ever take/return plain `Date`/`string` values.

All formatting happens in the runtime's **local** timezone, same as `date-fns`'s own `format`. A `Date` built from an ISO string like `new Date('2026-01-05')` is midnight **UTC**, so formatting it can print the previous day in negative-UTC-offset timezones - that's a property of `Date`/`format`, not something these helpers add or can paper over. Build dates from local components (`new Date(2026, 0, 5)`) when you want a timezone-independent example/test, as the examples below do.

## formattedDate

Formats a date using a `date-fns` pattern string. Defaults to the current date/time if none is given.

```typescript
import { formattedDate } from '@isikk/core'

formattedDate('yyyy-MM-dd', new Date(2026, 0, 5)) // '2026-01-05'
```

## longFormattedDate / shortFormattedDate / shortFormattedDateTime

Formats a date using one of this module's three exported default patterns:

```typescript
import { LONG_DATE_FORMAT, SHORT_DATETIME_FORMAT, SHORT_DATE_FORMAT } from '@isikk/core'
// "EEEE, MMMM dd, yyyy 'at' hh:mm a" / 'dd.MM.yyyy' / 'dd.MM.yyyy HH:mm a'
import { longFormattedDate, shortFormattedDate, shortFormattedDateTime } from '@isikk/core'

const date = new Date(2026, 0, 5, 14, 30)

longFormattedDate(date) // 'Monday, January 05, 2026 at 02:30 PM'
shortFormattedDate(date) // '05.01.2026'
shortFormattedDateTime(date) // '05.01.2026 14:30 PM' - note the 24-hour HH paired with a
// trailing AM/PM; that's the format string as ported from the original source, not a typo here
```

All three default to the current date/time when called with no argument, same as `formattedDate`.

## optionalDate

Parses a possibly-`undefined` date string, passing the `undefined` through instead of constructing an `Invalid Date`.

```typescript
import { optionalDate } from '@isikk/core'

optionalDate('2026-01-05T14:30:00Z') // Date
optionalDate(undefined) // undefined
```

## toDate

Reads a timestamp in any of the three shapes an API sends it in, with the unit of a number stated rather than remembered. allauth's session and passkey payloads carry epoch **seconds**, and forgetting the `* 1000` gives a date in January 1970 rather than an error.

```typescript
import { toDate } from '@isikk/core'

toDate(session.created_at, 'seconds') // epoch seconds
toDate(1767623400000) // milliseconds, the default - the same as `new Date(n)`
toDate('2026-01-05T14:30:00Z') // parsed as `new Date` would; the unit is ignored for a string
toDate(date) // a Date is returned as it came
```
