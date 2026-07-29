import type { VaultState } from "$lib/vault.svelte";
import type { NookAppLocale } from "$app-wasm";
import {
  get_translation_catalog as getTranslationCatalog,
  resolveTranslationCatalog,
} from "$app-wasm";

type TranslationCatalog = string;

function wasmTranslationCatalog(
  locale: NookAppLocale,
): TranslationCatalog | undefined {
  try {
    return getTranslationCatalog(locale);
  } catch {
    return undefined;
  }
}

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
  const wasmCatalog = preferWasm
    ? wasmTranslationCatalog(newLocale)
    : undefined;
  state.translations = resolveTranslationCatalog(newLocale, wasmCatalog);
}
