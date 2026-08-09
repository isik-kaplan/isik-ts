// @vitest-environment node
import { fc, test } from '@fast-check/vitest'

import { beforeEach, describe, expect, it } from 'vitest'

import { type ConfigNamespace, claimConfigNamespace, resetConfigNamespaces } from '../../src/node/configRegistry'

const namespace = (kind: 'server' | 'public', prefix = '', sep = '__'): ConfigNamespace => ({ kind, prefix, sep })

describe('claimConfigNamespace', () => {
  beforeEach(() => {
    resetConfigNamespaces()
  })

  it('allows the first claim of any namespace', () => {
    expect(claimConfigNamespace(namespace('server'))).toBeNull()
  })

  it('rejects a public claim on a namespace the server side already took', () => {
    claimConfigNamespace(namespace('server', 'APP'))

    const conflict = claimConfigNamespace(namespace('public', 'APP'))

    expect(conflict).toContain('publicConfig() was called with prefix "APP"')
    expect(conflict).toContain('config() already claimed prefix "APP"')
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

  it('allows any number of same-kind claims on one namespace', () => {
    expect(claimConfigNamespace(namespace('server', 'APP'))).toBeNull()
    expect(claimConfigNamespace(namespace('server', 'APP'))).toBeNull()
    expect(claimConfigNamespace(namespace('public', 'PUBLIC'))).toBeNull()
    expect(claimConfigNamespace(namespace('public', 'PUBLIC'))).toBeNull()
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
