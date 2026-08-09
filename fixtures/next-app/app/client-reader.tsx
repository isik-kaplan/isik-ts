'use client'

import { CONFIG } from './config'

/**
 * The load-bearing case. This is a client component, so Next resolves
 * `@isikk/core/next/config` for it twice: once in the SSR pass (which must reach the server
 * build and read process.env) and once in the browser bundle (which must reach the browser build
 * and read the injected global). If the SSR pass resolved the browser condition instead, this
 * would throw during render, because no global exists on the server.
 */
export function ClientReader() {
  return (
    <dl>
      <dt>client:API_URL</dt>
      <dd id="client-api-url">{CONFIG.API_URL}</dd>
      <dt>client:RETRIES</dt>
      <dd id="client-retries">{`${CONFIG.RETRIES} (${typeof CONFIG.RETRIES})`}</dd>
      <dt>client:NESTED.LABEL</dt>
      <dd id="client-nested-label">{CONFIG.NESTED.LABEL}</dd>
    </dl>
  )
}
