import { defineConfig } from 'tsup'

// The isikk-gen-client command: one ESM file with a shebang, beside the codegen entry it runs.
export default defineConfig({
  entry: { 'codegen/bin': 'src/codegen/bin.ts' },
  format: ['esm'],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  clean: false,
  splitting: false,
})
