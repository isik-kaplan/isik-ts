import { defineConfig } from 'tsup'

// ESM-only, in its own config file run as a separate sequential build step (see the "build"
// script in package.json) - not just a second entry in tsup.config.ts's array, because tsup runs
// array-config entries in parallel, and this config's `clean: false` racing against the main
// config's `clean: true` intermittently deleted this entry's freshly-written output.
//
// ESM-only because esbuild's CJS output always injects "use strict" as the literal first line,
// which would push our "use server" directive to second place and break Next.js's Server Actions
// detection. Since 'use server' only has meaning inside Next's ESM/RSC bundling pipeline anyway, a
// CJS build of this entry wouldn't be usable for its purpose regardless.
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
