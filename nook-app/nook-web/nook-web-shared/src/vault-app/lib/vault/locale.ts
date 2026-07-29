import { omittedValue } from "../../../explicit-state";
import type { VaultState } from "$lib/vault.svelte";
import type { NookAppLocale } from "$app-wasm";
import {
  get_translation_catalog as getTranslationCatalog,
  resolveTranslationCatalog,
} from "$app-wasm";

type TranslationCatalog = string;

function wasmTranslationCatalog(
  locale: NookAppLocale,
): TranslationCatalog | void {
  try {
    return getTranslationCatalog(locale);
  } catch {
    return;
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
    : omittedValue();
  state.translations = resolveTranslationCatalog(newLocale, wasmCatalog);
}
