import { describe, expect, test } from 'vitest'
import { getLegalPageFromPath, LEGAL_PAGES } from '$lib/legal-content'

describe('legal-content', () => {
  test('maps privacy and terms paths', () => {
    expect(getLegalPageFromPath('/privacy')).toBe('privacy')
    expect(getLegalPageFromPath('/privacy/')).toBe('privacy')
    expect(getLegalPageFromPath('/terms')).toBe('terms')
    expect(getLegalPageFromPath('/')).toBeNull()
    expect(getLegalPageFromPath('/vault')).toBeNull()
  })

  test('loads markdown sources from docs/', () => {
    expect(LEGAL_PAGES.privacy.source).toContain('zero-knowledge')
    expect(LEGAL_PAGES.terms.source).toContain('MIT License')
  })
})
