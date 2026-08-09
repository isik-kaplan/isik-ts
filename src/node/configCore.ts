import type { Caster } from './casters'
import { ConfigError } from './configError'

export type ConfigSchema = { [key: string]: Caster<unknown> | ConfigSchema }

export type InferConfig<S> = {
  [K in keyof S]: S[K] extends Caster<infer T> ? T : S[K] extends ConfigSchema ? InferConfig<S[K]> : never
}

export interface ConfigOptions {
  /** Prepended to every environment variable name this call reads, joined with `sep`. */
  prefix?: string
  /** Joins the prefix and the nested key path into a variable name. Defaults to `"__"`. */
  sep?: string
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

/**
 * Walks the schema and reads every leaf out of `process.env`. Shared by `config()` and by the
 * server half of `publicConfig()` so the two agree on variable naming and on the
 * `missingDefault`/`errorDefault` fallback rules by construction rather than by duplication.
 * Claims no namespace of its own - that is the caller's job, and the two callers claim different
 * kinds.
 */
export function buildConfig<S extends ConfigSchema>(
  schema: S,
  prefix: string | undefined,
  sep: string,
  path: string[] = []
): InferConfig<S> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    const keyPath = [...path, key]
    result[key] = isCaster(value)
      ? readLeaf(value, environmentKey(prefix, keyPath, sep))
      : buildConfig(value, prefix, sep, keyPath)
  }
  return result as InferConfig<S>
}
