import type { VaultState } from "$lib/vault.svelte";
import type { NookAppLocale } from "$app-wasm";
import {
  default_translation_catalog,
  get_translation_catalog,
  resolve_translation_catalog,
} from "$app-wasm";

enum TranslationCatalogLookupKind {
  Unavailable = "unavailable",
  Loaded = "loaded",
}

export type LocaleUpdate = {
  readonly state: VaultState;
  readonly newLocale: NookAppLocale;
  readonly preferWasm: boolean;
};

function wasmTranslationCatalog(
  locale: NookAppLocale,
):
  | { kind: TranslationCatalogLookupKind.Unavailable }
  | { kind: TranslationCatalogLookupKind.Loaded; catalog: string } {
  try {
    return {
      kind: TranslationCatalogLookupKind.Loaded,
      catalog: get_translation_catalog(locale),
    };
  } catch {
    return { kind: TranslationCatalogLookupKind.Unavailable };
  }
}

export async function updateLocale({
  state,
  newLocale,
  preferWasm,
}: LocaleUpdate): Promise<void> {
  state.locale = newLocale;
  localStorage.setItem("nook_locale", newLocale);
  if ("document" in globalThis) {
    document.documentElement.lang = newLocale;
  }

  if (!preferWasm) {
    state.translations = default_translation_catalog(newLocale);
    return;
  }
  const wasmCatalog = wasmTranslationCatalog(newLocale);
  state.translations =
    wasmCatalog.kind === TranslationCatalogLookupKind.Loaded
      ? resolve_translation_catalog(newLocale, wasmCatalog.catalog)
      : default_translation_catalog(newLocale);
}
