import { describe, expect, test } from 'vitest'
import {
  PublicSiteLocation,
  RobotsDocument,
  SitemapDocument,
  ConfiguredSiteUrlEnvironment,
  PUBLIC_SITEMAP_ENTRIES,
  SiteUrlConfiguration,
} from '$lib/content/sitemap'

describe('sitemap', () => {
  test('lists public about and legal pages', () => {
    const paths = PUBLIC_SITEMAP_ENTRIES.map((entry) => entry.path)
    expect(paths).toEqual(['/', '/privacy.html', '/terms.html'])
  })

  test('buildSitemapXml emits valid loc tags for nokey.sh', () => {
    const sitemapArgs: ConstructorParameters<typeof SitemapDocument>[0] = {
      siteUrl: 'https://nokey.sh',
      lastmod: new Date('2026-06-28T12:00:00Z'),
    }
    const xml = new SitemapDocument(sitemapArgs).xml
    expect(xml).toContain('<loc>https://nokey.sh/</loc>')
    expect(xml).toContain('<loc>https://nokey.sh/privacy.html</loc>')
    expect(xml).toContain('<loc>https://nokey.sh/terms.html</loc>')
    expect(xml).toContain('<lastmod>2026-06-28</lastmod>')
  })

  test('buildRobotsTxt references sitemap URL', () => {
    expect(new RobotsDocument('https://nokey.sh').text).toContain(
      'Sitemap: https://nokey.sh/sitemap.xml',
    )
  })

  test('buildRobotsTxt indexes the landing page but excludes the app', () => {
    const robots = new RobotsDocument('https://nokey.sh').text
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
    const environment = new ConfiguredSiteUrlEnvironment('https://example.com/')
    expect(new SiteUrlConfiguration(environment).url).toBe(
      'https://example.com',
    )
  })

  test('absoluteSiteUrl normalizes trailing slashes', () => {
    expect(
      new PublicSiteLocation({
        siteUrl: 'https://nokey.sh/',
        path: '/privacy.html',
      }).url,
    ).toBe('https://nokey.sh/privacy.html')
  })
})
