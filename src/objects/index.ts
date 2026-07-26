export function checkRequiredKeys<T extends Record<string, unknown>, C extends Record<string, Array<keyof T>>>(
  obj: T,
  conditions: C
): keyof C {
  const matchingConditions = Object.entries(conditions).filter(
    ([, keys]) =>
      keys.every((key) => obj[key] !== undefined) &&
      Object.keys(obj).every((key) => keys.includes(key as keyof T) || obj[key] === undefined)
  )

  if (matchingConditions.length !== 1) {
    throw new Error(`Object keys do not match exactly one required condition. ${JSON.stringify(conditions)}`)
  }

  return matchingConditions[0][0] as keyof C
}

export function requireExclusiveKeys<T extends Record<string, unknown>, C extends Record<string, Array<keyof T>>>(
  conditions: C,
  options: { allowEmpty?: boolean } = {}
) {
  const conditionEntries = Object.entries(conditions) as Array<[string, Array<keyof T>]>
  if (conditionEntries.length === 0) {
    throw new Error('At least one condition must be provided.')
  }
  const { allowEmpty = false } = options
  const governedKeys = new Set(conditionEntries.flatMap(([, keys]) => keys))

  return function <Fn extends (arg: T) => unknown>(fn: Fn): Fn {
    return ((arg: T) => {
      // Only keys that are actually governed by a condition are considered - unlike
      // checkRequiredKeys, any other key on `arg` is fully unconstrained and ignored here
      // regardless of its value, since this is meant to validate one options object that may
      // legitimately carry other, unrelated fields alongside the mutually-exclusive ones.
      const provided = new Set(
        Object.keys(arg).filter((key) => governedKeys.has(key as keyof T) && arg[key] !== undefined)
      )

      if (allowEmpty && provided.size === 0) {
        return fn(arg)
      }

      const matches = conditionEntries.filter(
        ([, keys]) => keys.length === provided.size && keys.every((key) => provided.has(key as string))
      )
      if (matches.length !== 1) {
        throw new Error(`Object keys do not match exactly one required condition. ${JSON.stringify(conditions)}`)
      }
      return fn(arg)
    }) as Fn
  }
}

export function setKeyValueToObjectIfValue(key: string, value: unknown, object: Record<string, unknown>) {
  if (value) {
    // Object.defineProperty (unlike a plain `object[key] = value` assignment) always creates/
    // overwrites an own property, even when key is "__proto__" - a plain assignment would instead
    // be intercepted by Object.prototype's special __proto__ accessor and reassign this object's
    // prototype instead of setting a property on it.
    Object.defineProperty(object, key, { value, writable: true, configurable: true, enumerable: true })
  }
}
