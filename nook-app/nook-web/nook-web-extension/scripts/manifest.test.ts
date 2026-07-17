import { describe, expect, test } from 'bun:test'
import { createManifest } from '../src/manifest'

const environments = [
  {
    simple: 'https://simple.nokey.sh/',
    sentinel: 'https://sentinel.nokey.sh/*',
  },
  {
    simple: 'https://simple.dev.nokey.sh/',
    sentinel: 'https://sentinel.dev.nokey.sh/*',
  },
  {
    simple: 'https://pr-408.nokey-simple.pages.dev/',
    sentinel: 'https://pr-408.nokey-sentinel.pages.dev/*',
  },
] as const

describe('extension origin isolation', () => {
  for (const environment of environments) {
    test(`connects only to ${environment.simple}`, () => {
      const manifest = createManifest('1.0.0', environment.simple)
      const simpleMatch = `${environment.simple}*`

      expect(manifest.externally_connectable.matches).toEqual([simpleMatch])
      expect(manifest.externally_connectable.matches).not.toContain(
        environment.sentinel,
      )
      expect(
        manifest.content_scripts.every(({ exclude_matches }) =>
          exclude_matches.includes(environment.sentinel),
        ),
      ).toBe(true)
      expect(
        manifest.content_scripts.some(({ matches }) =>
          matches.includes(environment.sentinel),
        ),
      ).toBe(false)
      const broadScripts = manifest.content_scripts.filter(({ matches }) =>
        matches.includes('<all_urls>'),
      )
      expect(broadScripts.length).toBeGreaterThan(0)
      expect(
        broadScripts.every(({ exclude_matches }) =>
          exclude_matches.includes(simpleMatch),
        ),
      ).toBe(true)
      expect(
        broadScripts.every(
          ({ exclude_matches }) =>
            exclude_matches.includes('https://simple.nokey.sh/*') &&
            exclude_matches.includes('https://simple.dev.nokey.sh/*') &&
            exclude_matches.includes('https://*.nokey-simple.pages.dev/*') &&
            exclude_matches.includes('https://*.nokey-sentinel.pages.dev/*'),
        ),
      ).toBe(true)
      expect(
        manifest.content_scripts.some(
          ({ matches, exclude_matches }) =>
            matches.includes(simpleMatch) &&
            !exclude_matches.includes(simpleMatch),
        ),
      ).toBe(true)
      expect(
        manifest.content_scripts.find(({ matches }) =>
          matches.includes(simpleMatch),
        )?.run_at,
      ).toBe('document_start')
    })
  }

  test('declares the offscreen permission for its memory-only device session', () => {
    expect(createManifest('1.0.0').permissions).toContain('offscreen')
  })

  test('installs isolated transport and page-world WebAuthn bridges at document start', () => {
    const scripts = createManifest('1.0.0').content_scripts
    expect(
      scripts.some(
        (script) =>
          script.world === 'ISOLATED' &&
          script.run_at === 'document_start' &&
          script.js.includes('content/webauthn-content.js'),
      ),
    ).toBe(true)
    expect(
      scripts.some(
        (script) =>
          script.world === 'MAIN' &&
          script.run_at === 'document_start' &&
          script.js.includes('content/webauthn-page.js'),
      ),
    ).toBe(true)
  })
})
