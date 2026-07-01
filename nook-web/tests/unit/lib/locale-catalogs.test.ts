import { describe, expect, test } from 'vitest'
import {
  TRANSLATION_CATALOGS,
  lookupTranslation,
  mergeTranslationCatalogs,
} from '$lib/locale-catalogs'

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

  test('merge overlays bundled keys onto stale wasm catalogs', () => {
    const staleWasm = {
      provider_picker: {
        this_device: 'Это устройство',
        github: 'GitHub',
      },
    }
    const merged = mergeTranslationCatalogs(staleWasm, TRANSLATION_CATALOGS.ru)
    expect(lookupTranslation(merged, 'provider_picker.google_drive')).toBe(
      'Google Drive',
    )
    expect(lookupTranslation(merged, 'provider_picker.this_device')).toBe(
      'Это устройство',
    )
  })
})
