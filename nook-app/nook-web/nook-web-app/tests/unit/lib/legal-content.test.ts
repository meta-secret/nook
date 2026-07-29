import { describe, expect, test } from 'vitest'
import { LegalRouteKind, legalRoute } from '$lib/app-lifecycle-state'
import {
  LEGAL_PAGES,
  LegalPageId,
  getLegalPageFromPath,
} from '$lib/legal-content'

describe('legal-content', () => {
  test('maps privacy and terms paths', () => {
    expect(getLegalPageFromPath('/privacy')).toBe(LegalPageId.Privacy)
    expect(getLegalPageFromPath('/privacy/')).toBe(LegalPageId.Privacy)
    expect(getLegalPageFromPath('/terms')).toBe(LegalPageId.Terms)
    expect(legalRoute(getLegalPageFromPath('/'))).toEqual({
      kind: LegalRouteKind.Application,
    })
    expect(legalRoute(getLegalPageFromPath('/vault'))).toEqual({
      kind: LegalRouteKind.Application,
    })
  })

  test('loads markdown sources from docs/', () => {
    expect(LEGAL_PAGES.privacy.source).toContain('zero-knowledge')
    expect(LEGAL_PAGES.terms.source).toContain('MIT License')
  })
})
