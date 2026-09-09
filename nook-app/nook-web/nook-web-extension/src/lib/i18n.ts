import {
  StoredAppLocaleInputKind,
  StoredAppLocaleParseKind,
  type StoredAppLocaleInput,
  type NookAppLocale,
  extensionWasmRuntime,
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

export type ExtensionI18n = {
  locale: NookAppLocale
  t: (request: ExtensionTranslationRequest) => string
}

type ExtensionLanguageTagCandidates = string[]

/** Owns this browser host’s resources and interaction lifecycle. */
class ExtensionLocaleCatalog {
  constructor(private readonly browser: typeof globalThis) {}

  plainExtensionTranslation(key: I18nKey): ExtensionTranslationRequest {
    return { kind: ExtensionTranslationRequestKind.Plain, key }
  }

  private readSavedLocale(): StoredAppLocaleInput {
    try {
      const value = this.browser.localStorage.getItem(NOOK_LOCALE_STORAGE_KEY)
      return value
        ? { kind: StoredAppLocaleInputKind.Stored, value }
        : { kind: StoredAppLocaleInputKind.Missing }
    } catch {
      return { kind: StoredAppLocaleInputKind.Missing }
    }
  }

  private chromeUiLanguages(): string[] {
    try {
      const language = this.browser.chrome.i18n?.getUILanguage?.()
      return language ? [language] : []
    } catch {
      return []
    }
  }

  private navigatorLanguages(): string[] {
    if (!('navigator' in this.browser)) {
      return []
    }

    return [
      ...((v) => (v ? v : []))(this.browser.navigator.languages),
      this.browser.navigator.language,
    ].filter((language): language is string => Boolean(language))
  }

  private uniqueLanguageTags(tags: ExtensionLanguageTagCandidates): string[] {
    return [...new Set(tags)]
  }

  async resolveExtensionLocale(): Promise<NookAppLocale> {
    const savedLocale = await extensionWasmRuntime.parseStoredAppLocale(
      this.readSavedLocale(),
    )
    if (savedLocale.kind === StoredAppLocaleParseKind.Supported) {
      return savedLocale.locale
    }

    const languageTagCandidates: ExtensionLanguageTagCandidates = [
      ...this.chromeUiLanguages(),
      ...this.navigatorLanguages(),
    ]
    return extensionWasmRuntime.selectExtensionAppLocale(
      this.uniqueLanguageTags(languageTagCandidates),
    )
  }

  async initializeExtensionI18n(): Promise<ExtensionI18n> {
    const locale = await this.resolveExtensionLocale()
    const catalog =
      await extensionWasmRuntime.getResolvedTranslationCatalog(locale)

    if ('document' in this.browser) {
      this.browser.document.documentElement.lang = locale
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
}

export const extensionLocaleCatalog = new ExtensionLocaleCatalog(globalThis)
