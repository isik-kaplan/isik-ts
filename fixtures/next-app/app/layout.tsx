import { Suspense } from 'react'

import { PublicConfigScript } from './config'

export const metadata = { title: 'next/config fixture' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* PublicConfigScript awaits connection(), so it needs a boundary under Cache Components
            and is harmless without it. */}
        <Suspense>
          <PublicConfigScript />
        </Suspense>
        {children}
      </body>
    </html>
  )
}
