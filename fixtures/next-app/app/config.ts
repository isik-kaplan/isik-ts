import { integer, publicConfig, string } from '@isikk/core/next/config'

/**
 * One call site, imported by server components, a client component and an edge route handler
 * alike. Only the library import flips between builds - which is the thing the integration tests
 * exist to confirm actually happens.
 *
 * Casters come from `next/config` rather than `@isikk/core/node`: that entry point's barrel
 * also carries fs and async_hooks users, and this module is deliberately shared with the client
 * and edge bundles.
 */
export const { CONFIG, PublicConfigScript } = publicConfig(
  {
    API_URL: string(),
    RETRIES: integer({ missingDefault: 1 }),
    NESTED: { LABEL: string({ missingDefault: 'unset' }) },
  },
  { globalKey: '__FIXTURE_CONFIG__', prefix: 'PUBLIC' }
)
