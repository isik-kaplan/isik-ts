import { CONFIG } from '../../config'

/**
 * Next's edge compiler sets the `browser` export condition alongside `edge-light`/`worker`. If
 * `browser` sat above them in the exports map, this handler would resolve the browser build and
 * find no injected global - so it would fail rather than return the environment's values. That
 * ordering is asserted statically in tests/build.test.ts; this proves it against a real build.
 */
export const runtime = 'edge'

export async function GET() {
  return Response.json({ API_URL: CONFIG.API_URL, RETRIES: CONFIG.RETRIES })
}
