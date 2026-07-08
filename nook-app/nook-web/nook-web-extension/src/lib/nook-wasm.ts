import {
  defaultPasswordGenerationOptions,
  generatePasswordWithOptions,
  type PasswordGenerationOptions,
} from '../../../nook-web-shared/src/password/generator'
import {
  default as initNookWasm,
  generatePassword as wasmGeneratePassword,
  get_translation_catalog as wasmGetTranslationCatalog,
  parseAppLocale as wasmParseAppLocale,
  resolveAppLocaleFromTags as wasmResolveAppLocaleFromTags,
  resolveTranslationCatalog as wasmResolveTranslationCatalog,
  translateFromCatalog as wasmTranslateFromCatalog,
  type NookAppLocale,
} from '../../../nook-web-app/src/lib/nook-wasm/nook_wasm'

let initPromise: Promise<unknown> | undefined

export type { NookAppLocale }

export function ensureNookWasm() {
  initPromise ??= initNookWasm()
  return initPromise
}

export async function generateSuggestedPassword(
  options: PasswordGenerationOptions = defaultPasswordGenerationOptions,
): Promise<string> {
  await ensureNookWasm()
  return generatePasswordWithOptions(wasmGeneratePassword, options)
}

export async function parseStoredAppLocale(
  value: string | undefined,
): Promise<NookAppLocale | undefined> {
  await ensureNookWasm()
  return wasmParseAppLocale(value) as NookAppLocale | undefined
}

export async function resolveAppLocaleFromTags(
  tags: string[],
): Promise<NookAppLocale> {
  await ensureNookWasm()
  return wasmResolveAppLocaleFromTags(tags) as NookAppLocale
}

export async function getResolvedTranslationCatalog(
  locale: NookAppLocale,
): Promise<string> {
  await ensureNookWasm()
  let wasmCatalog: string | undefined
  try {
    wasmCatalog = wasmGetTranslationCatalog(locale)
  } catch {
    wasmCatalog = undefined
  }
  return wasmResolveTranslationCatalog(locale, wasmCatalog)
}

export function translateFromExtensionCatalog(
  catalog: string,
  locale: NookAppLocale,
  key: string,
): string {
  return wasmTranslateFromCatalog(catalog, locale, key)
}
