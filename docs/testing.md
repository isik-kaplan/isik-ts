# testing

Import from `@isikk/core/testing`. Requires `@testing-library/dom` and `dom-accessibility-api` as peer dependencies - both optional, so an app that never imports this entry point does not need them. `@testing-library/dom` brings `dom-accessibility-api` along as its own dependency, but a strict package manager such as pnpm needs it installed directly.

## expectUniqueAccessibleNames

Throws if two controls of the same role share an accessible name.

A string `name` in `getByRole` matches **exactly**, so "Save colors" beside "Save" is harmless. A second "Save" is not: it makes `getByRole('button', { name: 'Save' })` throw, in a spec about some other part of the screen. This names the pair on the screen where it was introduced instead.

```tsx
import { expectUniqueAccessibleNames } from '@isikk/core/testing'

it('gives every control a name of its own', () => {
  render(<SettingsPage />)
  expectUniqueAccessibleNames()
})
```

- `expectUniqueAccessibleNames(container?, roles?)`. `container` defaults to `document.body`.
- `roles` is one role or a list. The default is the interactive roles - the ones a test reaches for with `getByRole`: `button`, `checkbox`, `combobox`, `link`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`, `radio`, `searchbox`, `slider`, `spinbutton`, `switch`, `tab`, `textbox`. Two table cells reading "-" are ordinary, so other roles are checked only when asked for.
- It reads what `getByRole` reads: the computed accessible name, so an `aria-label` counts, and only elements in the accessibility tree.
- A control with no name is left alone - no name query can reach it to be ambiguous.
- Prefer a string `name` over a regex in queries. A regex is where substring matching genuinely lives, so `{ name: /Save/ }` is what quietly starts matching two elements when a screen grows.
