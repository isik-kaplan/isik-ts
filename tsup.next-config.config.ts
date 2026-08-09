import { defineConfig } from 'tsup'

// ESM-only, in its own config file run as a separate sequential build step (see the "build"
// script in package.json) - same shape, and same reasons, as tsup.next-cookies.config.ts:
// array-config entries run in parallel, and this config's `clean: false` racing the main
// config's `clean: true` would intermittently delete freshly-written output.
//
// ESM-only because esbuild's CJS output always injects "use strict" as the literal first line,
// which would push insert.tsx's 'use client' directive to second place and break Next's
// detection of the client boundary. The server entry follows it into ESM-only because it imports
// the client entry: a CJS build of it would emit require("./insert.js") against a file that has
// no CJS build to resolve to.
//
// `external` keeps that import as a runtime import instead of letting esbuild inline insert.tsx
// into index.js. Being a separate `entry` is not enough on its own - esbuild bundles each entry
// independently and would happily concatenate the client component into the server module,
// putting other modules ahead of the directive and destroying it.
export default defineConfig({
  entry: {
    'next/config/index': 'src/next/config/index.tsx',
    'next/config/insert': 'src/next/config/insert.tsx',
    'next/config/browser': 'src/next/config/browser.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: false,
  splitting: false,
  external: ['./insert.js'],
})
