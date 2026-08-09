// @vitest-environment node
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Assertions about the emitted package rather than about `src/`. Everything that makes
 * `@isikk/core/next/config` safe to import from a client component is a property of the
 * build output and of the export conditions - a unit test over the source cannot observe any of
 * it. Run `npm run build` first; CI builds before testing for exactly this reason.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

const read = (relativePath: string) => readFileSync(path.join(dist, relativePath), 'utf8')

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  exports: Record<string, Record<string, string>>
}

beforeAll(() => {
  if (!existsSync(dist)) {
    throw new Error('dist/ is missing - run `npm run build` before the test suite (CI does).')
  }
})

describe('next/config build output', () => {
  it('has no environment access whatsoever in the browser build', () => {
    // The guarantee the entire module design rests on. The browser build is substituted for the
    // server one by the `browser` export condition, so if this file cannot read the environment,
    // bundling the config module for the client cannot leak a server value - regardless of what
    // anyone puts in the schema.
    expect(read('next/config/browser.js')).not.toMatch(/process\s*\.\s*env/)
  })

  it('keeps the server build out of the browser build entirely', () => {
    const browser = read('next/config/browser.js')

    expect(browser).not.toContain('next/server')
    expect(browser).not.toContain('buildConfig')
  })

  it('puts no name of its own into the browser build at all', () => {
    // globalKey is required precisely so this package never picks a property name on someone
    // else's window. The browser half is where such a name would land, and it carries none.
    expect(read('next/config/browser.js')).not.toMatch(/isik/i)
  })

  it('has no default global property name to fall back to on either side', () => {
    for (const entry of ['next/config/index.js', 'next/config/browser.js']) {
      expect(read(entry)).not.toMatch(/PUBLIC_CONFIG__/)
    }

    // The server half does carry one package-scoped name: the Symbol key for the config namespace
    // registry. That is a server-side bookkeeping symbol, not a property on an app's window, and
    // it is deliberately namespaced to the package so two copies share one registry.
    expect(read('next/config/index.js')).toContain('Symbol.for("@isikk/core/config-namespace-registry")')
    expect(read('next/config/browser.js')).not.toContain('config-namespace-registry')
  })

  it('starts the client entry with its directive, ahead of anything esbuild adds', () => {
    expect(read('next/config/insert.js').split('\n')[0]).toBe('"use client";')
  })

  it('imports the client entry instead of inlining it', () => {
    // Being a separate tsup `entry` is not enough - esbuild bundles each entry independently and
    // would concatenate insert.tsx into this module, putting code ahead of its 'use client'
    // directive and destroying the client boundary. The `external` in the tsup config is what
    // keeps this a real import.
    expect(read('next/config/index.js')).toMatch(/from\s*["']\.\/insert\.js["']/)
  })

  it('ships no CJS build for the entries whose directives could not survive one', () => {
    expect(existsSync(path.join(dist, 'next/config/index.cjs'))).toBe(false)
    expect(existsSync(path.join(dist, 'next/config/insert.cjs'))).toBe(false)
  })
})

describe('package exports', () => {
  const conditions = Object.keys(packageJson.exports['./next/config'])

  it('resolves server-side conditions before "browser"', () => {
    // Conditions match in declaration order. Next's edge compiler sets `browser` alongside
    // `edge-light`/`worker`, so a `browser` entry above them would hand middleware and edge
    // routes the browser build - which reads a global that only exists in a document.
    for (const serverCondition of ['edge-light', 'worker', 'node']) {
      expect(conditions.indexOf(serverCondition)).toBeGreaterThanOrEqual(0)
      expect(conditions.indexOf(serverCondition)).toBeLessThan(conditions.indexOf('browser'))
    }
  })

  it('resolves "browser" before the fallback', () => {
    expect(conditions.indexOf('browser')).toBeLessThan(conditions.indexOf('default'))
  })

  it('puts "types" first, where TypeScript requires it', () => {
    for (const subpath of Object.keys(packageJson.exports)) {
      expect(Object.keys(packageJson.exports[subpath])[0]).toBe('types')
    }
  })

  it('points every declared export at a file that exists', () => {
    for (const [subpath, targets] of Object.entries(packageJson.exports)) {
      for (const target of Object.values(targets)) {
        expect(existsSync(path.join(root, target)), `${subpath} -> ${target}`).toBe(true)
      }
    }
  })
})
