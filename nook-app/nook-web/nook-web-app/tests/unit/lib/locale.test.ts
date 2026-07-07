import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm, {
  NookBrowserLocale,
  get_translation_catalog as getTranslationCatalog,
  lookupTranslation,
  mergeTranslationCatalogs,
  parseAppLocale,
  resolveAppLocaleFromTag,
  resolveAppLocaleFromTags,
  translateFromCatalog,
} from '$lib/nook-wasm/nook_wasm'

beforeAll(async () => {
  await initNookWasm()
})

describe('locale', () => {
  test('parseAppLocale accepts only supported values', () => {
    expect(parseAppLocale('en')).toBe('en')
    expect(parseAppLocale('ru')).toBe('ru')
    expect(parseAppLocale('de')).toBeUndefined()
    expect(parseAppLocale(undefined)).toBeUndefined()
  })

  test('resolveAppLocaleFromTag maps BCP 47 tags', () => {
    expect(resolveAppLocaleFromTag('ru-RU')).toBe('ru')
    expect(resolveAppLocaleFromTag('ru_BY')).toBe('ru')
    expect(resolveAppLocaleFromTag('en-GB')).toBe('en')
    expect(resolveAppLocaleFromTag('de-DE')).toBeUndefined()
  })

  test('resolveAppLocaleFromTags respects preference order', () => {
    expect(resolveAppLocaleFromTags(['de-DE', 'ru-RU'])).toBe('ru')
    expect(resolveAppLocaleFromTags(['de-DE', 'fr-FR'])).toBe('en')
    expect(resolveAppLocaleFromTags(['en-US', 'ru-RU'])).toBe('en')
  })

  test('NookBrowserLocale resolves captured browser tags', () => {
    expect(NookBrowserLocale.fromTags(['de-DE', 'ru-RU']).appLocale()).toBe(
      'ru',
    )
  })

  test('catalogs include provider picker strings', () => {
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

  test('catalog merge overlays bundled keys onto stale wasm catalogs', () => {
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
