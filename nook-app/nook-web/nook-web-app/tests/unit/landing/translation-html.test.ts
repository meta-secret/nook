import { describe, expect, it } from 'vitest'
import { replaceWithSafeTranslationHtml } from '../../../src/landing/translation-html.js'

describe('replaceWithSafeTranslationHtml', () => {
  it('preserves the translation markup allowlist', () => {
    const element = document.createElement('div')

    replaceWithSafeTranslationHtml(
      element,
      'Keys,<br><code>chrome://extensions</code>',
    )

    expect(element.textContent).toBe('Keys,chrome://extensions')
    expect(element.querySelectorAll('br')).toHaveLength(1)
    expect(element.querySelector('code')?.textContent).toBe(
      'chrome://extensions',
    )
  })

  it('removes executable elements and attributes', () => {
    const element = document.createElement('div')

    replaceWithSafeTranslationHtml(
      element,
      '<code onclick="alert(1)">safe</code><img src=x onerror="alert(1)"><script>alert(1)</script>',
    )

    expect(element.querySelector('code')?.attributes).toHaveLength(0)
    expect(element.querySelectorAll('img')).toHaveLength(0)
    expect(element.querySelectorAll('script')).toHaveLength(0)
    expect(element.textContent).toBe('safe')
  })
})
