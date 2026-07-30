import { describe, expect, test } from 'vitest'
import { LegalRouteKind, legalRoute } from '$lib/app-lifecycle-state'
import {
  LEGAL_PAGES,
  LegalPageLookupKind,
  LegalPageId,
  getLegalPageFromPath,
} from '$lib/legal-content'

describe('legal-content', () => {
  test('maps privacy and terms paths', () => {
    expect(getLegalPageFromPath('/privacy')).toEqual({
      kind: LegalPageLookupKind.LegalPage,
      page: LegalPageId.Privacy,
    })
    expect(getLegalPageFromPath('/privacy/')).toEqual({
      kind: LegalPageLookupKind.LegalPage,
      page: LegalPageId.Privacy,
    })
    expect(getLegalPageFromPath('/terms')).toEqual({
      kind: LegalPageLookupKind.LegalPage,
      page: LegalPageId.Terms,
    })
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
