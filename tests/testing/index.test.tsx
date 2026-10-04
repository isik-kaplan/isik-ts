import { render } from '@testing-library/react'

import { describe, expect, it } from 'vitest'

import { expectUniqueAccessibleNames } from '../../src/testing'

const INTERACTIVE_ROLES = [
  'button',
  'checkbox',
  'combobox',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]

describe('expectUniqueAccessibleNames', () => {
  it('passes a screen whose names merely contain one another', () => {
    const { container } = render(
      <>
        <button>Save</button>
        <button>Save colors</button>
      </>
    )
    expect(() => expectUniqueAccessibleNames(container)).not.toThrow()
  })

  it('names every pair of controls of one role that share a name', () => {
    const { container } = render(
      <>
        <button>Save</button>
        <button>Save</button>
        <button>Save</button>
        <a href="/a">Docs</a>
        <a href="/b">Docs</a>
      </>
    )
    expect(() => expectUniqueAccessibleNames(container)).toThrow(
      new Error(
        'Accessible names a getByRole query cannot tell apart:\n' +
          '  3 of role "button" named "Save"\n' +
          '  2 of role "link" named "Docs"'
      )
    )
  })

  it.each(INTERACTIVE_ROLES)('checks the %s role by default', (role) => {
    const { container } = render(
      <>
        <div role={role} aria-label="Same" />
        <div role={role} aria-label="Same" />
      </>
    )
    expect(() => expectUniqueAccessibleNames(container)).toThrow(`2 of role "${role}" named "Same"`)
  })

  it('ignores a role nobody queries by default', () => {
    const { container } = render(
      <>
        <h2>Same</h2>
        <h2>Same</h2>
      </>
    )
    expect(() => expectUniqueAccessibleNames(container)).not.toThrow()
  })

  it('checks only the role it is given', () => {
    const { container } = render(
      <>
        <h2>Same</h2>
        <h2>Same</h2>
        <button>Save</button>
        <button>Save</button>
      </>
    )
    expect(() => expectUniqueAccessibleNames(container, 'heading')).toThrow(
      new Error('Accessible names a getByRole query cannot tell apart:\n  2 of role "heading" named "Same"')
    )
  })

  it('checks every role in a list it is given', () => {
    const { container } = render(
      <>
        <h2>Same</h2>
        <h2>Same</h2>
        <button>Save</button>
        <button>Save</button>
      </>
    )
    expect(() => expectUniqueAccessibleNames(container, ['heading', 'button'])).toThrow(
      new Error(
        'Accessible names a getByRole query cannot tell apart:\n' +
          '  2 of role "heading" named "Same"\n' +
          '  2 of role "button" named "Save"'
      )
    )
  })

  it('reads the accessible name, so an aria-label counts', () => {
    const { container } = render(
      <>
        <button aria-label="Close">×</button>
        <button aria-label="Close">x</button>
      </>
    )
    expect(() => expectUniqueAccessibleNames(container)).toThrow('2 of role "button" named "Close"')
  })

  it('leaves controls with no name alone', () => {
    const { container } = render(
      <>
        <button />
        <button />
      </>
    )
    expect(() => expectUniqueAccessibleNames(container)).not.toThrow()
  })

  it('skips a control hidden from the accessibility tree', () => {
    const { container } = render(
      <>
        <button>Save</button>
        <button hidden>Save</button>
      </>
    )
    expect(() => expectUniqueAccessibleNames(container)).not.toThrow()
  })

  it('checks the whole document by default', () => {
    render(
      <>
        <button>Save</button>
        <button>Save</button>
      </>
    )
    expect(() => expectUniqueAccessibleNames()).toThrow('2 of role "button" named "Save"')
  })
})
