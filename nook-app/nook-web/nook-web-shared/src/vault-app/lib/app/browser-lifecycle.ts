import { ColorMode } from "$lib/app/theme";
import { LegalRouteKind, type LegalRoute } from "$lib/app/route-state";
import {
  activeVaultScope,
  saveAuthProviders,
  unselectedVaultScope,
  type AuthProvidersSnapshot,
} from "$lib/auth/providers";
import { subscribeToLocalBrowserDataDeletion } from "$lib/runtime/browser-data";
import { configured_vault_application_name } from "$app-wasm";
import { legalPageForId } from "$lib/content/legal";
import type { VaultState } from "$lib/vault.svelte";

export const THEME_STORAGE_KEY = "nook_color_mode";

type BrowserLifecycleOptions = {
  vault: VaultState;
  followsSystemColorMode(): boolean;
  setColorMode(mode: ColorMode): void;
  stopFollowingSystemColorMode(): void;
  syncRoute(): void;
};

type AuthProviderDebugHooks = {
  activeVaultScope(
    storeId: string,
  ): AuthProvidersSnapshot["activeVaultStoreId"];
  loadAuthProviders(): Promise<AuthProvidersSnapshot>;
  saveAuthProviders(
    snapshot: AuthProvidersSnapshot,
  ): ReturnType<typeof saveAuthProviders>;
  unselectedVaultScope(): AuthProvidersSnapshot["activeVaultStoreId"];
};

type BrowserDebugHooks = {
  __nookVault: VaultState;
  __nookConfiguredVaultApplication: string;
  __nookAuthProviders: AuthProviderDebugHooks;
};

export function mountBrowserLifecycle({
  vault,
  followsSystemColorMode,
  setColorMode,
  stopFollowingSystemColorMode,
  syncRoute,
}: BrowserLifecycleOptions): () => void {
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const savedMode = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedMode === ColorMode.Light || savedMode === ColorMode.Dark) {
    setColorMode(savedMode);
    stopFollowingSystemColorMode();
  } else {
    setColorMode(colorScheme.matches ? ColorMode.Dark : ColorMode.Light);
  }
  const handleColorSchemeChange = (event: MediaQueryListEvent) => {
    if (followsSystemColorMode()) {
      setColorMode(event.matches ? ColorMode.Dark : ColorMode.Light);
    }
  };
  colorScheme.addEventListener("change", handleColorSchemeChange);
  const unsubscribeLocalDataDeletion = subscribeToLocalBrowserDataDeletion(() =>
    vault.handleRemoteLocalBrowserDataDeletion(),
  );
  void vault.init();

  if (vault.runtimeConfig.expose_debug_hooks()) {
    const debugHooks: BrowserDebugHooks = {
      __nookVault: vault,
      __nookConfiguredVaultApplication: configured_vault_application_name(),
      __nookAuthProviders: {
        activeVaultScope,
        loadAuthProviders: () =>
          vault.enqueueStorage(() =>
            vault.requireManager().load_auth_providers_snapshot(),
          ),
        saveAuthProviders: (snapshot: AuthProvidersSnapshot) =>
          vault.enqueueStorage(() =>
            (() => {
              const saveAuthProvidersArgs: Parameters<
                typeof saveAuthProviders
              >[0] = { manager: vault.requireManager(), snapshot };
              return saveAuthProviders(saveAuthProvidersArgs);
            })(),
          ),
        unselectedVaultScope,
      },
    };
    Object.assign(window, debugHooks);
  }

  syncRoute();
  window.addEventListener("popstate", syncRoute);
  window.addEventListener("hashchange", syncRoute);

  return () => {
    vault.stopVaultSync();
    vault.stopIdleSessionTracking();
    void vault.lockDeviceProtection();
    window.removeEventListener("popstate", syncRoute);
    window.removeEventListener("hashchange", syncRoute);
    colorScheme.removeEventListener("change", handleColorSchemeChange);
    unsubscribeLocalDataDeletion();
  };
}

type ApplicationDocumentUpdate = {
  readonly colorMode: ColorMode;
  readonly legalRoute: LegalRoute;
  readonly logsPage: boolean;
  readonly extensionConnectRoute: boolean;
  readonly sentinelApplication: boolean;
};

export function updateApplicationDocument({
  colorMode,
  legalRoute,
  logsPage,
  extensionConnectRoute,
  sentinelApplication,
}: ApplicationDocumentUpdate): void {
  document.documentElement.classList.toggle(
    "dark",
    colorMode === ColorMode.Dark,
  );
  if (legalRoute.kind === LegalRouteKind.Legal) {
    document.title = `${legalPageForId(legalRoute.page).title} · Nook`;
    return;
  }
  if (logsPage) {
    document.title = "Application logs · Nook";
    return;
  }
  if (extensionConnectRoute) {
    document.title = "Approve extension · Nook";
    return;
  }
  document.title = sentinelApplication
    ? "Nook Sentinel Vault"
    : "Nook Simple Vault";
}
