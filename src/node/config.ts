import type { Caster } from './casters'

export class ConfigError extends Error {}

type Schema = { [key: string]: Caster<unknown> | Schema }

type InferConfig<S> = {
  [K in keyof S]: S[K] extends Caster<infer T> ? T : S[K] extends Schema ? InferConfig<S[K]> : never
}

function isCaster(value: unknown): value is Caster<unknown> {
  return typeof value === 'function'
}

function environmentKey(prefix: string | undefined, path: string[], sep: string): string {
  return [...(prefix ? [prefix] : []), ...path].join(sep)
}

function readLeaf<T>(leafCaster: Caster<T>, key: string): T {
  const rawValue = process.env[key]

  if (rawValue === undefined) {
    if ('missingDefault' in leafCaster) {
      return leafCaster.missingDefault as T
    }
    throw new ConfigError(
      `Environment variable ${key} not found. Please set it or provide a missingDefault to your caster.`
    )
  }

  try {
    return leafCaster(rawValue)
  } catch (error) {
    if ('errorDefault' in leafCaster) {
      return leafCaster.errorDefault as T
    }
    throw new ConfigError(
      `Error while parsing ${key}=${JSON.stringify(rawValue)}: ${error instanceof Error ? error.message : String(error)}. ` +
        'Please check the value and the caster, or provide an errorDefault to your caster.'
    )
  }
}

function build<S extends Schema>(schema: S, path: string[], prefix: string | undefined, sep: string): InferConfig<S> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    const keyPath = [...path, key]
    result[key] = isCaster(value)
      ? readLeaf(value, environmentKey(prefix, keyPath, sep))
      : build(value, keyPath, prefix, sep)
  }
  return result as InferConfig<S>
}

export function config<S extends Schema>(schema: S, options: { prefix?: string; sep?: string } = {}): InferConfig<S> {
  const { prefix, sep = '__' } = options
  return build(schema, [], prefix, sep)
}
