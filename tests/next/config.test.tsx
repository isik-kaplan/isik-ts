import { fc, test } from '@fast-check/vitest'
import { render } from '@testing-library/react'

import type { ReactNode } from 'react'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { publicConfig as browserPublicConfig } from '../../src/next/config/browser'
import { publicConfig } from '../../src/next/config/index'
import { PublicConfigInsert } from '../../src/next/config/insert'
import {
  jsStringLiteral,
  lazyConfigProxy,
  memoize,
  resolveGlobalKey,
  serializePublicConfigScript,
} from '../../src/next/config/shared'
import { boolean, commaSeparatedList, integer, string } from '../../src/node/casters'
import { ConfigError } from '../../src/node/configError'
import { claimConfigNamespace, resetConfigNamespaces } from '../../src/node/configRegistry'

const connection = vi.fn(async () => undefined)
const insertedCallbacks: Array<() => ReactNode> = []

vi.mock('next/server', () => ({ connection: () => connection() }))
vi.mock('next/navigation', () => ({
  useServerInsertedHTML: (callback: () => ReactNode) => {
    insertedCallbacks.push(callback)
  },
}))

/**
 * Runs an emitted config script against a stand-in for `window` and hands back that object.
 *
 * Actually executing the payload is the only way to test the escaping for what it is: a claim
 * about how a browser parses the script, not about the shape of a string. `new Function` is the
 * closest a test can get to that, which is why `no-new-func` is waived throughout this file.
 */
function evaluateScript(script: string): Record<string, unknown> {
  const fakeWindow: Record<string, unknown> = {}
  // eslint-disable-next-line no-new-func
  new Function('window', script)(fakeWindow)
  return fakeWindow
}

beforeEach(() => {
  resetConfigNamespaces()
  insertedCallbacks.length = 0
  connection.mockClear()
  // Reflect.ownKeys, not Object.keys: the injected property is defined non-enumerable in some of
  // these tests, and a leftover would make the "nothing was injected" case silently pass.
  for (const key of Reflect.ownKeys(globalThis)) {
    if (typeof key === 'string' && key.startsWith('__ISIK_')) {
      Reflect.deleteProperty(globalThis, key)
    }
  }
})

describe('publicConfig (server)', () => {
  it('reads and casts values from process.env, nesting on the separator', () => {
    vi.stubEnv('API_URL', 'https://api.example.com')
    vi.stubEnv('FEATURES__NEW_CHECKOUT', 'true')
    vi.stubEnv('FEATURES__LOCALES', 'en,tr,de')

    const { CONFIG } = publicConfig({
      API_URL: string(),
      FEATURES: { NEW_CHECKOUT: boolean(), LOCALES: commaSeparatedList() },
    })

    expect({ ...CONFIG }).toEqual({
      API_URL: 'https://api.example.com',
      FEATURES: { NEW_CHECKOUT: true, LOCALES: ['en', 'tr', 'de'] },
    })
  })

  it('prefixes every variable name when a prefix is given', () => {
    vi.stubEnv('PUBLIC__API_URL', 'https://prefixed.example.com')

    const { CONFIG } = publicConfig({ API_URL: string() }, { prefix: 'PUBLIC' })

    expect(CONFIG.API_URL).toBe('https://prefixed.example.com')
  })

  it('joins with a custom separator', () => {
    vi.stubEnv('FEATURES.NEW_CHECKOUT', 'true')

    const { CONFIG } = publicConfig({ FEATURES: { NEW_CHECKOUT: boolean() } }, { sep: '.' })

    expect(CONFIG.FEATURES.NEW_CHECKOUT).toBe(true)
  })

  it('honours missingDefault, so an unset variable is not automatically fatal', () => {
    vi.stubEnv('SENTRY_DSN', undefined)

    const { CONFIG } = publicConfig({ SENTRY_DSN: string({ missingDefault: '' }) })

    expect(CONFIG.SENTRY_DSN).toBe('')
  })

  it('resolves nothing until something reads the config', () => {
    vi.stubEnv('REQUIRED', undefined)

    // The whole point of the deferral: this call is what `next build` performs while collecting
    // page data, and it must not need the environment to be populated.
    const { CONFIG } = publicConfig({ REQUIRED: string() })

    expect(() => CONFIG.REQUIRED).toThrow(ConfigError)
  })

  it('resolves once and reuses the result', () => {
    vi.stubEnv('COUNTED', 'first')

    const { CONFIG } = publicConfig({ COUNTED: string() })
    expect(CONFIG.COUNTED).toBe('first')

    vi.stubEnv('COUNTED', 'second')
    expect(CONFIG.COUNTED).toBe('first')
  })

  it('throws ConfigError when config() already claimed the same namespace', () => {
    claimConfigNamespace({ kind: 'server', prefix: '', sep: '__' })

    expect(() => publicConfig({ API_URL: string() })).toThrow(ConfigError)
  })

  it('gives each prefix its own global, so two calls do not collide', () => {
    vi.stubEnv('ONE__A', '1')
    vi.stubEnv('TWO__B', '2')

    const first = publicConfig({ A: integer() }, { prefix: 'ONE' })
    const second = publicConfig({ B: integer() }, { prefix: 'TWO' })

    expect(first.CONFIG.A).toBe(1)
    expect(second.CONFIG.B).toBe(2)
    expect(resolveGlobalKey({ prefix: 'ONE' })).not.toBe(resolveGlobalKey({ prefix: 'TWO' }))
  })

  it('injects under an explicit globalKey when given one', async () => {
    vi.stubEnv('API_URL', 'https://api.example.com')
    const { PublicConfigScript } = publicConfig({ API_URL: string() }, { globalKey: '__ISIK_TEST_CUSTOM__' })

    const element = (await PublicConfigScript({})) as { props: { script: string } }
    const injected = evaluateScript(element.props.script)

    expect(injected.__ISIK_TEST_CUSTOM__).toEqual({ API_URL: 'https://api.example.com' })
    expect(injected.__ISIK_PUBLIC_CONFIG__).toBeUndefined()
  })

  it('lets two configs share a prefix as long as their global keys differ', async () => {
    vi.stubEnv('SHARED__A', '1')
    vi.stubEnv('SHARED__B', '2')

    const first = publicConfig({ A: integer() }, { prefix: 'SHARED', globalKey: '__ISIK_TEST_FIRST__' })
    const second = publicConfig({ B: integer() }, { prefix: 'SHARED', globalKey: '__ISIK_TEST_SECOND__' })

    const window: Record<string, unknown> = {}
    for (const { PublicConfigScript } of [first, second]) {
      const element = (await PublicConfigScript({})) as { props: { script: string } }
      // eslint-disable-next-line no-new-func
      new Function('window', element.props.script)(window)
    }

    expect(window.__ISIK_TEST_FIRST__).toEqual({ A: 1 })
    expect(window.__ISIK_TEST_SECOND__).toEqual({ B: 2 })
  })
})

describe('PublicConfigScript', () => {
  it('forces a runtime read before serializing anything', async () => {
    vi.stubEnv('API_URL', 'https://api.example.com')
    const { PublicConfigScript } = publicConfig({ API_URL: string() })

    await PublicConfigScript({})

    expect(connection).toHaveBeenCalledOnce()
  })

  it('hands the serialized payload to the client boundary', async () => {
    vi.stubEnv('API_URL', 'https://api.example.com')
    const { PublicConfigScript } = publicConfig({ API_URL: string() })

    const element = (await PublicConfigScript({})) as { type: unknown; props: { script: string; nonce?: string } }

    expect(element.type).toBe(PublicConfigInsert)
    expect(evaluateScript(element.props.script).__ISIK_PUBLIC_CONFIG__).toEqual({
      API_URL: 'https://api.example.com',
    })
  })

  it('forwards a nonce', async () => {
    vi.stubEnv('API_URL', 'https://api.example.com')
    const { PublicConfigScript } = publicConfig({ API_URL: string() })

    const element = (await PublicConfigScript({ nonce: 'abc123' })) as { props: { nonce?: string } }

    expect(element.props.nonce).toBe('abc123')
  })
})

describe('PublicConfigInsert', () => {
  it('renders nothing itself and emits the script exactly once', () => {
    const { container } = render(<PublicConfigInsert script="window.x=1" />)

    expect(container.innerHTML).toBe('')
    expect(insertedCallbacks).toHaveLength(1)

    const first = insertedCallbacks[0]() as { type: string; props: { dangerouslySetInnerHTML: { __html: string } } }
    expect(first.type).toBe('script')
    expect(first.props.dangerouslySetInnerHTML.__html).toBe('window.x=1')

    // React may re-invoke the insertion callback; the payload must not be emitted twice.
    expect(insertedCallbacks[0]()).toBeNull()
  })

  it('passes a nonce through to the script tag', () => {
    render(<PublicConfigInsert script="window.x=1" nonce="abc123" />)

    const element = insertedCallbacks[0]() as { props: { nonce?: string } }
    expect(element.props.nonce).toBe('abc123')
  })
})

describe('publicConfig (browser)', () => {
  it('reads the injected global instead of the environment', () => {
    vi.stubEnv('API_URL', 'server-only-value')
    Object.defineProperty(globalThis, '__ISIK_PUBLIC_CONFIG__', {
      value: { API_URL: 'injected-value' },
      configurable: true,
    })

    const { CONFIG } = browserPublicConfig({ API_URL: string() })

    expect(CONFIG.API_URL).toBe('injected-value')
  })

  it('reads the global namespaced by prefix', () => {
    Object.defineProperty(globalThis, resolveGlobalKey({ prefix: 'PUBLIC' }), { value: { A: 1 }, configurable: true })

    expect(browserPublicConfig({ A: integer() }, { prefix: 'PUBLIC' }).CONFIG.A).toBe(1)
  })

  it('reads an explicit globalKey, and names it when it is missing', () => {
    Object.defineProperty(globalThis, '__ISIK_TEST_CUSTOM__', { value: { A: 1 }, configurable: true })

    expect(browserPublicConfig({ A: integer() }, { globalKey: '__ISIK_TEST_CUSTOM__' }).CONFIG.A).toBe(1)
    expect(() => browserPublicConfig({ A: integer() }, { globalKey: '__ISIK_TEST_ABSENT__' }).CONFIG.A).toThrow(
      /window\.__ISIK_TEST_ABSENT__ is not set/
    )
  })

  it('defers the global read, then explains itself when nothing was injected', () => {
    const { CONFIG } = browserPublicConfig({ API_URL: string() })

    expect(() => CONFIG.API_URL).toThrow(ConfigError)
    expect(() => CONFIG.API_URL).toThrow(/Render <PublicConfigScript \/> once in your root layout/)
  })

  it('renders no script - injection already happened on the server', () => {
    expect(browserPublicConfig({ A: integer() }).PublicConfigScript({})).toBeNull()
  })

  it('claims no namespace, so it never conflicts with a server config', () => {
    claimConfigNamespace({ kind: 'server', prefix: '', sep: '__' })

    expect(() => browserPublicConfig({ A: integer() })).not.toThrow()
  })
})

describe('serializePublicConfigScript', () => {
  it('defines a non-writable, deeply frozen global', () => {
    const script = serializePublicConfigScript('__ISIK_PUBLIC_CONFIG__', { A: 1, NESTED: { B: [2] } })

    const injected = evaluateScript(script)
    const descriptor = Object.getOwnPropertyDescriptor(injected, '__ISIK_PUBLIC_CONFIG__')!
    const value = descriptor.value as { NESTED: { B: number[] } }

    expect(descriptor.writable).toBe(false)
    expect(descriptor.configurable).toBe(false)
    expect(descriptor.enumerable).toBe(true)
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.NESTED)).toBe(true)
    expect(Object.isFrozen(value.NESTED.B)).toBe(true)
  })

  it('leaves an already-injected global alone rather than throwing on redefinition', () => {
    const script = serializePublicConfigScript('__ISIK_PUBLIC_CONFIG__', { A: 1 })
    const fakeWindow: Record<string, unknown> = {}

    /* eslint-disable no-new-func */
    new Function('window', script)(fakeWindow)
    expect(() => new Function('window', script)(fakeWindow)).not.toThrow()
    /* eslint-enable no-new-func */
    expect(fakeWindow.__ISIK_PUBLIC_CONFIG__).toEqual({ A: 1 })
  })

  it('cannot be broken out of by a value containing a closing script tag', () => {
    const script = serializePublicConfigScript('__ISIK_PUBLIC_CONFIG__', {
      EVIL: '</script><script>alert(1)</script>',
    })

    expect(script).not.toContain('</script')
    expect(evaluateScript(script).__ISIK_PUBLIC_CONFIG__).toEqual({
      EVIL: '</script><script>alert(1)</script>',
    })
  })

  it('escapes the line terminators JSON.stringify emits raw', () => {
    const script = serializePublicConfigScript('__ISIK_PUBLIC_CONFIG__', { SEPARATORS: '\u2028\u2029' })

    expect(script).not.toContain('\u2028')
    expect(script).not.toContain('\u2029')
    expect(evaluateScript(script).__ISIK_PUBLIC_CONFIG__).toEqual({ SEPARATORS: '\u2028\u2029' })
  })

  it('escapes a hostile global key too', () => {
    const script = serializePublicConfigScript('</script>', { A: 1 })

    expect(script).not.toContain('</script')
  })

  it('normalizes -0 to 0, the one value JSON cannot carry', () => {
    // Reachable through `float()` on "-0". Called out here rather than filtered out of the
    // property below, because it is a real (if narrow) limit of shipping config as JSON.
    const script = serializePublicConfigScript('__ISIK_PUBLIC_CONFIG__', { ZERO: -0 })

    expect(Object.is((evaluateScript(script).__ISIK_PUBLIC_CONFIG__ as { ZERO: number }).ZERO, 0)).toBe(true)
  })

  test.prop([fc.dictionary(fc.string(), fc.jsonValue())])(
    'round-trips any JSON-serializable config through the emitted script',
    (value) => {
      const script = serializePublicConfigScript('__ISIK_PUBLIC_CONFIG__', value)

      expect(script).not.toContain('</script')
      expect(script).not.toContain('\u2028')
      expect(script).not.toContain('\u2029')
      // The contract is that the browser receives the server value's JSON projection - which is
      // exactly the value itself for everything a built-in caster can produce.
      expect(evaluateScript(script).__ISIK_PUBLIC_CONFIG__).toEqual(JSON.parse(JSON.stringify(value)))
    }
  )

  test.prop([fc.string()])('produces a valid JavaScript string literal for any input', (value) => {
    // eslint-disable-next-line no-new-func
    expect(new Function(`return ${jsStringLiteral(value)}`)()).toBe(value)
  })
})

describe('resolveGlobalKey', () => {
  it('uses the bare key when there is no prefix and a namespaced one otherwise', () => {
    expect(resolveGlobalKey({})).toBe('__ISIK_PUBLIC_CONFIG__')
    expect(resolveGlobalKey({ prefix: 'PUBLIC' })).toBe('__ISIK_PUBLIC_CONFIG__PUBLIC__')
  })

  it('takes an explicit globalKey over anything derived from the prefix', () => {
    expect(resolveGlobalKey({ globalKey: '__MY_APP_CONFIG__' })).toBe('__MY_APP_CONFIG__')
    expect(resolveGlobalKey({ prefix: 'PUBLIC', globalKey: '__MY_APP_CONFIG__' })).toBe('__MY_APP_CONFIG__')
  })

  it('rejects an empty globalKey as an accident rather than a choice', () => {
    expect(() => resolveGlobalKey({ globalKey: '' })).toThrow(ConfigError)
  })

  test.prop([fc.string({ minLength: 1 }), fc.string({ minLength: 1 })])(
    'distinct prefixes never share a global key',
    (a, b) => {
      fc.pre(a !== b)
      expect(resolveGlobalKey({ prefix: a })).not.toBe(resolveGlobalKey({ prefix: b }))
    }
  )

  test.prop([fc.string({ minLength: 1 })])('an explicit key is used verbatim, whatever it contains', (globalKey) => {
    expect(resolveGlobalKey({ prefix: 'IGNORED', globalKey })).toBe(globalKey)
  })
})

describe('memoize', () => {
  it('calls through exactly once, including when the result is undefined', () => {
    const resolve = vi.fn(() => undefined)
    const memoized = memoize(resolve)

    expect(memoized()).toBeUndefined()
    expect(memoized()).toBeUndefined()
    expect(resolve).toHaveBeenCalledOnce()
  })
})

describe('lazyConfigProxy', () => {
  it('does not resolve until a property is touched', () => {
    const resolve = vi.fn(() => ({ A: 1 }))

    const proxy = lazyConfigProxy(resolve)
    expect(resolve).not.toHaveBeenCalled()

    expect(proxy.A).toBe(1)
    expect(resolve).toHaveBeenCalled()
  })

  it('behaves like the resolved object for enumeration, membership and serialization', () => {
    const proxy = lazyConfigProxy(() => ({ A: 1, NESTED: { B: 2 } }))

    expect('A' in proxy).toBe(true)
    expect('MISSING' in proxy).toBe(false)
    expect(Object.keys(proxy)).toEqual(['A', 'NESTED'])
    expect({ ...proxy }).toEqual({ A: 1, NESTED: { B: 2 } })
    expect(JSON.stringify(proxy)).toBe('{"A":1,"NESTED":{"B":2}}')
  })

  it('reports no descriptor for a property the resolved object does not have', () => {
    const proxy = lazyConfigProxy(() => ({ A: 1 }))

    expect(Object.getOwnPropertyDescriptor(proxy, 'MISSING')).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(proxy, 'A')).toMatchObject({ value: 1, enumerable: true })
  })
})

describe('server and browser halves agree', () => {
  const SCHEMA = { A: string(), B: string() }

  /**
   * Drives both halves off one options object, the way a consuming app does - the schema and
   * options sit at a single call site and only the library import flips between builds. The
   * property is that the browser half reads whatever key the server half wrote, for any options,
   * with neither the key nor the payload chosen by the test.
   */
  const roundTrip = async (options: { prefix?: string; globalKey?: string }) => {
    resetConfigNamespaces()

    const { PublicConfigScript } = publicConfig(SCHEMA, options)
    const element = (await PublicConfigScript({})) as { props: { script: string } }
    const injected = evaluateScript(element.props.script)

    for (const [key, value] of Object.entries(injected)) {
      Object.defineProperty(globalThis, key, { value, configurable: true })
    }

    return { ...browserPublicConfig(SCHEMA, options).CONFIG }
  }

  test.prop([fc.record({ A: fc.string(), B: fc.string() })])(
    'the browser reads back exactly what the server serialized',
    async (values) => {
      vi.stubEnv('A', values.A)
      vi.stubEnv('B', values.B)

      expect(await roundTrip({})).toEqual(values)
    }
  )

  test.prop([
    fc.record({
      prefix: fc.constantFrom(undefined, 'PUBLIC', 'APP__PUBLIC'),
      globalKey: fc.constantFrom(undefined, '__ISIK_TEST_A__', '__ISIK_TEST_B__'),
    }),
  ])('any prefix/globalKey combination round-trips, because one resolver decides the key', async (options) => {
    const prefixed = (name: string) => (options.prefix === undefined ? name : `${options.prefix}__${name}`)
    vi.stubEnv(prefixed('A'), 'value-a')
    vi.stubEnv(prefixed('B'), 'value-b')

    expect(await roundTrip(options)).toEqual({ A: 'value-a', B: 'value-b' })
  })
})
