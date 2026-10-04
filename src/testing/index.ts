import { getRoles } from '@testing-library/dom'

import { computeAccessibleName } from 'dom-accessibility-api'

/**
 * The roles a test clicks, types into or picks - the ones `getByRole` is reached for. Duplicate names
 * elsewhere, two table cells reading "-" say, are ordinary and no query is ambiguous about them.
 */
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

/**
 * Throws if two accessible controls of the same role share an accessible name.
 *
 * A string `name` in `getByRole` matches exactly, so "Save colors" beside "Save" is harmless - but a
 * second "Save" makes `getByRole('button', { name: 'Save' })` throw, in a spec about some other part
 * of the screen. This names the pair where it was introduced instead.
 *
 * Reads what `getByRole` reads: the computed accessible name, so an `aria-label` counts, and only
 * accessible elements, so a control hidden from the accessibility tree does not. A control with no
 * name is left alone - no name query can reach it to be ambiguous.
 */
export function expectUniqueAccessibleNames(
  container: HTMLElement = document.body,
  roles: string | readonly string[] = INTERACTIVE_ROLES
): void {
  const checked = new Set(typeof roles === 'string' ? [roles] : roles)
  const duplicates: string[] = []
  for (const [role, elements] of Object.entries(getRoles(container))) {
    if (!checked.has(role)) continue
    const counts = new Map<string, number>()
    for (const element of elements) {
      const name = computeAccessibleName(element)
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    for (const [name, count] of counts) {
      if (count > 1) duplicates.push(`${count} of role "${role}" named "${name}"`)
    }
  }
  if (duplicates.length > 0) {
    throw new Error(`Accessible names a getByRole query cannot tell apart:\n  ${duplicates.join('\n  ')}`)
  }
}
