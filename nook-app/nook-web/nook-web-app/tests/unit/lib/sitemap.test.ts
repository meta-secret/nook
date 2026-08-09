import { describe, expect, test } from 'vitest'
import {
  absoluteSiteUrl,
  buildRobotsTxt,
  buildSitemapXml,
  PUBLIC_SITEMAP_ENTRIES,
  siteUrlFromEnv,
} from '$lib/content/sitemap'

describe('sitemap', () => {
  test('lists public about and legal pages', () => {
    const paths = PUBLIC_SITEMAP_ENTRIES.map((entry) => entry.path)
    expect(paths).toEqual(['/', '/privacy.html', '/terms.html'])
  })

  test('buildSitemapXml emits valid loc tags for nokey.sh', () => {
    const sitemapArgs: Parameters<typeof buildSitemapXml>[0] = {
      siteUrl: 'https://nokey.sh',
      lastmod: new Date('2026-06-28T12:00:00Z'),
    }
    const xml = buildSitemapXml(sitemapArgs)
    expect(xml).toContain('<loc>https://nokey.sh/</loc>')
    expect(xml).toContain('<loc>https://nokey.sh/privacy.html</loc>')
    expect(xml).toContain('<loc>https://nokey.sh/terms.html</loc>')
    expect(xml).toContain('<lastmod>2026-06-28</lastmod>')
  })

  test('buildRobotsTxt references sitemap URL', () => {
    expect(buildRobotsTxt('https://nokey.sh')).toContain(
      'Sitemap: https://nokey.sh/sitemap.xml',
    )
  })

  test('buildRobotsTxt indexes the landing page but excludes the app', () => {
    const robots = buildRobotsTxt('https://nokey.sh')
    expect(robots).toContain('Allow: /$')
    expect(robots).toContain('Allow: /about.html')
    expect(robots).toContain('Allow: /privacy.html')
    expect(robots).toContain('Allow: /terms.html')
    expect(robots).toContain('Allow: /assets/')
    expect(robots).toContain('Disallow: /app/')
    for (const path of [
      '/admin',
      '/devices-access',
      '/help',
      '/onboard',
      '/settings',
      '/vault',
    ]) {
      expect(robots).toContain(`Disallow: ${path}\n`)
    }
    expect(robots).toContain('Disallow: /privacy')
    expect(robots).toContain('Disallow: /terms')
  })

  test('siteUrlFromEnv prefers VITE_SITE_URL', () => {
    expect(siteUrlFromEnv({ VITE_SITE_URL: 'https://example.com/' })).toBe(
      'https://example.com',
    )
  })

  test('absoluteSiteUrl normalizes trailing slashes', () => {
    expect(absoluteSiteUrl('https://nokey.sh/', '/privacy.html')).toBe(
      'https://nokey.sh/privacy.html',
    )
  })
})
