import { describe, expect, test } from 'vitest'
import { LegalRouteKind, LegalRouteProjection } from '$lib/app/route-state'
import {
  LEGAL_PAGES,
  LegalPageLookupKind,
  LegalPageId,
  ApplicationRoutePresentation,
} from '$lib/content/legal'

describe('legal-content', () => {
  test('maps privacy and terms paths', () => {
    expect(
      new ApplicationRoutePresentation('/privacy').getLegalPageFromPath(),
    ).toEqual({
      kind: LegalPageLookupKind.LegalPage,
      page: LegalPageId.Privacy,
    })
    expect(
      new ApplicationRoutePresentation('/privacy/').getLegalPageFromPath(),
    ).toEqual({
      kind: LegalPageLookupKind.LegalPage,
      page: LegalPageId.Privacy,
    })
    expect(
      new ApplicationRoutePresentation('/terms').getLegalPageFromPath(),
    ).toEqual({
      kind: LegalPageLookupKind.LegalPage,
      page: LegalPageId.Terms,
    })
    expect(
      new LegalRouteProjection(
        new ApplicationRoutePresentation('/').getLegalPageFromPath(),
      ).route,
    ).toEqual({
      kind: LegalRouteKind.Application,
    })
    expect(
      new LegalRouteProjection(
        new ApplicationRoutePresentation('/vault').getLegalPageFromPath(),
      ).route,
    ).toEqual({
      kind: LegalRouteKind.Application,
    })
  })

  test('loads markdown sources from docs/', () => {
    expect(LEGAL_PAGES.privacy.source).toContain('zero-knowledge')
    expect(LEGAL_PAGES.terms.source).toContain('MIT License')
  })
})
