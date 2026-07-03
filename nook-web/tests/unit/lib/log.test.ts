import { describe, expect, it } from 'vitest'
import { isIgnoredErrorSource, sanitizeLogUrl } from '$lib/log'

describe('isIgnoredErrorSource', () => {
  it('ignores browser extension origins', () => {
    expect(
      isIgnoredErrorSource('chrome-extension://abc/bootstrap-autofill-overlay.js'),
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
        'https://api.github.com/repos/o/r/contents/nook-vault.yaml?token=secret#frag',
      ),
    ).toBe('https://api.github.com/repos/o/r/contents/nook-vault.yaml')
  })
})
