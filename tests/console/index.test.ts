import { describe, expect, it, vi } from 'vitest'

import { createConsoleDebugSwitch } from '../../src/console'

type WindowLike = Parameters<typeof createConsoleDebugSwitch>[0]

function makeFakeWindow() {
  return {
    console: {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as WindowLike
}

function namespaceOf(fakeWindow: WindowLike, namespace: string) {
  return (fakeWindow as unknown as Record<string, { debug: (flag: boolean) => void }>)[namespace]
}

describe('createConsoleDebugSwitch', () => {
  it('silences console methods by default', () => {
    const fakeWindow = makeFakeWindow()
    const originalLog = fakeWindow.console.log
    createConsoleDebugSwitch(fakeWindow, { namespace: 'myApp' })

    fakeWindow.console.log('hello')

    expect(originalLog).not.toHaveBeenCalled()
  })

  it('re-enables console methods via the exposed debug toggle', () => {
    const fakeWindow = makeFakeWindow()
    const originalLog = fakeWindow.console.log
    createConsoleDebugSwitch(fakeWindow, { namespace: 'myApp' })

    namespaceOf(fakeWindow, 'myApp').debug(true)
    fakeWindow.console.log('hello')

    expect(originalLog).toHaveBeenCalledWith('hello')
  })

  it('re-enables info, warn, and error alongside log', () => {
    const fakeWindow = makeFakeWindow()
    const original = { ...fakeWindow.console }
    createConsoleDebugSwitch(fakeWindow, { namespace: 'myApp' })

    namespaceOf(fakeWindow, 'myApp').debug(true)
    fakeWindow.console.info('i')
    fakeWindow.console.warn('w')
    fakeWindow.console.error('e')

    expect(original.info).toHaveBeenCalledWith('i')
    expect(original.warn).toHaveBeenCalledWith('w')
    expect(original.error).toHaveBeenCalledWith('e')
  })

  it('can silence again after being enabled', () => {
    const fakeWindow = makeFakeWindow()
    const originalLog = fakeWindow.console.log
    createConsoleDebugSwitch(fakeWindow, { namespace: 'myApp' })

    namespaceOf(fakeWindow, 'myApp').debug(true)
    namespaceOf(fakeWindow, 'myApp').debug(false)
    fakeWindow.console.log('hello')

    expect(originalLog).not.toHaveBeenCalled()
  })

  it('uses a caller-supplied namespace instead of a hardcoded one', () => {
    const fakeWindow = makeFakeWindow()
    createConsoleDebugSwitch(fakeWindow, { namespace: 'customName' })

    expect(typeof namespaceOf(fakeWindow, 'customName').debug).toBe('function')
  })

  it('re-registering the same namespace on the same window reuses the existing toggle object', () => {
    const fakeWindow = makeFakeWindow()
    const originalLog = fakeWindow.console.log
    createConsoleDebugSwitch(fakeWindow, { namespace: 'myApp' })
    const firstTarget = namespaceOf(fakeWindow, 'myApp')

    createConsoleDebugSwitch(fakeWindow, { namespace: 'myApp' })
    const secondTarget = namespaceOf(fakeWindow, 'myApp')

    expect(secondTarget).toBe(firstTarget)

    secondTarget.debug(true)
    fakeWindow.console.log('hello')
    expect(originalLog).toHaveBeenCalledWith('hello')
  })

  it('is a no-op when called with undefined (SSR safety)', () => {
    expect(() => createConsoleDebugSwitch(undefined as unknown as WindowLike, { namespace: 'myApp' })).not.toThrow()
  })

  it('is a no-op when called with null, not just undefined', () => {
    expect(() => createConsoleDebugSwitch(null as unknown as WindowLike, { namespace: 'myApp' })).not.toThrow()
  })

  it('lets a second namespace independently unlock output on the same window', () => {
    const fakeWindow = makeFakeWindow()
    const originalLog = fakeWindow.console.log
    createConsoleDebugSwitch(fakeWindow, { namespace: 'app1' })
    createConsoleDebugSwitch(fakeWindow, { namespace: 'app2' })

    namespaceOf(fakeWindow, 'app2').debug(true)
    fakeWindow.console.log('hello')

    expect(originalLog).toHaveBeenCalledWith('hello')
  })

  it('keeps output visible while at least one of several namespaces is enabled', () => {
    const fakeWindow = makeFakeWindow()
    const originalLog = fakeWindow.console.log
    createConsoleDebugSwitch(fakeWindow, { namespace: 'app1' })
    createConsoleDebugSwitch(fakeWindow, { namespace: 'app2' })

    namespaceOf(fakeWindow, 'app1').debug(true)
    namespaceOf(fakeWindow, 'app2').debug(true)
    namespaceOf(fakeWindow, 'app1').debug(false)
    fakeWindow.console.log('hello')

    expect(originalLog).toHaveBeenCalledWith('hello')
  })

  it('silences output again once every namespace has been disabled', () => {
    const fakeWindow = makeFakeWindow()
    const originalLog = fakeWindow.console.log
    createConsoleDebugSwitch(fakeWindow, { namespace: 'app1' })
    createConsoleDebugSwitch(fakeWindow, { namespace: 'app2' })

    namespaceOf(fakeWindow, 'app1').debug(true)
    namespaceOf(fakeWindow, 'app2').debug(true)
    namespaceOf(fakeWindow, 'app1').debug(false)
    namespaceOf(fakeWindow, 'app2').debug(false)
    fakeWindow.console.log('hello')

    expect(originalLog).not.toHaveBeenCalled()
  })

  it('does not pollute Object.prototype when namespace is "__proto__"', () => {
    const fakeWindow = makeFakeWindow()
    createConsoleDebugSwitch(fakeWindow, { namespace: '__proto__' })

    expect(Object.prototype.hasOwnProperty.call({}, 'debug')).toBe(false)
    expect(({} as Record<string, unknown>).debug).toBeUndefined()
  })
})
