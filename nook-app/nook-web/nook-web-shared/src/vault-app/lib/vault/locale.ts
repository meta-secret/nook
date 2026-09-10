import type { VaultState } from "$lib/vault.svelte";
import type { NookAppLocale } from "$app-wasm";
import {
  default_translation_catalog,
  get_translation_catalog,
  resolve_translation_catalog,
  parse_app_locale,
  supported_app_locale_code,
  NookAppLocaleParse,
} from "$app-wasm";
import { err, ok, type Result } from "neverthrow";
import { I18N_KEYS } from "../../../generated/i18n-keys";

export enum LocaleCatalogSource {
  Bundled = "bundled",
  Engine = "engine",
}

export enum LocaleUpdateFailureKind {
  SavedLocaleReadFailed = "saved-locale-read-failed",
  CatalogReadFailed = "catalog-read-failed",
  PreferencePersistenceFailed = "preference-persistence-failed",
  DocumentLanguageUpdateFailed = "document-language-update-failed",
}

export class LocaleUpdateFailure {
  readonly translationKey = I18N_KEYS.ErrorsVaultGeneric;
  constructor(readonly kind: LocaleUpdateFailureKind) {}
}

export enum SavedAppLocaleKind {
  Missing = "missing",
  Supported = "supported",
}

type SavedAppLocale =
  | { readonly kind: SavedAppLocaleKind.Missing }
  | {
      readonly kind: SavedAppLocaleKind.Supported;
      readonly locale: NookAppLocale;
    };

export type LocaleUpdate = {
  readonly newLocale: NookAppLocale;
  readonly catalogSource: LocaleCatalogSource;
};

/** Owns locale catalog preparation and persistence for one application state. */
export class VaultLocaleActions {
  constructor(private readonly state: VaultState) {}

  savedAppLocale(): Result<SavedAppLocale, LocaleUpdateFailure> {
    try {
      const stored = localStorage.getItem("nook_locale");
      if (!stored) return ok({ kind: SavedAppLocaleKind.Missing });
      const parsed = parse_app_locale(stored);
      return ok(
        parsed === NookAppLocaleParse.Unsupported
          ? { kind: SavedAppLocaleKind.Missing }
          : {
              kind: SavedAppLocaleKind.Supported,
              locale: supported_app_locale_code(parsed),
            },
      );
    } catch {
      return err(
        new LocaleUpdateFailure(LocaleUpdateFailureKind.SavedLocaleReadFailed),
      );
    }
  }

  private catalog(request: LocaleUpdate): Result<string, LocaleUpdateFailure> {
    try {
      switch (request.catalogSource) {
        case LocaleCatalogSource.Bundled:
          return ok(default_translation_catalog(request.newLocale));
        case LocaleCatalogSource.Engine:
          return ok(
            resolve_translation_catalog(
              request.newLocale,
              get_translation_catalog(request.newLocale),
            ),
          );
      }
    } catch {
      return err(
        new LocaleUpdateFailure(LocaleUpdateFailureKind.CatalogReadFailed),
      );
    }
  }

  async updateLocale(
    request: LocaleUpdate,
  ): Promise<Result<void, LocaleUpdateFailure>> {
    const catalog = this.catalog(request);
    if (catalog.isErr()) return err(catalog.error);
    try {
      localStorage.setItem("nook_locale", request.newLocale);
    } catch {
      return err(
        new LocaleUpdateFailure(
          LocaleUpdateFailureKind.PreferencePersistenceFailed,
        ),
      );
    }
    try {
      if ("document" in globalThis)
        document.documentElement.lang = request.newLocale;
    } catch {
      return err(
        new LocaleUpdateFailure(
          LocaleUpdateFailureKind.DocumentLanguageUpdateFailed,
        ),
      );
    }
    this.state.locale = request.newLocale;
    this.state.translations = catalog.value;
    return ok();
  }
}
