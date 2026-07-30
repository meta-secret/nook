import {
  getResolvedTranslationCatalog,
  parseStoredAppLocale,
  resolveAppLocaleFromTags,
  StoredAppLocaleInputKind,
  StoredAppLocaleParseKind,
  type StoredAppLocaleInput,
  type NookAppLocale,
} from './nook-wasm'
import { translateFromCatalog } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

export const NOOK_LOCALE_STORAGE_KEY = 'nook_locale'

export type ExtensionI18n = {
  locale: NookAppLocale
  t: (key: string, replacements?: Record<string, string>) => string
}

function readSavedLocale(): StoredAppLocaleInput {
  try {
    const value = localStorage.getItem(NOOK_LOCALE_STORAGE_KEY)
    return value
      ? { kind: StoredAppLocaleInputKind.Stored, value }
      : { kind: StoredAppLocaleInputKind.Missing }
  } catch {
    return { kind: StoredAppLocaleInputKind.Missing }
  }
}

function chromeUiLanguages(): string[] {
  try {
    const language = chrome.i18n?.getUILanguage?.()
    return language ? [language] : []
  } catch {
    return []
  }
}

function navigatorLanguages(): string[] {
  if (!('navigator' in globalThis)) {
    return []
  }

  return [...(navigator.languages ?? []), navigator.language].filter(
    (language): language is string => Boolean(language),
  )
}

function uniqueLanguageTags(tags: string[]): string[] {
  return [...new Set(tags)]
}

export async function resolveExtensionLocale(): Promise<NookAppLocale> {
  const savedLocale = await parseStoredAppLocale(readSavedLocale())
  if (savedLocale.kind === StoredAppLocaleParseKind.Supported) {
    return savedLocale.locale
  }

  return resolveAppLocaleFromTags(
    uniqueLanguageTags([...chromeUiLanguages(), ...navigatorLanguages()]),
  )
}

export async function initializeExtensionI18n(): Promise<ExtensionI18n> {
  const locale = await resolveExtensionLocale()
  const catalog = await getResolvedTranslationCatalog(locale)

  if ('document' in globalThis) {
    document.documentElement.lang = locale
  }

  return {
    locale,
    t(key, replacements) {
      let text = translateFromCatalog(catalog, locale, key)
      if (replacements) {
        for (const [name, value] of Object.entries(replacements)) {
          text = text.replaceAll(`{${name}}`, value)
        }
      }
      return text
    },
  }
}
