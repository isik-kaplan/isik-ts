import { connection } from 'next/server'

import { type ConfigSchema, type InferConfig, buildConfig } from '../../node/configCore'
import { ConfigError } from '../../node/configError'
import { claimConfigNamespace } from '../../node/configRegistry'
// Imported by built path, and marked external in tsup.next-config.config.ts, so esbuild leaves
// the import alone instead of inlining insert.tsx into this bundle - which would concatenate
// modules ahead of its `'use client'` directive and destroy it.
import { PublicConfigInsert } from './insert.js'
import {
  type PublicConfig,
  type PublicConfigOptions,
  type PublicConfigScriptProps,
  lazyConfigProxy,
  memoize,
  requireGlobalKey,
  serializePublicConfigScript,
} from './shared'

// Re-exported so a schema can be written without importing `@isikk/core/node`. That entry
// point's barrel also carries `contextLocal` (async_hooks) and `getFileAsString` (fs), and the
// schema call site is shared with client components and edge routes by design - so importing
// casters from there drags Node builtins into bundles that have none, and the build fails. The
// casters themselves are pure `(value: string) => T` factories, safe in any runtime.
export * from '../../node/casters'
export { ConfigError } from '../../node/configError'
export type { ConfigSchema, InferConfig } from '../../node/configCore'
export type { PublicConfig, PublicConfigOptions, PublicConfigScriptComponent, PublicConfigScriptProps } from './shared'

/**
 * The browser-visible sibling of `config()`: same schema, same casters, same variable naming, but
 * the resolved values are serialized into the document so client components can read them at
 * runtime. Returns the config object plus the component that injects it, which the root layout
 * renders exactly once.
 *
 * Everything in `schema` ends up in the HTML of every page, in plaintext. The prefix claimed here
 * must not overlap one already claimed by `config()`, so a server-only key pasted into this
 * schema by mistake resolves to nothing and throws rather than getting published.
 *
 * `options.globalKey` is required - it names the `window` property the payload is injected under,
 * and there is no default to fall back to.
 *
 * Values are read per request, not baked in at build - which is the entire point next to
 * `NEXT_PUBLIC_*`, and what lets one image run in staging and production. Nothing resolves until
 * something reads it, so `next build` needs none of these variables set.
 */
export function publicConfig<S extends ConfigSchema>(schema: S, options: PublicConfigOptions): PublicConfig<S> {
  // Validated before the namespace is claimed, so a call that is going to throw anyway doesn't
  // leave a claim behind for the next call to collide with.
  const globalKey = requireGlobalKey(options)
  const { prefix, sep = '__' } = options

  const conflict = claimConfigNamespace({ kind: 'public', prefix: prefix ?? '', sep })
  if (conflict) {
    throw new ConfigError(conflict)
  }

  const resolve = memoize(() => buildConfig(schema, prefix, sep))

  async function PublicConfigScript({ nonce }: PublicConfigScriptProps) {
    // Opts the route out of static prerendering, so the values are read on the request rather
    // than frozen into the build output. Under Cache Components this has to sit inside a
    // <Suspense> boundary - see docs/next/config.md.
    await connection()
    return <PublicConfigInsert script={serializePublicConfigScript(globalKey, resolve())} nonce={nonce} />
  }

  return {
    CONFIG: lazyConfigProxy<InferConfig<S>>(resolve),
    PublicConfigScript,
  }
}
