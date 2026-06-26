import { describe, expect, test } from 'vitest'
import {
  TRANSLATION_CATALOGS,
  lookupTranslation,
} from './locale-catalogs'

describe('locale-catalogs', () => {
  test('includes Google Drive provider picker strings', () => {
    for (const locale of ['en', 'ru'] as const) {
      const catalog = TRANSLATION_CATALOGS[locale]
      expect(lookupTranslation(catalog, 'provider_picker.google_drive')).toBe(
        'Google Drive',
      )
      expect(
        lookupTranslation(catalog, 'provider_picker.google_drive_desc'),
      ).toBeTypeOf('string')
    }
  })
})
