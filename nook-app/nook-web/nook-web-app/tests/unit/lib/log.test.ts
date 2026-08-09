import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isIgnoredErrorSource, sanitizeLogUrl } from '$lib/runtime/log'

describe('isIgnoredErrorSource', () => {
  it('ignores browser extension origins', () => {
    expect(
      isIgnoredErrorSource(
        'chrome-extension://abc/bootstrap-autofill-overlay.js',
      ),
    ).toBe(true)
    expect(isIgnoredErrorSource('moz-extension://abc/script.js')).toBe(true)
  })

  it('ignores autofill overlay filenames', () => {
    expect(
      isIgnoredErrorSource(
        'https://app.example/bootstrap-autofill-overlay.js:16:17235',
      ),
    ).toBe(true)
  })

  it('keeps app script sources', () => {
    expect(isIgnoredErrorSource('https://app.example/assets/index.js')).toBe(
      false,
    )
  })
})

describe('sanitizeLogUrl', () => {
  it('removes query strings and hashes', () => {
    expect(
      sanitizeLogUrl(
        'https://api.github.com/repos/o/r/contents/nook-events?token=secret#frag',
      ),
    ).toBe('https://api.github.com/repos/o/r/contents/nook-events')
  })

  it('never persists query or fragment secrets for valid web URLs', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.string(),
        fc.string(),
        (rawUrl, querySecret, fragmentSecret) => {
          const url = new URL(rawUrl)
          url.searchParams.set('credential', querySecret)
          url.hash = fragmentSecret

          const sanitized = new URL(sanitizeLogUrl(url.toString()))
          expect(sanitized.search).toBe('')
          expect(sanitized.hash).toBe('')
          expect(sanitized.origin).toBe(url.origin)
          expect(sanitized.pathname).toBe(url.pathname)
        },
      ),
    )
  })
})
