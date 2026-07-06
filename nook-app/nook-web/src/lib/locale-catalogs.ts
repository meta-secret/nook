import type { AppLocale } from '$lib/locale'
import {
  default as initNookWasm,
  get_translation_catalog as getTranslationCatalogCore,
  lookupTranslation as lookupTranslationCore,
  mergeTranslationCatalogs as mergeTranslationCatalogsCore,
  resolveTranslationCatalog as resolveTranslationCatalogCore,
  translateFromCatalog as translateFromCatalogCore,
} from './nook-wasm/nook_wasm'

await initNookWasm()

export type TranslationCatalog = string

export function getTranslationCatalog(locale: AppLocale): TranslationCatalog {
  return getTranslationCatalogCore(locale)
}

/** Canonical catalogs embedded in nook-wasm (same JSON as nook-core/locales). */
export async function loadTranslationCatalogFromWasm(
  locale: AppLocale,
): Promise<TranslationCatalog> {
  return getTranslationCatalog(locale)
}

export function lookupTranslation(
  catalog: TranslationCatalog,
  key: string,
): string | undefined {
  return lookupTranslationCore(catalog, key) ?? undefined
}

export function translateFromCatalog(
  catalog: TranslationCatalog,
  locale: AppLocale,
  key: string,
): string {
  return translateFromCatalogCore(catalog, locale, key)
}

/** Overlay wins on conflicts — keeps Vite-bundled keys when WASM is stale. */
export function mergeTranslationCatalogs(
  base: TranslationCatalog,
  overlay: TranslationCatalog,
): TranslationCatalog {
  return mergeTranslationCatalogsCore(base, overlay)
}

export function resolveTranslationCatalog(
  locale: AppLocale,
  wasmCatalog?: TranslationCatalog,
): TranslationCatalog {
  return resolveTranslationCatalogCore(locale, wasmCatalog)
}
