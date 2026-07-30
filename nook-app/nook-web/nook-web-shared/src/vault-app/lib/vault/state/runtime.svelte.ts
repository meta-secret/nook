import {
  get_translation_catalog as getTranslationCatalog,
  NookBrowserLocale,
  NookClientRunModeUtil,
  NookRuntimeConfig,
  NookVaultClientPolicy,
  type NookAppLocale,
} from "$app-wasm";
export class VaultRuntimeState {
  browserLocale: NookBrowserLocale;
  clientPolicy = new NookVaultClientPolicy();
  runtimeConfig = new NookRuntimeConfig(
    NookClientRunModeUtil.parse(
      import.meta.env.VITE_NOOK_CLIENT_RUN_MODE ?? import.meta.env.MODE,
    ),
    import.meta.env.VITE_E2E_EXPOSE_VAULT === "true",
  );

  locale = $state<NookAppLocale>("en");
  translations = $state(getTranslationCatalog("en"));

  errorMsg = $state("");
  successMsg = $state("");
  isVerifying = $state(false);
  isSaving = $state(false);
  isInitializing = $state(true);

  constructor(browserLocale = new NookBrowserLocale()) {
    this.browserLocale = browserLocale;
  }
}
