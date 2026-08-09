'use client'

import { useRef } from 'react'

import { useServerInsertedHTML } from 'next/navigation'

/**
 * Emits the pre-serialized config script into the document head during SSR.
 *
 * `useServerInsertedHTML` rather than rendering a `<script>` in the layout, because the App
 * Router puts its own chunk scripts in the head with `async` - an inline script sitting in the
 * body can therefore execute *after* a chunk that already tried to read the config. Head
 * insertion puts it ahead of them. (React 19's script hoisting is no help here: it hoists `src`
 * scripts, not inline ones.)
 *
 * Lives in its own module because of the `'use client'` directive, which Next requires to be the
 * literal first statement of the file it applies to - see docs/next/config.md.
 */
export function PublicConfigInsert({ script, nonce }: { script: string; nonce?: string }) {
  const inserted = useRef(false)

  useServerInsertedHTML(() => {
    // React can invoke the callback more than once; the script guards against re-running itself
    // anyway, but emitting one copy of the payload per flush would be pure page weight.
    if (inserted.current) {
      return null
    }
    inserted.current = true
    return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />
  })

  return null
}
