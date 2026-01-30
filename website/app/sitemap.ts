import type { MetadataRoute } from 'next'
import { PageRoutes } from '#w/lib/pageroutes.js';
import { Settings } from '#w/types/settings.js'

export default function sitemap(): MetadataRoute.Sitemap {
  return PageRoutes.map((page) => ({
    url: `${Settings.metadataBase}${page.href}`,
    lastModified: new Date().toISOString(),
    changeFrequency: 'monthly',
    priority: 0.8,
  }))
}
