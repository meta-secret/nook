import { describe, expect, test } from 'vitest'
import {
  getTranslationCatalog,
  lookupTranslation,
  mergeTranslationCatalogs,
  translateFromCatalog,
} from '$lib/locale-catalogs'

describe('locale-catalogs', () => {
  test('includes Google Drive provider picker strings', () => {
    for (const locale of ['en', 'ru'] as const) {
      const catalog = getTranslationCatalog(locale)
      expect(lookupTranslation(catalog, 'provider_picker.google_drive')).toBe(
        'Google Drive',
      )
      expect(
        lookupTranslation(catalog, 'provider_picker.google_drive_desc'),
      ).toBeTypeOf('string')
    }
  })

  test('merge overlays bundled keys onto stale wasm catalogs', () => {
    const staleWasm = JSON.stringify({
      provider_picker: {
        this_device: 'Это устройство',
        github: 'GitHub',
      },
    })
    const merged = mergeTranslationCatalogs(
      staleWasm,
      getTranslationCatalog('ru'),
    )
    expect(lookupTranslation(merged, 'provider_picker.google_drive')).toBe(
      'Google Drive',
    )
    expect(lookupTranslation(merged, 'provider_picker.this_device')).toBe(
      'Это устройство',
    )
  })

  test('translateFromCatalog falls back to English', () => {
    const staleRu = JSON.stringify({
      provider_picker: {
        github: 'GitHub',
      },
    })
    expect(
      translateFromCatalog(staleRu, 'ru', 'provider_picker.google_drive'),
    ).toBe('Google Drive')
    expect(
      translateFromCatalog(staleRu, 'en', 'provider_picker.google_drive'),
    ).toBe('provider_picker.google_drive')
  })
})
