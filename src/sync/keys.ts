// Index keys, encoded as strings whose plain string order is the order of the values they encode.
// The core computes them, so an adapter only ever indexes, compares and ranges over strings: IndexedDB,
// SQLite and memory then agree on what a query returns without each knowing JSON's types.
//
// One component is a type tag, then its payload, then TERMINATOR. Tags order types the way IndexedDB
// does for the ones it has - null, booleans, numbers, strings - and put anything else (an object, an
// array) last, as its JSON. No encoded character is ever NUL, which some SQLite bindings truncate at.

const TERMINATOR = '\u0001'
const ESCAPE = '\u0002'
const TAG_NULL = '\u0003'
const TAG_FALSE = '\u0004'
const TAG_TRUE = '\u0005'
const TAG_NUMBER = '\u0006'
const TAG_STRING = '\u0007'
const TAG_OTHER = '\u0008'

/** Above every encoded character: a prefix followed by it bounds every key that extends the prefix. */
export const AFTER_PREFIX = String.fromCharCode(0xffff)

// The three characters at or below ESCAPE are escaped into two, keeping their order and staying above
// TERMINATOR, so a string that is a prefix of another still sorts first.
function escapeString(value: string): string {
  let result = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    result += code <= 2 ? ESCAPE + String.fromCharCode(code + 2) : char
  }
  return result
}

// A float64's bits, flipped so their unsigned order is the numbers' order: a positive number gets its
// sign bit set, a negative one has every bit inverted. Sixteen hex digits keep that order as a string.
function encodeNumber(value: number): string {
  const view = new DataView(new ArrayBuffer(8))
  // -0 and 0 are one key, as they are one value to `===`.
  view.setFloat64(0, value === 0 ? 0 : value)
  const high = view.getUint32(0)
  const low = view.getUint32(4)
  const negative = high >>> 31 === 1
  const flippedHigh = negative ? ~high >>> 0 : (high | 0x80000000) >>> 0
  const flippedLow = negative ? ~low >>> 0 : low
  return flippedHigh.toString(16).padStart(8, '0') + flippedLow.toString(16).padStart(8, '0')
}

function encodeComponent(value: unknown): string {
  if (value === null || value === undefined) return TAG_NULL + TERMINATOR
  if (value === false) return TAG_FALSE + TERMINATOR
  if (value === true) return TAG_TRUE + TERMINATOR
  if (typeof value === 'number') {
    if (Number.isNaN(value)) throw new TypeError('sync: NaN cannot be an index key')
    return TAG_NUMBER + encodeNumber(value) + TERMINATOR
  }
  if (typeof value === 'string') return TAG_STRING + escapeString(value) + TERMINATOR
  return TAG_OTHER + escapeString(JSON.stringify(value)) + TERMINATOR
}

/** The key of a tuple of values. A tuple's key starts with the key of every prefix of it. */
export function encodeKey(values: readonly unknown[]): string {
  return values.map(encodeComponent).join('')
}
