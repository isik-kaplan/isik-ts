// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setCookie } from '../../src/cookies'

// jsdom's location cannot be replaced, so the https page is a node global with a stand-in document.
function page(protocol: string | undefined) {
  const written: string[] = []
  vi.stubGlobal('location', protocol === undefined ? undefined : { protocol })
  vi.stubGlobal('document', {
    get cookie() {
      return ''
    },
    set cookie(value: string) {
      written.push(value)
    },
  })
  return written
}

describe('setCookie on an https page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes Secure by default', () => {
    const written = page('https:')
    setCookie('a', 'b')
    expect(written).toEqual(['a=b; path=/; SameSite=Lax; Secure'])
  })

  it('leaves Secure off when told to', () => {
    const written = page('https:')
    setCookie('a', 'b', { secure: false })
    expect(written).toEqual(['a=b; path=/; SameSite=Lax'])
  })

  it.each([
    ['an http page', 'http:'],
    ['no location at all', undefined],
  ])('writes no Secure on %s', (_, protocol) => {
    const written = page(protocol)
    setCookie('a', 'b')
    expect(written).toEqual(['a=b; path=/; SameSite=Lax'])
  })

  it('accepts SameSite=None by default over https', () => {
    const written = page('https:')
    setCookie('a', 'b', { sameSite: 'None' })
    expect(written).toEqual(['a=b; path=/; SameSite=None; Secure'])
  })
})
