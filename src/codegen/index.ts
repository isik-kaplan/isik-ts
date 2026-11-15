import { emit } from './emit'
import { type KeyRule, modelOf } from './model'

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
  /** Taken off the front of each path before naming its resource. Default: what every resource shares. */
  stripPrefix?: string
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
  const model = modelOf(document, options.stripPrefix)
  return {
    code: emit(model, { types: options.types ?? './schema', keys, source: options.source }),
    warnings: model.warnings,
  }
}
