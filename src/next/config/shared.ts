import type { ReactNode } from 'react'

import type { ConfigSchema, InferConfig } from '../../node/configCore'
import { ConfigError } from '../../node/configError'

export interface PublicConfigOptions {
  /** Prepended to every environment variable name this call reads, joined with `sep`. */
  prefix?: string
  /** Joins the prefix and the nested key path into a variable name. Defaults to `"__"`. */
  sep?: string
  /**
   * The property the payload is injected under on `window`. Defaults to a name derived from
   * `prefix`. Set it to run two public configs off one prefix, to keep two copies of the package
   * in one page from reading each other's payload, or just to own the name yourself.
   */
  globalKey?: string
}

export interface PublicConfigScriptProps {
  /** Forwarded to the injected `<script>` so a CSP with a per-request nonce keeps working. */
  nonce?: string
}

export type PublicConfigScriptComponent = (props: PublicConfigScriptProps) => ReactNode | Promise<ReactNode>

export interface PublicConfig<S extends ConfigSchema> {
  CONFIG: InferConfig<S>
  PublicConfigScript: PublicConfigScriptComponent
}

export const GLOBAL_KEY_BASE = '__ISIK_PUBLIC_CONFIG__'

/**
 * Decides the property the payload is injected under, from an explicit `globalKey` or else from
 * `prefix` - which namespaces the default, so two `publicConfig()` calls on different prefixes
 * land on different properties instead of the second one silently declining to overwrite the
 * first.
 *
 * Both halves of the module resolve the key through this one function, from the same options
 * object: the schema and options live at a single call site in the consuming app, and only the
 * library import flips between builds. That is what makes the two sides agree by construction -
 * a server that wrote one key and a browser that read another would fail with nothing to point
 * at.
 *
 * No character restrictions: the key is emitted as an escaped string literal and read back with
 * bracket notation, so anything goes. An empty string is rejected only because it is far more
 * likely to be an accident than an intent.
 */
export function resolveGlobalKey(options: PublicConfigOptions): string {
  if (options.globalKey !== undefined) {
    if (options.globalKey === '') {
      throw new ConfigError('publicConfig: globalKey cannot be an empty string. Omit it to derive one from prefix.')
    }
    return options.globalKey
  }

  const prefix = options.prefix ?? ''
  return prefix === '' ? GLOBAL_KEY_BASE : `${GLOBAL_KEY_BASE}${prefix}__`
}

/**
 * Encodes a string as a JavaScript string literal that is safe to interpolate into a `<script>`
 * body. `JSON.stringify` alone is not: `</script>` inside a value closes the tag early and drops
 * the rest of the payload into the document as markup, and U+2028/U+2029 are literal line
 * terminators in JavaScript source, so a value containing one produces a syntax error. Escaping
 * `<` covers the first (the sequence can no longer be written) and the two explicit replacements
 * cover the second. `>` and `&` need no handling - a script element is raw text, so nothing in it
 * is parsed as markup or entities once `<` can't start a closing tag.
 */
export function jsStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * The script that hands the resolved config to the browser. Values travel as a JSON string parsed
 * at runtime rather than as an object literal: it parses faster than equivalent JS source, and it
 * narrows everything that needs escaping down to the single quoted string handled above.
 *
 * The definition is deep-frozen and non-writable, so nothing can reshape config after hydration,
 * and re-entrant if the script somehow runs twice - redefining a non-configurable property would
 * throw, so an existing key means there is nothing left to do.
 */
export function serializePublicConfigScript(key: string, value: unknown): string {
  return (
    '(function(w,k,v){if(k in w)return;' +
    'var f=function(o){if(o&&typeof o=="object"){for(var p in o)f(o[p]);Object.freeze(o)}};' +
    'f(v);Object.defineProperty(w,k,{value:v,enumerable:true})})' +
    `(window,${jsStringLiteral(key)},JSON.parse(${jsStringLiteral(JSON.stringify(value))}))`
  )
}

export function memoize<T>(resolve: () => T): () => T {
  let value: T
  let resolved = false
  return () => {
    if (!resolved) {
      value = resolve()
      resolved = true
    }
    return value
  }
}

/**
 * Presents `resolve()`'s result as a plain object without calling it until something is actually
 * read. That deferral is load-bearing on both sides of the package. On the server it keeps
 * `next build` from resolving anything while collecting page data, so a missing variable no
 * longer fails the build - "can this build" stops depending on "is this configured". In the
 * browser it means the injected global is read at access time rather than at chunk-evaluation
 * time, so an async chunk that happens to run before the inline script still sees the config.
 */
export function lazyConfigProxy<T>(resolve: () => T): T {
  return new Proxy({} as object, {
    get: (_target, property) => Reflect.get(resolve() as object, property),
    has: (_target, property) => Reflect.has(resolve() as object, property),
    ownKeys: () => Reflect.ownKeys(resolve() as object),
    getOwnPropertyDescriptor: (_target, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve() as object, property)
      // The proxy target is an empty object, and a proxy may not report a non-configurable
      // property that its target doesn't have - so re-mark descriptors as configurable, or
      // Object.keys()/JSON.stringify() over the config throw a TypeError.
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true }
    },
  }) as T
}
