import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'hooks/index': 'src/hooks/index.ts',
    'drf/index': 'src/drf/index.ts',
    'allauth/index': 'src/allauth/index.ts',
    'webauthn/index': 'src/webauthn/index.ts',
    'testing/index': 'src/testing/index.ts',
    'node/index': 'src/node/index.ts',
    'next/middleware/index': 'src/next/middleware.ts',
    'next/request/index': 'src/next/request.ts',
    'next/session/index': 'src/next/session.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
})
