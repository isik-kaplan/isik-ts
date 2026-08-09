import type { ConfigSchema, InferConfig } from '../../node/configCore'
import { ConfigError } from '../../node/configError'
import { type PublicConfig, type PublicConfigOptions, globalKeyFor, lazyConfigProxy, memoize } from './shared'

/**
 * The browser half of `publicConfig()`, substituted for the server module by the `browser`
 * export condition in package.json rather than branched to at runtime. That substitution is what
 * makes the split safe: this file contains no reference to `process.env` at all, so bundling the
 * config module for the client cannot ship a server value no matter what the schema says. It is a
 * property of what the file contains, not a discipline anyone has to maintain.
 *
 * The schema argument is accepted and ignored - values arrive already cast, through the injected
 * global. It stays in the signature so `InferConfig<S>` produces the identical type on both
 * sides, which is what lets one `app/config.ts` be imported by server and client components
 * alike.
 */
export function publicConfig<S extends ConfigSchema>(_schema: S, options: PublicConfigOptions = {}): PublicConfig<S> {
  const globalKey = globalKeyFor(options.prefix ?? '')

  return {
    CONFIG: lazyConfigProxy<InferConfig<S>>(memoize(() => readInjectedConfig<S>(globalKey))),
    // Injection is a server-render concern; there is nothing to emit once the document exists.
    PublicConfigScript: () => null,
  }
}

function readInjectedConfig<S extends ConfigSchema>(globalKey: string): InferConfig<S> {
  const injected = (globalThis as unknown as Record<string, unknown>)[globalKey]

  if (injected === undefined) {
    throw new ConfigError(
      `window.${globalKey} is not set, so there is no public config to read. Render <PublicConfigScript /> ` +
        'once in your root layout (inside a <Suspense> boundary if Cache Components is enabled). If this is a ' +
        'test or a non-Next renderer, assign the object yourself before anything reads the config.'
    )
  }

  return injected as InferConfig<S>
}
