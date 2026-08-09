import { ClientReader } from './client-reader'
import { CONFIG } from './config'

// A route that reads runtime config is inherently dynamic - Next cannot prerender HTML whose
// content depends on the environment the server is started with. connection() inside
// PublicConfigScript makes the injected payload dynamic, but it does not cover a sibling
// component's synchronous CONFIG read, which still executes during the prerender pass.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <main>
      <dl>
        <dt>server:API_URL</dt>
        <dd id="server-api-url">{CONFIG.API_URL}</dd>
        <dt>server:RETRIES</dt>
        <dd id="server-retries">{`${CONFIG.RETRIES} (${typeof CONFIG.RETRIES})`}</dd>
      </dl>
      <ClientReader />
    </main>
  )
}
