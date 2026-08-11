import {
  getResolvedTranslationCatalog,
  parseStoredAppLocale,
  resolveAppLocaleFromTags,
  StoredAppLocaleInputKind,
  StoredAppLocaleParseKind,
  type StoredAppLocaleInput,
  type NookAppLocale,
} from './nook-wasm'
import { translate_from_catalog } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  I18N_KEYS,
  type I18nKey,
} from '../../../nook-web-shared/src/generated/i18n-keys'

export const NOOK_LOCALE_STORAGE_KEY = 'nook_locale'

export enum ExtensionTranslationRequestKind {
  Plain = 'plain',
  WithReplacements = 'with-replacements',
}

export type ExtensionTranslationRequest =
  | {
      kind: ExtensionTranslationRequestKind.Plain
      key: I18nKey
    }
  | {
      kind: ExtensionTranslationRequestKind.WithReplacements
      key:
        | typeof I18N_KEYS.ExtensionLoginPickerDestination
        | typeof I18N_KEYS.ExtensionAuthenticatorPickerDestination
      replacements: { origin: string }
    }
  | {
      kind: ExtensionTranslationRequestKind.WithReplacements
      key: typeof I18N_KEYS.ExtensionCompanionReadyVault
      replacements: { vault: string }
    }

export function plainExtensionTranslation(
  key: I18nKey,
): ExtensionTranslationRequest {
  return { kind: ExtensionTranslationRequestKind.Plain, key }
}

export type ExtensionI18n = {
  locale: NookAppLocale
  t: (request: ExtensionTranslationRequest) => string
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
    t(request) {
      let text = translate_from_catalog(catalog, locale, request.key)
      if (request.kind === ExtensionTranslationRequestKind.WithReplacements) {
        for (const [name, value] of Object.entries(request.replacements)) {
          text = text.replaceAll(`{${name}}`, value)
        }
      }
      return text
    },
  }
}
