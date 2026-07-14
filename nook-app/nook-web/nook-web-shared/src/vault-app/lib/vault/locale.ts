import type { VaultState } from "$lib/vault.svelte";
import type { NookAppLocale } from "$app-wasm";
import {
  get_translation_catalog as getTranslationCatalog,
  resolveTranslationCatalog,
} from "$app-wasm";

type TranslationCatalog = string;

export async function updateLocale(
  state: VaultState,
  newLocale: NookAppLocale,
  options?: { preferWasm?: boolean },
): Promise<void> {
  state.locale = newLocale;
  localStorage.setItem("nook_locale", newLocale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = newLocale;
  }

  const preferWasm = options?.preferWasm ?? Boolean(state.manager);
  let wasmCatalog: TranslationCatalog | undefined;
  if (preferWasm) {
    try {
      wasmCatalog = getTranslationCatalog(newLocale);
    } catch {
      // Fall back to the bundled JSON catalogs only.
    }
  }
  state.translations = resolveTranslationCatalog(newLocale, wasmCatalog);
}
