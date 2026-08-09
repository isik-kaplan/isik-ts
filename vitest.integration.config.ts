import { defineConfig } from 'vitest/config'

// Separate from vitest.config.ts on purpose. These tests pack the package, build a real Next app
// and boot servers, so they run in tens of seconds rather than the unit suite's ~2s - `npm test`
// has to stay fast enough to run on every save. They also exercise the built `dist/` through the
// exports map rather than `src/`, so they contribute nothing to the src coverage thresholds and
// are excluded from coverage entirely.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests-integration/**/*.test.ts'],
    // One Next build and one port at a time; parallel `next start` invocations on a shared .next
    // directory are a recipe for flakes.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
})
