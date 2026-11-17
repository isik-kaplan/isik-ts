import { emit } from './emit'
import { type KeyRule, modelOf, renamed } from './model'

export type { KeyRule } from './model'

export interface GenerateOptions {
  /** Where the openapi-typescript output is, as the client file imports it. Default `'./schema'`. */
  types?: string
  /**
   * Which writes must name their `Idempotency-Key`:
   * - `'every-write'` (default): every POST, PUT, PATCH and DELETE.
   * - `'declared'`: those whose operation declares the header - isik's own per-action exemptions.
   * - `'minted'`: none; a write that names none gets a fresh key.
   */
  keys?: KeyRule
  /** Taken off the front of each path before naming its resource. Default: what every path shares. */
  stripPrefix?: string
  /**
   * Plural names for the collection actions that GET a list - `users/history/` is `histories()` beside
   * one user's `history(id)`. Default `true`.
   */
  plurals?: boolean
  /** Only the paths that start with this: one client of several a document serves (`/v0/browser/`). */
  include?: string
  /**
   * The project's own names for what the generator named: `{ 'users.collectionHistory': 'histories' }`
   * renames a member, `{ users: 'people' }` a resource. A name that does not exist is an error.
   */
  renames?: Record<string, string>
  /**
   * The response header the client reports as `onRequest`'s `correlationId`: the one the server
   * echoes the request's correlation id in. Default `'X-Request-Id'`, isik's.
   */
  correlationHeader?: string
  /** Named in the generated file's header. */
  source?: string
}

export interface Generated {
  code: string
  /** Names that clashed and what they became instead. */
  warnings: string[]
}

/** The client for `document`, an OpenAPI document already parsed from its JSON or YAML. */
export function generateClient(document: unknown, options: GenerateOptions = {}): Generated {
  const keys = options.keys ?? 'every-write'
  if (!['every-write', 'declared', 'minted'].includes(keys)) {
    throw new TypeError(`codegen: keys must be every-write, declared or minted, not ${JSON.stringify(keys)}`)
  }
  const model = renamed(modelOf(document, options.stripPrefix, options.include, options.plurals), options.renames ?? {})
  return {
    code: emit(model, {
      types: options.types ?? './schema',
      keys,
      correlationHeader: options.correlationHeader ?? 'X-Request-Id',
      source: options.source,
    }),
    warnings: model.warnings,
  }
}
