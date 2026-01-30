import type { MetadataRoute } from 'next'

import { Settings } from '#w/types/settings.js'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: `${Settings.metadataBase}/sitemap.xml`,
  }
}
