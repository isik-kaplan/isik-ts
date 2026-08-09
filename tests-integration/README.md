# tests-integration

`npm run test:integration`

Tests that need a real Next.js build to mean anything. Run separately from `npm test`, which stays
a ~2s unit suite.

## What lives here and why

Everything in this directory tests a claim that a unit test structurally cannot observe. The unit
suite can prove the emitted files have the right shape - no `process.env` in the browser build,
`'use client'` as the literal first line, the export conditions in the right order. It cannot prove
that **Next agrees about what that shape means**:

- Does Next's SSR pass for a client component resolve the `node` condition (reading `process.env`)
  or the `browser` one (reading a global that doesn't exist on a server)? A wrong answer here is a
  render error in every app that reads config from a client component.
- Does an edge route get the server build? Next's edge compiler sets `browser` alongside
  `edge-light`/`worker`, so the ordering in `exports` has to be right.
- Are values genuinely read per request, or frozen into the build output? This is the module's
  entire reason to exist, and no unit test can distinguish the two.
- Does `next build` really succeed with none of the variables set?

## Ground rules

**Assert on our payload, never on Next's internals.** No chunk layout, no `<head>` ordering, no
snapshots of framework-generated markup. Those change between patch releases and would make this
suite rot into a maintenance tax. Every assertion is about values we injected, under the key the
app chose, reflecting the environment the server was started with.

**The fixture must consume a packed tarball, not a path alias.** `fixtures/next-app` installs the
output of `npm pack` into its own `node_modules`. If it were wired up with a tsconfig path or a
webpack alias, resolution would never consult the `exports` map, and the conditions under test
would be bypassed - the suite would pass while proving nothing.

## Known limitation the fixture encodes

`fixtures/next-app/app/page.tsx` sets `export const dynamic = 'force-dynamic'`, and that is not
incidental. `connection()` inside `PublicConfigScript` makes the injected payload dynamic, but it
does **not** cover a sibling component's synchronous `CONFIG` read - that read still executes
during the prerender pass. A route that reads runtime config is inherently dynamic, since Next
cannot prerender HTML whose content depends on the environment the server is started with, so the
route has to say so. Without `force-dynamic`, `next build` fails on the first missing variable
instead of deferring to request time.
