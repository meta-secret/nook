import type { VaultState } from '$lib/vault.svelte'
import type { NookAppLocale } from '$app-wasm'
import {
  get_translation_catalog as getTranslationCatalog,
  resolveTranslationCatalog,
} from '$app-wasm'

enum TranslationCatalogLookupKind {
  Unavailable = 'unavailable',
  Loaded = 'loaded',
}

function wasmTranslationCatalog(
  locale: NookAppLocale,
):
  | { kind: TranslationCatalogLookupKind.Unavailable }
  | { kind: TranslationCatalogLookupKind.Loaded; catalog: string } {
  try {
    return {
      kind: TranslationCatalogLookupKind.Loaded,
      catalog: getTranslationCatalog(locale),
    }
  } catch {
    return { kind: TranslationCatalogLookupKind.Unavailable }
  }
}

export async function updateLocale(
  state: VaultState,
  newLocale: NookAppLocale,
  options?: { preferWasm?: boolean },
): Promise<void> {
  state.locale = newLocale
  localStorage.setItem('nook_locale', newLocale)
  if ('document' in globalThis) {
    document.documentElement.lang = newLocale
  }

  const preferWasm = options?.preferWasm ?? Boolean(state.manager)
  if (!preferWasm) {
    state.translations = resolveTranslationCatalog(newLocale)
    return
  }
  const wasmCatalog = wasmTranslationCatalog(newLocale)
  state.translations =
    wasmCatalog.kind === TranslationCatalogLookupKind.Loaded
      ? resolveTranslationCatalog(newLocale, wasmCatalog.catalog)
      : resolveTranslationCatalog(newLocale)
}
