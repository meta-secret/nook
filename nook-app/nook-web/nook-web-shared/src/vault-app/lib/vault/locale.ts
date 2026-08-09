import type { VaultState } from "$lib/vault.svelte";
import type { NookAppLocale } from "$app-wasm";
import {
  defaultTranslationCatalog,
  get_translation_catalog as getTranslationCatalog,
  resolveTranslationCatalog,
} from "$app-wasm";

enum TranslationCatalogLookupKind {
  Unavailable = "unavailable",
  Loaded = "loaded",
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
    };
  } catch {
    return { kind: TranslationCatalogLookupKind.Unavailable };
  }
}

export async function updateLocale({
  state,
  newLocale,
  options,
}: {
  readonly state: VaultState;
  readonly newLocale: NookAppLocale;
  readonly options?: { preferWasm?: boolean };
}): Promise<void> {
  state.locale = newLocale;
  localStorage.setItem("nook_locale", newLocale);
  if ("document" in globalThis) {
    document.documentElement.lang = newLocale;
  }

  const preferWasm = options?.preferWasm ?? state.hasManager;
  if (!preferWasm) {
    state.translations = defaultTranslationCatalog(newLocale);
    return;
  }
  const wasmCatalog = wasmTranslationCatalog(newLocale);
  state.translations =
    wasmCatalog.kind === TranslationCatalogLookupKind.Loaded
      ? resolveTranslationCatalog(newLocale, wasmCatalog.catalog)
      : defaultTranslationCatalog(newLocale);
}
