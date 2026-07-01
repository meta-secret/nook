import { describe, expect, test } from 'vitest'
import {
  absoluteSiteUrl,
  buildRobotsTxt,
  buildSitemapXml,
  PUBLIC_SITEMAP_ENTRIES,
  siteUrlFromEnv,
} from '$lib/sitemap'

describe('sitemap', () => {
  test('lists home and legal pages', () => {
    const paths = PUBLIC_SITEMAP_ENTRIES.map((entry) => entry.path)
    expect(paths).toEqual(['/', '/privacy', '/terms'])
  })

  test('buildSitemapXml emits valid loc tags for nokey.sh', () => {
    const xml = buildSitemapXml(
      'https://nokey.sh',
      new Date('2026-06-28T12:00:00Z'),
    )
    expect(xml).toContain('<loc>https://nokey.sh/</loc>')
    expect(xml).toContain('<loc>https://nokey.sh/privacy</loc>')
    expect(xml).toContain('<loc>https://nokey.sh/terms</loc>')
    expect(xml).toContain('<lastmod>2026-06-28</lastmod>')
  })

  test('buildRobotsTxt references sitemap URL', () => {
    expect(buildRobotsTxt('https://nokey.sh')).toContain(
      'Sitemap: https://nokey.sh/sitemap.xml',
    )
  })

  test('siteUrlFromEnv prefers VITE_SITE_URL', () => {
    expect(siteUrlFromEnv({ VITE_SITE_URL: 'https://example.com/' })).toBe(
      'https://example.com',
    )
  })

  test('absoluteSiteUrl normalizes trailing slashes', () => {
    expect(absoluteSiteUrl('https://nokey.sh/', '/privacy')).toBe(
      'https://nokey.sh/privacy',
    )
  })
})
