import type { VaultState } from '$lib/vault.svelte'
import type { AppLocale } from '$lib/locale'
import {
  loadTranslationCatalogFromWasm,
  resolveTranslationCatalog,
} from '$lib/locale-catalogs'

export async function updateLocale(
  state: VaultState,
  newLocale: AppLocale,
  options?: { preferWasm?: boolean },
): Promise<void> {
  state.locale = newLocale
  localStorage.setItem('nook_locale', newLocale)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = newLocale
  }

  const preferWasm = options?.preferWasm ?? Boolean(state.manager)
  let wasmCatalog: Record<string, unknown> | undefined
  if (preferWasm) {
    try {
      wasmCatalog = await loadTranslationCatalogFromWasm(newLocale)
    } catch {
      // Fall back to the bundled JSON catalogs only.
    }
  }
  state.translations = resolveTranslationCatalog(newLocale, wasmCatalog)
}
