import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Reads the protocol fixtures and matches responses against them, by PROTOCOL.md's rules.

export const FIXTURE_DIR = join(__dirname, '../../../protocol/sync/v1/fixtures')

export interface Fixture {
  name: string
  description: string
  given: {
    user: string | null
    memberships: string[]
    rows: Record<string, Record<string, unknown>[]>
    push?: { max_entries?: number; max_bytes?: number }
  }
  steps: (
    | {
        request: {
          method: string
          path: string
          query?: Record<string, string>
          headers?: Record<string, string>
          body?: unknown
        }
        response: { status: number; headers?: Record<string, string>; body?: unknown }
      }
    | { act: Record<string, Record<string, unknown>> }
  )[]
}

export function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture)
}

const PLACEHOLDER = /^\$([a-z]+):(.+)$/

export class Bindings {
  readonly values = new Map<string, unknown>()

  /** A request's placeholders replaced by their bound values. */
  fill<T>(value: T): T {
    if (typeof value === 'string') {
      if (PLACEHOLDER.test(value)) {
        if (!this.values.has(value)) throw new Error(`unbound placeholder ${value}`)
        return this.values.get(value) as T
      }
      return value
    }
    if (Array.isArray(value)) return value.map((item) => this.fill(item)) as T
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.fill(v)])) as T
    }
    return value
  }

  /** Throws, naming the path, when `actual` does not match `expected`. */
  match(expected: unknown, actual: unknown, path = '$'): void {
    if (expected === '$any') return
    if (typeof expected === 'string') {
      const placeholder = PLACEHOLDER.exec(expected)
      if (placeholder !== null) {
        if (this.values.has(expected)) {
          if (this.values.get(expected) !== actual)
            throw new Error(`${path}: ${expected} was ${String(this.values.get(expected))}, now ${String(actual)}`)
          return
        }
        if (placeholder[1] === 'etag') {
          for (const [name, bound] of this.values) {
            if (name.startsWith('$etag:') && bound === actual) throw new Error(`${path}: ${expected} equals ${name}`)
          }
        }
        this.values.set(expected, actual)
        return
      }
    }
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.length !== expected.length) {
        throw new Error(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
      }
      expected.forEach((item, i) => this.match(item, actual[i], `${path}[${i}]`))
      return
    }
    if (expected !== null && typeof expected === 'object') {
      if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
        throw new Error(`${path}: expected an object, got ${JSON.stringify(actual)}`)
      }
      const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
      for (const key of keys) {
        if (!(key in expected))
          throw new Error(`${path}.${key}: unexpected, ${JSON.stringify((actual as Record<string, unknown>)[key])}`)
        if (!(key in actual)) throw new Error(`${path}.${key}: missing`)
        this.match(
          (expected as Record<string, unknown>)[key],
          (actual as Record<string, unknown>)[key],
          `${path}.${key}`
        )
      }
      return
    }
    if (expected !== actual)
      throw new Error(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
