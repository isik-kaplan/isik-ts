import { defineConfig } from 'tsup'

// ESM-only, in its own config file run as a separate sequential build step (see the "build"
// script in package.json) - not just a second entry in tsup.config.ts's array, because tsup runs
// array-config entries in parallel, and this config's `clean: false` racing against the main
// config's `clean: true` intermittently deleted this entry's freshly-written output.
//
// ESM-only, as it has always shipped: `next/headers` only works inside Next's own bundling, which
// reads ESM. It once carried a 'use server' directive, which a CJS build's "use strict" would have
// displaced; it no longer does, and no CJS build was added, so the package's exports stay as they were.
export default defineConfig({
  entry: {
    'next/cookies/index': 'src/next/cookies.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: false,
  splitting: false,
})
