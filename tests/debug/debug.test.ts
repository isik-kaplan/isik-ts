import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  configureDebug,
  createDebug,
  debug,
  isDebugEnabled,
  logRequests,
  quietConsole,
  resetDebug,
} from '../../src/debug'

// Every console method the module touches, spied so nothing reaches the test output.
const METHODS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'group',
  'groupEnd',
  'trace',
  'table',
  'dir',
  'groupCollapsed',
] as const

function spyConsole() {
  return Object.fromEntries(METHODS.map((method) => [method, vi.spyOn(console, method).mockImplementation(() => {})]))
}

beforeEach(() => {
  resetDebug()
  localStorage.clear()
})

afterEach(() => {
  resetDebug()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the switch', () => {
  it('is off until set, and reads the debug package convention from storage', () => {
    expect(debug()).toBe('')
    expect(isDebugEnabled('app')).toBe(false)
    resetDebug()
    localStorage.setItem('debug', 'app:*,-app:sql other')
    expect(debug()).toBe('app:*,-app:sql other')
    // A negative is only a negative, and a positive's first letter is never dropped.
    debug('app,xapp')
    expect(isDebugEnabled('app')).toBe(true)
    debug('-a')
    expect([isDebugEnabled('-a'), isDebugEnabled('a')]).toEqual([false, false])
    debug('app:*,-app:sql other')
    expect(['app:api', 'app:sql', 'app', 'other', 'others', 'x'].map(isDebugEnabled)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
    ])
  })

  it('turns on and off, persisted, and takes a pattern', () => {
    expect(debug(true)).toBe('*')
    expect(localStorage.getItem('debug')).toBe('*')
    expect(isDebugEnabled('anything:at:all')).toBe(true)
    expect(debug('a.b+c')).toBe('a.b+c')
    expect([isDebugEnabled('a.b+c'), isDebugEnabled('aXbbc')]).toEqual([true, false])
    expect(debug(false)).toBe('')
    expect(localStorage.getItem('debug')).toBeNull()
  })

  it('holds for the page when storage refuses, or is not there at all', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(debug()).toBe('')
    expect(debug('app')).toBe('app')
    expect(isDebugEnabled('app')).toBe(true)
    resetDebug()
    vi.stubGlobal('localStorage', undefined)
    expect(debug()).toBe('')
    expect(debug(true)).toBe('*')
    resetDebug()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      },
    })
    expect(debug()).toBe('')
    expect(debug(false)).toBe('')
  })
})

describe('a logger', () => {
  it('prints with its namespace while on, and holds lines back while off', () => {
    const spies = spyConsole()
    const log = createDebug('app:api')
    expect([log.namespace, log.enabled]).toEqual(['app:api', false])
    log.info('quiet')
    expect(spies.info).not.toHaveBeenCalled()
    debug('app:*')
    expect(log.enabled).toBe(true)
    expect(spies.info).toHaveBeenCalledWith('[app:api]', 'quiet')
    log.log('a', 1)
    log.warn('w')
    log.error('e')
    log.debug('d')
    expect(spies.log).toHaveBeenCalledWith('[app:api]', 'a', 1)
    expect(spies.warn).toHaveBeenCalledWith('[app:api]', 'w')
    expect(spies.error).toHaveBeenCalledWith('[app:api]', 'e')
    expect(spies.debug).toHaveBeenCalledWith('[app:api]', 'd')
    expect(log.extend('sql').namespace).toBe('app:api:sql')
  })

  it('replays only what the new switch covers, in order, and keeps the rest', () => {
    const spies = spyConsole()
    createDebug('a').log(1)
    createDebug('b').log(2)
    createDebug('a').log(3)
    debug('a')
    expect(spies.log.mock.calls).toEqual([
      ['[a]', 1],
      ['[a]', 3],
    ])
    debug('a,b')
    expect(spies.log.mock.calls.at(-1)).toEqual(['[b]', 2])
    debug('a,b')
    expect(spies.log).toHaveBeenCalledTimes(3)
  })

  it('keeps only the newest lines, as many as configured', () => {
    const spies = spyConsole()
    const log = createDebug('a')
    configureDebug({ buffer: 3 })
    configureDebug({})
    for (const n of [1, 2, 3, 4]) log.log(n)
    debug(true)
    expect(spies.log.mock.calls).toEqual([
      ['[a]', 2],
      ['[a]', 3],
      ['[a]', 4],
    ])
    debug(false)
    for (const n of [5, 6, 7]) log.log(n)
    configureDebug({ buffer: 2 })
    debug(true)
    expect(spies.log.mock.calls.slice(3)).toEqual([
      ['[a]', 6],
      ['[a]', 7],
    ])
  })

  it('groups what a function logs, closing the group when it returns, throws, or settles', async () => {
    const spies = spyConsole()
    debug(true)
    const log = createDebug('ui')
    expect(log.group('Save', () => 7)).toBe(7)
    expect(() =>
      log.group('Fails', () => {
        throw new Error('boom')
      })
    ).toThrow('boom')
    await expect(
      log.group('Later', async () => {
        await null
        log.log('inside')
        return 8
      })
    ).resolves.toBe(8)
    await expect(log.group('Rejects', () => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(spies.group.mock.calls).toEqual([
      ['[ui]', 'Save'],
      ['[ui]', 'Fails'],
      ['[ui]', 'Later'],
      ['[ui]', 'Rejects'],
    ])
    expect(spies.groupEnd).toHaveBeenCalledTimes(4)
    expect(spies.groupEnd.mock.calls.every((call) => call.length === 0)).toBe(true)
    // An async group closes once it settles, after what it logged.
    expect(spies.log.mock.invocationCallOrder[0]).toBeLessThan(spies.groupEnd.mock.invocationCallOrder[2])
  })
})

describe('quietConsole', () => {
  it('lets a call through only while its namespace is on, and replays the rest', () => {
    const spies = spyConsole()
    const restore = quietConsole()
    console.log('from a library')
    console.table([1])
    expect(spies.log).not.toHaveBeenCalled()
    createDebug('app').warn('mine')
    expect(spies.warn).not.toHaveBeenCalled()
    debug('app')
    expect(spies.warn).toHaveBeenCalledWith('[app]', 'mine')
    expect(spies.log).not.toHaveBeenCalled()
    debug('app,console')
    expect(spies.log).toHaveBeenCalledWith('from a library')
    expect(spies.table).toHaveBeenCalledWith([1])
    console.info('now through')
    expect(spies.info).toHaveBeenCalledWith('now through')
    restore()
    expect(console.log).toBe(spies.log)
  })

  it('patches every console method that prints, and replays each', () => {
    const spies = spyConsole()
    quietConsole()
    for (const method of METHODS) (console[method] as (...args: unknown[]) => void)(method)
    for (const method of METHODS) expect(spies[method]).not.toHaveBeenCalled()
    debug('console')
    for (const method of METHODS) expect(spies[method]).toHaveBeenCalledWith(method)
  })

  it('forgets what was held back when the module resets', () => {
    const spies = spyConsole()
    createDebug('a').log('held')
    resetDebug()
    debug(true)
    expect(spies.log).not.toHaveBeenCalled()
  })

  it('sends every call through what wraps the console after it, as Sentry does', () => {
    const spies = spyConsole()
    quietConsole({ namespace: 'lib' })
    // A wrapper installed later, keeping the patch as "the original" and seeing every call first.
    const seen: unknown[][] = []
    const patched = console.log
    console.log = (...args: unknown[]) => {
      seen.push(args)
      patched(...args)
    }
    createDebug('app').log('quiet but seen')
    console.log('a library line')
    expect(seen).toEqual([['[app]', 'quiet but seen'], ['a library line']])
    expect(spies.log).not.toHaveBeenCalled()
    debug('lib')
    expect(spies.log).toHaveBeenCalledWith('a library line')
    expect(spies.log).not.toHaveBeenCalledWith('[app]', 'quiet but seen')
  })

  it('patches once, skips what the console lacks, and resets with the module', () => {
    spyConsole()
    const original = console.log
    vi.stubGlobal('console', { ...console, dir: undefined })
    const restore = quietConsole()
    expect(console.dir).toBeUndefined()
    expect(quietConsole()).not.toBe(restore)
    expect(quietConsole()()).toBeUndefined()
    resetDebug()
    expect(console.log).toBe(original)
  })
})

describe('logRequests', () => {
  it('logs a request starting and ending, a failure as an error, and an error status as a warning', () => {
    const spies = spyConsole()
    debug(true)
    const tell = logRequests(createDebug('api'))
    const base = { id: 1, method: 'patch', path: '/v0/tasks/{id}/', url: '/v0/tasks/t1/' }
    tell({ phase: 'start', ...base, idempotencyKey: 'k', etag: '"1"' })
    tell({ phase: 'start', ...base, etag: '"1"' })
    tell({ phase: 'start', ...base, idempotencyKey: 'k' })
    tell({ phase: 'start', ...base })
    tell({ phase: 'end', ...base, status: 200, ok: true, ms: 12, correlationId: 'r-1' })
    tell({ phase: 'end', ...base, status: 412, ok: false, ms: 3, correlationId: null })
    const failure = new Error('offline')
    tell({ phase: 'error', ...base, ms: 9, error: failure })
    expect(spies.debug.mock.calls).toEqual([
      ['[api]', '→ PATCH /v0/tasks/t1/', { idempotencyKey: 'k', etag: '"1"' }],
      ['[api]', '→ PATCH /v0/tasks/t1/', { idempotencyKey: undefined, etag: '"1"' }],
      ['[api]', '→ PATCH /v0/tasks/t1/', { idempotencyKey: 'k', etag: undefined }],
      ['[api]', '→ PATCH /v0/tasks/t1/'],
      ['[api]', '← 200 PATCH /v0/tasks/t1/ 12ms (r-1)'],
    ])
    expect(spies.warn).toHaveBeenCalledWith('[api]', '← 412 PATCH /v0/tasks/t1/ 3ms')
    expect(spies.error).toHaveBeenCalledWith('[api]', '✕ PATCH /v0/tasks/t1/ 9ms', failure)
  })
})
