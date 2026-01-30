import { PageRoutes } from '#w/lib/pageroutes.js'

export const Navigations = [
  {
    title: 'Updates',
    href: `/updates`,
    external: false,
  },
  {
    title: 'Docs',
    href: `/docs${PageRoutes[0].href}`,
    external: false,
  },
  {
    title: 'Editor',
    href: `/editor`,
    external: false,
    disabled: process.env.NODE_ENV !== 'development',
  },
  // {
  //   title: 'Cinematic Canvas',
  //   href: 'https://cinematic-canvas.com',
  //   external: true,
  // },
]

export const GitHubLink = {
  href: 'https://github.com/digitalcreationsco/cinematic-canvas',
}
