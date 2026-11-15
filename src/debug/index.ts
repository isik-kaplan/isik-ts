/*
 * A developer console that is quiet until asked: namespaced loggers, one switch that survives a
 * reload, and a console patch that keeps every call flowing to whatever wraps the console after it -
 * Sentry's breadcrumbs - while deciding what reaches the screen.
 *
 * The switch follows the `debug` package: `localStorage.debug = 'app:*,-app:noisy'`.
 */

type Level = 'log' | 'info' | 'warn' | 'error' | 'debug'
type Entry = { namespace: string; method: string; args: unknown[] }

const STORAGE_KEY = 'debug'

type State = {
  pattern?: string
  buffer: Entry[]
  limit: number
  /** The console's own methods, kept by `quietConsole` to print through and to restore. */
  originals: Record<string, (...args: unknown[]) => void> | null
  /** The namespace of the logger calling the console right now, for the patch to judge. */
  calling: string | null
}

// One function for the first state and for a reset, so both are the same.
const fresh = (): State => ({ buffer: [], limit: 200, originals: null, calling: null })

const state: State = fresh()

// Storage can be missing, or throw on access, as in a sandboxed frame; either reads as off.
function stored(): string {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function activePattern(): string {
  state.pattern ??= stored()
  return state.pattern
}

/** Whether `namespace` is switched on: matched by a pattern, and not by a `-` one. */
export function isDebugEnabled(namespace: string): boolean {
  // An empty part, from separators side by side, matches no namespace, so it needs no filtering.
  const parts = activePattern().split(/[\s,]/)
  const matches = (part: string) =>
    new RegExp(`^${part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(namespace)
  const skipped = parts.filter((part) => part.startsWith('-')).some((part) => matches(part.slice(1)))
  return !skipped && parts.filter((part) => !part.startsWith('-')).some(matches)
}

function print(entry: Entry): void {
  const target = (state.originals ?? (globalThis.console as unknown as Record<string, (...args: unknown[]) => void>))[
    entry.method
  ]
  target.apply(globalThis.console, entry.args)
}

// A count below zero removes nothing.
function trim(): void {
  state.buffer.splice(0, state.buffer.length - state.limit)
}

function remember(entry: Entry): void {
  state.buffer.push(entry)
  trim()
}

/**
 * Switches debugging on (`true`, every namespace), off (`false`), or to a pattern (`'app:*,-app:sql'`),
 * and keeps it across reloads. What was held back while off and is now on is printed, in order.
 * With no argument, answers the pattern in force; `''` is off.
 */
export function debug(on?: boolean | string): string {
  if (on === undefined) return activePattern()
  const patterns: Record<string, string> = { true: '*', false: '' }
  state.pattern = typeof on === 'boolean' ? patterns[String(on)] : on
  try {
    if (state.pattern === '') globalThis.localStorage.removeItem(STORAGE_KEY)
    else globalThis.localStorage.setItem(STORAGE_KEY, state.pattern)
  } catch {
    // Storage refused - a private window, say. The switch still holds for this page.
  }
  const now = state.buffer.filter((entry) => isDebugEnabled(entry.namespace))
  state.buffer = state.buffer.filter((entry) => !isDebugEnabled(entry.namespace))
  for (const entry of now) print(entry)
  return state.pattern
}

export interface DebugOptions {
  /** How many held-back lines to keep for replay. Default 200; the oldest go first. */
  buffer?: number
}

/** Sets how many held-back lines are kept. */
export function configureDebug({ buffer }: DebugOptions): void {
  if (buffer !== undefined) {
    state.limit = buffer
    trim()
  }
}

export interface Logger {
  readonly namespace: string
  /** Whether this namespace prints right now. */
  readonly enabled: boolean
  log(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  debug(...args: unknown[]): void
  /**
   * Runs `fn` inside a console group headed `label`, and closes it when `fn` returns - or, for a
   * promise, when it settles. Answers what `fn` does.
   */
  group<T>(label: unknown, fn: () => T): T
  /** A logger for `namespace:sub`. */
  extend(sub: string): Logger
}

function emit(namespace: string, method: string, args: unknown[]): void {
  const entry = { namespace, method, args }
  if (state.originals !== null) {
    // Through the console as it stands, so whatever wraps it sees the call; the patch decides.
    state.calling = namespace
    try {
      ;(globalThis.console as unknown as Record<string, (...args: unknown[]) => void>)[method](...args)
    } finally {
      state.calling = null
    }
    return
  }
  if (isDebugEnabled(namespace)) print(entry)
  else remember(entry)
}

/** A logger for `namespace`, quiet unless the switch matches it. */
export function createDebug(namespace: string): Logger {
  const line =
    (level: Level) =>
    (...args: unknown[]) =>
      emit(namespace, level, [`[${namespace}]`, ...args])
  return {
    namespace,
    get enabled() {
      return isDebugEnabled(namespace)
    },
    log: line('log'),
    info: line('info'),
    warn: line('warn'),
    error: line('error'),
    debug: line('debug'),
    group<T>(label: unknown, fn: () => T): T {
      emit(namespace, 'group', [`[${namespace}]`, label])
      const close = () => emit(namespace, 'groupEnd', [])
      let result: T
      try {
        result = fn()
      } catch (error) {
        close()
        throw error
      }
      if (result instanceof Promise) return result.finally(close) as T
      close()
      return result
    },
    extend: (sub) => createDebug(`${namespace}:${sub}`),
  }
}

const PATCHED = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'table',
  'dir',
  'group',
  'groupCollapsed',
  'groupEnd',
]

export interface QuietConsoleOptions {
  /** The namespace a call from outside any logger falls under. Default `'console'`. */
  namespace?: string
}

/**
 * Patches the console so a call prints only while its namespace is switched on, and is held for
 * replay otherwise. Call it before anything that wraps the console - above `Sentry.init` - so the
 * wrapper adopts the patch as the console's own method: it still sees every call, as a breadcrumb,
 * and the patch decides what reaches the screen. A plain function, never an import side effect,
 * because that order is the mechanism. Answers a function that puts the console back.
 */
export function quietConsole({ namespace = 'console' }: QuietConsoleOptions = {}): () => void {
  const target = globalThis.console as unknown as Record<string, (...args: unknown[]) => void>
  if (state.originals !== null) return () => undefined
  const originals: Record<string, (...args: unknown[]) => void> = {}
  for (const method of PATCHED) {
    if (typeof target[method] !== 'function') continue
    originals[method] = target[method]
    target[method] = (...args: unknown[]) => {
      const entry = { namespace: state.calling ?? namespace, method, args }
      if (isDebugEnabled(entry.namespace)) originals[method].apply(target, args)
      else remember(entry)
    }
  }
  state.originals = originals
  return () => {
    Object.assign(target, originals)
    state.originals = null
  }
}

/** What a client generated by isikk-gen-client reports through its `onRequest` option. */
export type RequestEvent =
  | { phase: 'start'; id: number; method: string; path: string; url: string; idempotencyKey?: string; etag?: string }
  | {
      phase: 'end'
      id: number
      method: string
      path: string
      url: string
      status: number
      ok: boolean
      ms: number
      correlationId: string | null
    }
  | { phase: 'error'; id: number; method: string; path: string; url: string; ms: number; error: unknown }

/**
 * An `onRequest` for a generated client that logs each request through `logger`: a line when it
 * starts, and one with its status, time and request id when it ends.
 */
export function logRequests(logger: Logger): (event: RequestEvent) => void {
  return (event) => {
    const name = `${event.method.toUpperCase()} ${event.url}`
    if (event.phase === 'start') {
      const extra = { idempotencyKey: event.idempotencyKey, etag: event.etag }
      logger.debug(`→ ${name}`, ...(extra.idempotencyKey === undefined && extra.etag === undefined ? [] : [extra]))
    } else if (event.phase === 'end') {
      const id = event.correlationId === null ? '' : ` (${event.correlationId})`
      const line = `← ${event.status} ${name} ${event.ms}ms${id}`
      if (event.ok) logger.debug(line)
      else logger.warn(line)
    } else {
      logger.error(`✕ ${name} ${event.ms}ms`, event.error)
    }
  }
}

/** Forgets the switch and everything held back, and puts the console back. For tests. */
export function resetDebug(): void {
  Object.assign(globalThis.console, state.originals)
  delete state.pattern
  Object.assign(state, fresh())
}
