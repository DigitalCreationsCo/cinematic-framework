import { GoogleTagManager } from '@next/third-parties/google'
import type { Metadata } from 'next'
import { Roboto_Mono, Google_Sans, Zalando_Sans } from 'next/font/google';
import { Footer } from '#w/components/navigation/footer.js';
import { Navbar } from '#w/components/navigation/navbar.js';
import { Providers } from '#w/providers/index.js';
import { Settings } from '#w/types/settings.js'

import '#w/styles/globals.js.css'

const robotoMono = Roboto_Mono({
  variable: '--font-roboto-mono',
  subsets: ['latin'],
  weight: [ '300', '400', '500', '600', '700' ],
});

const googleSans = Google_Sans({
  variable: '--font-google-sans',
  subsets: [ 'latin' ],
  weight: [ '400', '500', '600', '700' ],
});

const zalandoSans = Zalando_Sans({
  variable: '--font-zalando-sans',
  subsets: [ 'latin' ],
  weight: [ '300', '400', '500', '600', '700' ],
})

const baseUrl = Settings.metadataBase

export const metadata: Metadata = {
  title: Settings.title,
  metadataBase: new URL(baseUrl),
  description: Settings.description,
  keywords: Settings.keywords,
  openGraph: {
    type: Settings.openGraph.type,
    url: baseUrl,
    title: Settings.openGraph.title,
    description: Settings.openGraph.description,
    siteName: Settings.openGraph.siteName,
    images: Settings.openGraph.images.map((image) => ({
      ...image,
      url: `${baseUrl}${image.url}`,
    })),
  },
  twitter: {
    card: Settings.twitter.card,
    title: Settings.twitter.title,
    description: Settings.twitter.description,
    site: Settings.twitter.site,
    images: Settings.twitter.images.map((image) => ({
      ...image,
      url: `${baseUrl}${image.url}`,
    })),
  },
  publisher: Settings.name,
  alternates: {
    canonical: baseUrl,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      {Settings.gtmconnected && <GoogleTagManager gtmId={Settings.gtm} />}
      <body className={ `${googleSans.variable} ${robotoMono.variable} ${zalandoSans.variable} font-regular` }>
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Navbar />
            <main className="flex-1 px-5 sm:px-8">{ children }</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  )
}
