// @vitest-environment node
import { fc, test } from '@fast-check/vitest'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  type ConfigNamespace,
  claimConfigNamespace,
  configNamespaceCount,
  deleteConfigNamespaceRegistry,
  resetConfigNamespaces,
} from '../../src/node/configRegistry'

const namespace = (kind: 'server' | 'public', prefix = '', sep = '__'): ConfigNamespace => ({ kind, prefix, sep })

describe('claimConfigNamespace', () => {
  beforeEach(() => {
    resetConfigNamespaces()
  })

  it('allows the first claim of any namespace', () => {
    expect(claimConfigNamespace(namespace('server'))).toBeNull()
  })

  it('starts with an empty registry when none exists yet', () => {
    // Claims first so an empty result actually demonstrates the delete worked, rather than the
    // registry having simply been empty already.
    claimConfigNamespace(namespace('server', 'APP'))

    deleteConfigNamespaceRegistry()

    expect(configNamespaceCount()).toBe(0)
  })

  it('rejects a public claim on a namespace the server side already took', () => {
    claimConfigNamespace(namespace('server', 'APP'))

    const conflict = claimConfigNamespace(namespace('public', 'APP'))

    expect(conflict).toContain('publicConfig() was called with prefix "APP"')
    expect(conflict).toContain('config() already claimed prefix "APP"')
    expect(conflict).toBe(
      'publicConfig() was called with prefix "APP", but config() already claimed prefix "APP" - they would ' +
        'read the same environment variable namespace, so a key added to the public schema can resolve to ' +
        'a server-only value and be serialized into the browser. Give one of them a prefix the other does not use.'
    )
  })

  it('rejects a server claim on a namespace the public side already took', () => {
    claimConfigNamespace(namespace('public', 'APP'))

    expect(claimConfigNamespace(namespace('server', 'APP'))).toContain('config() was called with prefix "APP"')
  })

  it('describes an absent prefix as "no prefix" rather than an empty string', () => {
    claimConfigNamespace(namespace('server'))

    const conflict = claimConfigNamespace(namespace('public'))

    expect(conflict).toContain('publicConfig() was called with no prefix')
    expect(conflict).toContain('config() already claimed no prefix')
  })

  it('rejects a prefix nested under another at a separator boundary, in either direction', () => {
    claimConfigNamespace(namespace('server', 'APP'))
    expect(claimConfigNamespace(namespace('public', 'APP__PUBLIC'))).toContain('same environment variable namespace')

    resetConfigNamespaces()

    claimConfigNamespace(namespace('public', 'APP__PUBLIC'))
    expect(claimConfigNamespace(namespace('server', 'APP'))).toContain('same environment variable namespace')
  })

  it('allows a shared word boundary that is not a separator boundary', () => {
    claimConfigNamespace(namespace('server', 'APP'))

    expect(claimConfigNamespace(namespace('public', 'APPPUBLIC'))).toBeNull()
  })

  it('treats an absent prefix as disjoint from every named one', () => {
    claimConfigNamespace(namespace('server'))

    expect(claimConfigNamespace(namespace('public', 'PUBLIC'))).toBeNull()
  })

  it('treats an absent prefix as disjoint even from a name that would nest under empty-string-plus-separator', () => {
    // '__PUBLIC' starts with '' + '__', so a claim's own prefix being '' must short-circuit to
    // "disjoint" before the nesting check below ever runs, or this would wrongly look nested.
    claimConfigNamespace(namespace('server'))

    expect(claimConfigNamespace(namespace('public', '__PUBLIC'))).toBeNull()
  })

  it('treats a named prefix as disjoint from an absent one on the other side too', () => {
    // Mirrors the case above with the empty prefix on the *other* argument, so both sides of the
    // disjointness check are independently exercised.
    claimConfigNamespace(namespace('server', '__APP'))

    expect(claimConfigNamespace(namespace('public'))).toBeNull()
  })

  it('allows any number of same-kind claims on one namespace', () => {
    expect(claimConfigNamespace(namespace('server', 'APP'))).toBeNull()
    expect(claimConfigNamespace(namespace('server', 'APP'))).toBeNull()
    expect(claimConfigNamespace(namespace('public', 'PUBLIC'))).toBeNull()
    expect(claimConfigNamespace(namespace('public', 'PUBLIC'))).toBeNull()
  })

  it('does not grow the registry when the exact same claim is registered repeatedly', () => {
    claimConfigNamespace(namespace('server', 'APP'))
    claimConfigNamespace(namespace('server', 'APP'))
    claimConfigNamespace(namespace('server', 'APP'))

    expect(configNamespaceCount()).toBe(1)
  })

  it('tracks separate same-kind claims independently by prefix, not just by kind', () => {
    claimConfigNamespace(namespace('server', 'APP'))
    claimConfigNamespace(namespace('server', 'OTHER'))

    expect(configNamespaceCount()).toBe(2)
    // If the second claim had been wrongly treated as a duplicate of the first (e.g. by ignoring
    // prefix), it would never have been recorded, and this would come back null instead.
    expect(claimConfigNamespace(namespace('public', 'OTHER'))).toContain('same environment variable namespace')
  })

  it('still reports a conflict after a namespace was claimed repeatedly', () => {
    claimConfigNamespace(namespace('server', 'APP'))
    claimConfigNamespace(namespace('server', 'APP'))

    expect(claimConfigNamespace(namespace('public', 'APP'))).not.toBeNull()
  })

  it('distinguishes claims that differ only by separator', () => {
    claimConfigNamespace(namespace('server', 'APP', '__'))
    claimConfigNamespace(namespace('server', 'APP', '.'))

    expect(claimConfigNamespace(namespace('public', 'APP.PUBLIC'))).toContain('same environment variable namespace')
  })

  it('forgets every claim on reset', () => {
    claimConfigNamespace(namespace('server', 'APP'))
    resetConfigNamespaces()

    expect(claimConfigNamespace(namespace('public', 'APP'))).toBeNull()
  })

  test.prop([fc.string(), fc.string()])('conflicts are symmetric - claim order never changes the verdict', (a, b) => {
    resetConfigNamespaces()
    claimConfigNamespace(namespace('server', a))
    const serverFirst = claimConfigNamespace(namespace('public', b)) !== null

    resetConfigNamespaces()
    claimConfigNamespace(namespace('public', b))
    const publicFirst = claimConfigNamespace(namespace('server', a)) !== null

    expect(serverFirst).toBe(publicFirst)
  })

  test.prop([fc.string()])('a namespace never conflicts with another claim of its own kind', (prefix) => {
    resetConfigNamespaces()
    claimConfigNamespace(namespace('public', prefix))

    expect(claimConfigNamespace(namespace('public', prefix))).toBeNull()
  })
})
