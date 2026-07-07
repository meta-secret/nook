import { describe, expect, test } from 'vitest'
import {
  absoluteSiteUrl,
  buildRobotsTxt,
  buildSitemapXml,
  PUBLIC_SITEMAP_ENTRIES,
  siteUrlFromEnv,
} from '$lib/sitemap'

describe('sitemap', () => {
  test('lists public about and legal pages', () => {
    const paths = PUBLIC_SITEMAP_ENTRIES.map((entry) => entry.path)
    expect(paths).toEqual(['/about.html', '/privacy.html', '/terms.html'])
  })

  test('buildSitemapXml emits valid loc tags for nokey.sh', () => {
    const xml = buildSitemapXml(
      'https://nokey.sh',
      new Date('2026-06-28T12:00:00Z'),
    )
    expect(xml).toContain('<loc>https://nokey.sh/about.html</loc>')
    expect(xml).toContain('<loc>https://nokey.sh/privacy.html</loc>')
    expect(xml).toContain('<loc>https://nokey.sh/terms.html</loc>')
    expect(xml).toContain('<lastmod>2026-06-28</lastmod>')
  })

  test('buildRobotsTxt references sitemap URL', () => {
    expect(buildRobotsTxt('https://nokey.sh')).toContain(
      'Sitemap: https://nokey.sh/sitemap.xml',
    )
  })

  test('buildRobotsTxt keeps app root out of crawler entry points', () => {
    const robots = buildRobotsTxt('https://nokey.sh')
    expect(robots).toContain('Allow: /about.html')
    expect(robots).toContain('Allow: /privacy.html')
    expect(robots).toContain('Allow: /terms.html')
    expect(robots).toContain('Allow: /assets/')
    expect(robots).toContain('Disallow: /')
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
