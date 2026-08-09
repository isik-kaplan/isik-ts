import { type ConfigOptions, type ConfigSchema, type InferConfig, buildConfig } from './configCore'
import { ConfigError } from './configError'
import { claimConfigNamespace } from './configRegistry'

export { ConfigError } from './configError'
export type { ConfigOptions, ConfigSchema, InferConfig } from './configCore'

/**
 * Builds a typed config object by reading and casting environment variables against a schema,
 * throwing `ConfigError` when a required variable is missing or a value doesn't parse (unless the
 * caster for that key was given a `missingDefault`/`errorDefault`).
 *
 * Values read here are server-only: nothing in this module serializes them anywhere. Claims its
 * prefix as a server namespace, so a `publicConfig()` call that would read the same variable
 * names throws instead of quietly publishing them - see `@isikk/core/next/config`.
 */
export function config<S extends ConfigSchema>(schema: S, options: ConfigOptions = {}): InferConfig<S> {
  const { prefix, sep = '__' } = options

  const conflict = claimConfigNamespace({ kind: 'server', prefix: prefix ?? '', sep })
  if (conflict) {
    throw new ConfigError(conflict)
  }

  return buildConfig(schema, prefix, sep)
}
