export type Caster<T> = ((value: string) => T) & { missingDefault?: T; errorDefault?: T }

export function caster<T>(fn: (value: string) => T) {
  return function (options: { missingDefault?: T; errorDefault?: T } = {}): Caster<T> {
    const clone = ((value: string) => fn(value)) as Caster<T>
    if ('missingDefault' in options) {
      clone.missingDefault = options.missingDefault
    }
    if ('errorDefault' in options) {
      clone.errorDefault = options.errorDefault
    }
    return clone
  }
}

// JS's Number()/parseInt()/parseFloat() don't throw on unparseable input the way Python's int()/
// float() do (parseInt('123abc') silently returns 123, Number('') silently returns 0) - these
// helpers add back the "either it's a clean, fully-parsed number or it throws" contract the
// missingDefault/errorDefault fallback system above depends on.
function parseStrictInteger(value: string): number {
  if (value.trim() === '' || !Number.isInteger(Number(value))) {
    throw new Error(`Value ${JSON.stringify(value)} can not be parsed into an integer.`)
  }
  return Number(value)
}

function parseStrictFloat(value: string): number {
  if (value.trim() === '' || Number.isNaN(Number(value))) {
    throw new Error(`Value ${JSON.stringify(value)} can not be parsed into a float.`)
  }
  return Number(value)
}

export const string = caster((value: string) => value)

export const integer = caster(parseStrictInteger)

export const float = caster(parseStrictFloat)

export const boolean = caster((value: string) => {
  const truthy = ['true', 'True', '1']
  const falsy = ['false', 'False', '0']
  if (truthy.includes(value)) {
    return true
  }
  if (falsy.includes(value)) {
    return false
  }
  throw new Error(`Value ${JSON.stringify(value)} can not be parsed into a boolean.`)
})

export const commaSeparatedList = caster((value: string) => value.split(','))

export const commaSeparatedIntList = caster((value: string) => value.split(',').map(parseStrictInteger))

export const commaSeparatedFloatList = caster((value: string) => value.split(',').map(parseStrictFloat))
