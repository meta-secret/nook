import type { AppLocale } from '$lib/locale'
import enTranslations from '../../../nook-core/locales/en.json'
import ruTranslations from '../../../nook-core/locales/ru.json'

/** Vite-bundled catalogs — used before WASM loads and as English fallback. */
export const TRANSLATION_CATALOGS: Record<
  AppLocale,
  Record<string, unknown>
> = {
  en: enTranslations,
  ru: ruTranslations,
}

/** Canonical catalogs embedded in nook-wasm (same JSON as nook-core/locales). */
export async function loadTranslationCatalogFromWasm(
  locale: AppLocale,
): Promise<Record<string, unknown>> {
  const wasm = await import('./nook-wasm/nook_wasm.js')
  await wasm.default()
  return JSON.parse(wasm.get_translation_catalog(locale)) as Record<
    string,
    unknown
  >
}

export function lookupTranslation(
  catalog: Record<string, unknown>,
  key: string,
): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part]
    }
    return undefined
  }, catalog)
}
