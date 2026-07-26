export function withAttributes<Fn extends (...args: never[]) => unknown, Attrs extends Record<string, unknown>>(
  fn: Fn,
  attributes: Attrs
): Fn & Attrs {
  for (const key of Object.keys(attributes)) {
    // Object.defineProperty (unlike a plain `fn[key] = value` assignment) always creates/
    // overwrites an own property, even when key is "__proto__" - a plain assignment would instead
    // be intercepted by Object.prototype's special __proto__ accessor and reassign fn's own
    // prototype instead of setting a property on it.
    Object.defineProperty(fn, key, {
      value: attributes[key],
      writable: true,
      configurable: true,
      enumerable: true,
    })
  }
  return fn as Fn & Attrs
}

export function makeCallable<T, R>(originalCallable: (arg: T) => R) {
  return (data: T) => () => originalCallable(data)
}

export function getLazyValue<T>(input: T | (() => T)): T {
  if (typeof input === 'function') {
    return (input as () => T)()
  }
  return input
}

export async function getLazyValueAsync<T>(input: T | (() => Promise<T>) | (() => T)): Promise<T> {
  if (typeof input === 'function') {
    const result = (input as () => Promise<T>)()
    if (result instanceof Promise) {
      return await result
    }
    return result as unknown as T
  }
  return input
}

export function suppress<T, ERT>(
  exceptions: Array<new (message?: string) => Error>,
  fn: () => T,
  onError?: (error: unknown) => ERT
): T | ERT | undefined {
  try {
    return fn()
  } catch (error) {
    if (exceptions.some((exception) => error instanceof exception)) {
      return onError ? onError(error) : undefined
    }
    throw error
  }
}

export function preventDefault<E extends Event, R>(callable: (event: E) => R): (event: E) => Promise<Awaited<R>> {
  return async function (event: E): Promise<Awaited<R>> {
    event.preventDefault()
    return await callable(event)
  }
}

export function isPathMatched(pathname: string, pattern: RegExp, exemptPatterns: RegExp[] = []): boolean {
  if (exemptPatterns.some((exempt) => exempt.test(pathname))) {
    return false
  }
  return pattern.test(pathname)
}

export function raises(error: Error): (...args: unknown[]) => never {
  return () => {
    throw error
  }
}

export function cloned<Fn extends (...args: never[]) => unknown>(fn: Fn): Fn {
  return ((...args: Parameters<Fn>) => fn(...args)) as Fn
}

export function enabledIf<R>(condition: boolean | (() => boolean), options: { ifNotEnabledReturnValue: R }) {
  const enabled = typeof condition === 'function' ? condition() : condition

  return function <Fn extends (...args: never[]) => R>(fn: Fn): Fn {
    if (!enabled) {
      return cloned((() => options.ifNotEnabledReturnValue) as Fn)
    }
    return cloned(fn)
  }
}

export function transformExceptions<E extends Error>(
  exceptionTypes: Array<new (...args: never[]) => E>,
  transform: (error: E) => Error,
  options: { keepOriginal?: boolean } = {}
) {
  const { keepOriginal = true } = options

  return function <Fn extends (...args: never[]) => unknown>(fn: Fn): Fn {
    return ((...args: Parameters<Fn>) => {
      try {
        return fn(...args)
      } catch (error) {
        if (!exceptionTypes.some((ExceptionType) => error instanceof ExceptionType)) {
          throw error
        }
        const newError = transform(error as E)
        if (keepOriginal) {
          newError.cause = error
        }
        throw newError
      }
    }) as Fn
  }
}
