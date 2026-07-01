import { describe, expect, test } from 'vitest'
import {
  getBrowserAppLocale,
  parseAppLocale,
  resolveAppLocaleFromTag,
  resolveAppLocaleFromTags,
} from '$lib/locale'

describe('locale', () => {
  test('parseAppLocale accepts only supported values', () => {
    expect(parseAppLocale('en')).toBe('en')
    expect(parseAppLocale('ru')).toBe('ru')
    expect(parseAppLocale('de')).toBeNull()
    expect(parseAppLocale(null)).toBeNull()
  })

  test('resolveAppLocaleFromTag maps BCP 47 tags', () => {
    expect(resolveAppLocaleFromTag('ru-RU')).toBe('ru')
    expect(resolveAppLocaleFromTag('ru_BY')).toBe('ru')
    expect(resolveAppLocaleFromTag('en-GB')).toBe('en')
    expect(resolveAppLocaleFromTag('de-DE')).toBeNull()
  })

  test('resolveAppLocaleFromTags respects preference order', () => {
    expect(resolveAppLocaleFromTags(['de-DE', 'ru-RU'])).toBe('ru')
    expect(resolveAppLocaleFromTags(['de-DE', 'fr-FR'])).toBe('en')
    expect(resolveAppLocaleFromTags(['en-US', 'ru-RU'])).toBe('en')
  })

  test('getBrowserAppLocale returns a supported locale', () => {
    expect(['en', 'ru']).toContain(getBrowserAppLocale())
  })
})
