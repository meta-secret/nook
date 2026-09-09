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
  readonly newLocale: NookAppLocale;
  readonly preferWasm: boolean;
};

/** Owns browser orchestration for one locale context. */
export class VaultLocaleActions {
  constructor(private readonly state: VaultState) {}

  private static wasmTranslationCatalog(
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

  async updateLocale({ newLocale, preferWasm }: LocaleUpdate): Promise<void> {
    const state = this.state;
    state.locale = newLocale;
    localStorage.setItem("nook_locale", newLocale);
    if ("document" in globalThis) {
      document.documentElement.lang = newLocale;
    }

    if (!preferWasm) {
      state.translations = default_translation_catalog(newLocale);
      return;
    }
    const wasmCatalog = VaultLocaleActions.wasmTranslationCatalog(newLocale);
    state.translations =
      wasmCatalog.kind === TranslationCatalogLookupKind.Loaded
        ? resolve_translation_catalog(newLocale, wasmCatalog.catalog)
        : default_translation_catalog(newLocale);
  }
}
