import type { ConfigSchema, InferConfig } from '../../node/configCore'
import { ConfigError } from '../../node/configError'
import { type PublicConfig, type PublicConfigOptions, lazyConfigProxy, memoize, requireGlobalKey } from './shared'

// Mirrors the server half's re-export, so the shared schema call site resolves the same caster
// names in the browser bundle. Pure functions, no environment access - see index.tsx for why they
// cannot be imported from `@isikk/core/node` here.
export * from '../../node/casters'
export { ConfigError } from '../../node/configError'
export type { ConfigSchema, InferConfig } from '../../node/configCore'
export type { PublicConfig, PublicConfigOptions, PublicConfigScriptComponent, PublicConfigScriptProps } from './shared'

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
 * alike. `options.globalKey` is not ignored: it is the only thing this half needs, and it is read
 * from the same options object the server half was given.
 */
export function publicConfig<S extends ConfigSchema>(_schema: S, options: PublicConfigOptions): PublicConfig<S> {
  const globalKey = requireGlobalKey(options)

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
