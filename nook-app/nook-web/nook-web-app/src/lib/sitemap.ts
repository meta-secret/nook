/** Canonical production host for nokey.sh (override with VITE_SITE_URL at build time). */
export const DEFAULT_SITE_URL = 'https://nokey.sh'

export type SitemapEntry = {
  path: string
  changefreq: 'weekly' | 'monthly'
  priority: string
}

/** Public routes suitable for search indexing (keep in sync with LEGAL_PAGES paths). */
export const PUBLIC_SITEMAP_ENTRIES: SitemapEntry[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/privacy.html', changefreq: 'monthly', priority: '0.6' },
  { path: '/terms.html', changefreq: 'monthly', priority: '0.6' },
]

export function siteUrlFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const trimmed = env.VITE_SITE_URL?.trim()
  if (trimmed) {
    return trimmed.replace(/\/$/, '')
  }
  return DEFAULT_SITE_URL
}

export function absoluteSiteUrl(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/$/, '')
  if (path === '/') {
    return `${base}/`
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildSitemapXml(
  siteUrl: string,
  lastmod: Date = new Date(),
): string {
  const isoDate = lastmod.toISOString().slice(0, 10)
  const body = PUBLIC_SITEMAP_ENTRIES.map(
    (entry) => `  <url>
    <loc>${escapeXml(absoluteSiteUrl(siteUrl, entry.path))}</loc>
    <lastmod>${isoDate}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
  ).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`
}

export function buildRobotsTxt(siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, '')
  return `User-agent: *
Allow: /$
Allow: /about.html
Allow: /privacy.html
Allow: /terms.html
Allow: /assets/
Allow: /favicon.png
Allow: /nook-logo-dark.png
Allow: /nook-logo-light.png
Allow: /nook-logo-dark-transparent.png
Allow: /robots.txt
Allow: /sitemap.xml
Disallow: /app/
Disallow: /app-logs
Disallow: /extension-connect
Disallow: /logs

Sitemap: ${base}/sitemap.xml
`
}
