// The storage seam. An adapter stores records - a string key, a JSON value, and string index values the
// core computed - in named tables, and ranges over them by string. It knows nothing about rows, scopes
// or the outbox, so IndexedDB, SQLite and memory each stay small enough to share one contract suite.

/** A table and the names of its secondary indexes. An index name is a JavaScript identifier. */
export interface TableDef {
  name: string
  indexes: readonly string[]
}

/** A stored record's index values by index name. An absent or undefined value leaves it out of that index. */
export type IndexValues = Readonly<Record<string, string | undefined>>

export interface StoredRecord<V = unknown> {
  key: string
  value: V
}

/**
 * A range over a table's keys, or over one index's values: bounds are inclusive unless marked open.
 * Results come ordered by the index value, then the key - descending with `reverse`.
 */
export interface RangeQuery {
  index?: string
  lower?: string
  upper?: string
  lowerOpen?: boolean
  upperOpen?: boolean
  offset?: number
  limit?: number
  reverse?: boolean
}

export type CountQuery = Pick<RangeQuery, 'index' | 'lower' | 'upper' | 'lowerOpen' | 'upperOpen'>

/**
 * The operations a transaction offers. Every one is asynchronous, and the transaction ends once a
 * macrotask passes with none outstanding - IndexedDB's rule, which every adapter keeps. So awaiting
 * anything but the store (a fetch, a timer) inside one ends it, and the next operation throws
 * `TransactionInactiveError`.
 */
export interface StoreTx {
  get<V = unknown>(table: string, key: string): Promise<V | undefined>
  put(table: string, key: string, value: unknown, index?: IndexValues): Promise<void>
  delete(table: string, key: string): Promise<void>
  clear(table: string): Promise<void>
  range<V = unknown>(table: string, query?: RangeQuery): Promise<StoredRecord<V>[]>
  count(table: string, query?: CountQuery): Promise<number>
}

export type TxMode = 'readonly' | 'readwrite'

export interface Store {
  /** Runs `fn` in one transaction over `tables`: all of its writes commit, or - when it throws - none. */
  transaction<T>(tables: readonly string[], mode: TxMode, fn: (tx: StoreTx) => Promise<T>): Promise<T>
  close(): void
}

export interface StoreAdapter {
  /**
   * Opens - creating as needed - the database `name` with exactly these tables. A table that is no
   * longer listed is dropped. An index added to an existing table starts empty and fills as records
   * are put again; one removed is forgotten. Records survive both.
   */
  open(name: string, tables: readonly TableDef[]): Promise<Store>
  /** Deletes the database `name` and everything in it. */
  deleteDatabase(name: string): Promise<void>
}

export class TransactionInactiveError extends Error {
  constructor() {
    super(
      'sync store: the transaction has already finished - something other than the store was awaited ' +
        'inside it, and only store operations may be'
    )
    this.name = 'TransactionInactiveError'
  }
}

/**
 * IndexedDB's lifetime rule, for an adapter whose backend has none of its own: the transaction stays
 * active while an operation is outstanding, and for the rest of the macrotask after the last one
 * settles. `run` wraps each operation.
 */
export function createTxGuard() {
  let active = true
  let outstanding = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function armExpiry() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      // Stryker disable next-line ConditionalExpression: an operation started since re-arms the timer, so one never fires with any outstanding
      if (outstanding === 0) active = false
    })
  }
  armExpiry()

  return {
    async run<T>(operation: () => T | Promise<T>): Promise<T> {
      if (!active) throw new TransactionInactiveError()
      outstanding += 1
      clearTimeout(timer)
      try {
        return await operation()
      } finally {
        outstanding -= 1
        armExpiry()
      }
    },
    end() {
      clearTimeout(timer)
      active = false
    },
  }
}

/** Runs tasks one after another, each starting when the one before it settles. */
export function createMutex() {
  let tail: Promise<unknown> = Promise.resolve()
  return function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task)
    tail = result.catch(() => undefined)
    return result
  }
}

/** Whether `value` lies inside the query's bounds. */
export function inBounds(value: string, query: CountQuery): boolean {
  const { lower, upper, lowerOpen, upperOpen } = query
  // Stryker disable next-line ConditionalExpression: comparing a string with undefined is false either way
  if (lower !== undefined && (lowerOpen ? value <= lower : value < lower)) return false
  // Stryker disable next-line ConditionalExpression: comparing a string with undefined is false either way
  if (upper !== undefined && (upperOpen ? value >= upper : value > upper)) return false
  return true
}
