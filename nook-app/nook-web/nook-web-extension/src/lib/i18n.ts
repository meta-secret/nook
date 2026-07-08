import {
  getResolvedTranslationCatalog,
  parseStoredAppLocale,
  resolveAppLocaleFromTags,
  translateFromExtensionCatalog,
  type NookAppLocale,
} from './nook-wasm'

export const NOOK_LOCALE_STORAGE_KEY = 'nook_locale'

export type ExtensionI18n = {
  locale: NookAppLocale
  t: (key: string, replacements?: Record<string, string>) => string
}

function readSavedLocale(): string | undefined {
  try {
    return localStorage.getItem(NOOK_LOCALE_STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function chromeUiLanguage(): string | undefined {
  try {
    return chrome.i18n?.getUILanguage?.()
  } catch {
    return undefined
  }
}

function navigatorLanguages(): string[] {
  if (typeof navigator === 'undefined') {
    return []
  }

  return [...(navigator.languages ?? []), navigator.language].filter(
    (language): language is string => Boolean(language),
  )
}

function uniqueLanguageTags(tags: Array<string | undefined>): string[] {
  return [...new Set(tags.filter((tag): tag is string => Boolean(tag)))]
}

export async function resolveExtensionLocale(): Promise<NookAppLocale> {
  const savedLocale = await parseStoredAppLocale(readSavedLocale())
  if (savedLocale) {
    return savedLocale
  }

  return resolveAppLocaleFromTags(
    uniqueLanguageTags([chromeUiLanguage(), ...navigatorLanguages()]),
  )
}

export async function initializeExtensionI18n(): Promise<ExtensionI18n> {
  const locale = await resolveExtensionLocale()
  const catalog = await getResolvedTranslationCatalog(locale)

  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }

  return {
    locale,
    t(key, replacements) {
      let text = translateFromExtensionCatalog(catalog, locale, key)
      if (replacements) {
        for (const [name, value] of Object.entries(replacements)) {
          text = text.replace(`{${name}}`, value)
        }
      }
      return text
    },
  }
}
