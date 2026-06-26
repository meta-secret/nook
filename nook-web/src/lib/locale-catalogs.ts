import type { AppLocale } from '$lib/locale'
import enTranslations from '../../../nook-core/locales/en.json'
import ruTranslations from '../../../nook-core/locales/ru.json'

export const TRANSLATION_CATALOGS: Record<
  AppLocale,
  Record<string, unknown>
> = {
  en: enTranslations,
  ru: ruTranslations,
}
