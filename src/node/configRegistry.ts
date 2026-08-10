/**
 * Process-wide record of which environment variable namespace each config call has claimed, so a
 * server-only `config()` and a browser-visible `publicConfig()` can be stopped from reading the
 * same one. That overlap is the mistake worth catching: with a shared namespace, a key pasted
 * into the public schema by accident resolves to the real server value and gets serialized into
 * the HTML of every page, silently. With disjoint namespaces it resolves to nothing and throws.
 *
 * Kept on `globalThis` under a `Symbol.for` key rather than in module scope because
 * `@isikk/core/node` and `@isikk/core/next/config` are separate tsup entries built
 * with `splitting: false` - a module-scoped registry would be duplicated into each bundle, giving
 * the two sides one registry each and so nothing to ever collide in.
 *
 * Claims are keyed by kind, so any number of `config()` calls (or any number of `publicConfig()`
 * calls) may share a namespace - two server reads of the same variable are harmless. Only a
 * server/public overlap is a conflict, which is also why re-registration is always safe: Next
 * evaluates the same module once per bundler layer (RSC, SSR, edge) and again on every Fast
 * Refresh, and every one of those repeats is the same kind claiming the same namespace.
 */
export type ConfigKind = 'server' | 'public'

export interface ConfigNamespace {
  kind: ConfigKind
  /** Empty string means "no prefix" - the root of the environment. */
  prefix: string
  sep: string
}

// Stryker disable next-line StringLiteral: equivalent as far as this module's own behavior goes -
// any distinct key works identically for read/write here. The specific, namespaced string only
// matters for avoiding a collision with unrelated code that also stashes state on `globalThis`
// via `Symbol.for`, which isn't something a test *of this module* can observe or verify.
const REGISTRY_KEY = Symbol.for('@isikk/core/config-namespace-registry')

const CALL_NAME: Record<ConfigKind, string> = {
  server: 'config()',
  public: 'publicConfig()',
}

function getRegistry(): ConfigNamespace[] {
  const host = globalThis as unknown as Record<symbol, ConfigNamespace[] | undefined>
  const existing = host[REGISTRY_KEY]
  if (existing) {
    return existing
  }
  const created: ConfigNamespace[] = []
  host[REGISTRY_KEY] = created
  return created
}

/**
 * Two namespaces overlap when one can produce an environment variable name the other can also
 * produce. Identical prefixes always overlap. A prefix nested under another at a separator
 * boundary overlaps too (`APP` and `APP__PUBLIC` both reach `APP__PUBLIC__TOKEN`).
 *
 * An absent prefix is deliberately treated as disjoint from every non-empty one rather than as
 * the root that technically contains them all: unprefixed server config alongside prefixed public
 * config is the most natural setup there is, and the only way it actually collides is a server
 * schema with a top-level key named exactly like the public prefix. Rejecting the whole shape to
 * catch that would cost far more than it buys - docs/next/config.md says so out loud.
 */
function namespacesOverlap(a: ConfigNamespace, b: ConfigNamespace): boolean {
  if (a.prefix === b.prefix) {
    return true
  }
  if (a.prefix === '' || b.prefix === '') {
    return false
  }
  return a.prefix.startsWith(`${b.prefix}${b.sep}`) || b.prefix.startsWith(`${a.prefix}${a.sep}`)
}

function describeNamespace(namespace: ConfigNamespace): string {
  return namespace.prefix === '' ? 'no prefix' : `prefix ${JSON.stringify(namespace.prefix)}`
}

function sameNamespace(a: ConfigNamespace, b: ConfigNamespace): boolean {
  // Stryker disable next-line ConditionalExpression: equivalent mutant on the `kind` comparison
  // specifically. Every caller of this function only ever compares entries the earlier conflict
  // check in claimConfigNamespace has already let through - and that check has already returned
  // for any existing entry of a *different* kind whose prefix overlaps claim's, and an equal
  // prefix always overlaps (namespacesOverlap's first check) - so an existing entry with a
  // matching prefix reaching here is guaranteed to already be the same kind. Checking `kind`
  // again can't change it.
  return a.kind === b.kind && a.prefix === b.prefix && a.sep === b.sep
}

/**
 * Records `claim`, returning `null` when it is allowed or an explanatory message when it overlaps
 * a namespace already claimed by the other kind. Returns the message instead of throwing so each
 * entry point can throw its own bundled copy of `ConfigError`, keeping `instanceof` working
 * against the class imported from the same entry point the call came from.
 */
export function claimConfigNamespace(claim: ConfigNamespace): string | null {
  const registry = getRegistry()

  for (const existing of registry) {
    if (existing.kind !== claim.kind && namespacesOverlap(existing, claim)) {
      return (
        `${CALL_NAME[claim.kind]} was called with ${describeNamespace(claim)}, but ` +
        `${CALL_NAME[existing.kind]} already claimed ${describeNamespace(existing)} - they would read ` +
        'the same environment variable namespace, so a key added to the public schema can resolve to ' +
        'a server-only value and be serialized into the browser. Give one of them a prefix the other ' +
        'does not use.'
      )
    }
  }

  const alreadyClaimed = registry.some((existing) => sameNamespace(existing, claim))
  if (!alreadyClaimed) {
    registry.push(claim)
  }

  return null
}

/** Test-only reset. Deliberately not re-exported from any of the package's public entry points. */
export function resetConfigNamespaces(): void {
  getRegistry().length = 0
}

/**
 * Test-only: number of currently-registered claims, so the growth-prevention in
 * `claimConfigNamespace` (a repeated identical claim - e.g. from Next Fast Refresh re-evaluating
 * the same `config()` call - must not grow the registry) is verifiable without exposing the
 * registry's contents. Deliberately not re-exported from any of the package's public entry points.
 */
export function configNamespaceCount(): number {
  return getRegistry().length
}

/**
 * Test-only: removes the registry from `globalThis` entirely, so the next call that touches it
 * re-creates it from scratch - lets a test observe the freshly-created registry's initial value
 * without duplicating the `Symbol.for` key string. Deliberately not re-exported from any of the
 * package's public entry points.
 */
export function deleteConfigNamespaceRegistry(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[REGISTRY_KEY]
}
