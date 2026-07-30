import {
  ColorMode,
  LegalRouteKind,
  type LegalRoute,
} from "$lib/app-lifecycle-state";
import {
  activeVaultScope,
  saveAuthProviders,
  unselectedVaultScope,
  type AuthProvidersSnapshot,
} from "$lib/auth-providers";
import { subscribeToLocalBrowserDataDeletion } from "$lib/browser-data";
import { configuredVaultApplicationName } from "$app-wasm";
import { legalPageForId } from "$lib/legal-content";
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
    snapshot: Parameters<typeof saveAuthProviders>[1],
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

  if (vault.runtimeConfig.exposeDebugHooks()) {
    const debugHooks: BrowserDebugHooks = {
      __nookVault: vault,
      __nookConfiguredVaultApplication: configuredVaultApplicationName(),
      __nookAuthProviders: {
        activeVaultScope,
        loadAuthProviders: () =>
          vault.enqueueStorage(() =>
            vault.requireManager().loadAuthProviders(),
          ),
        saveAuthProviders: (
          snapshot: Parameters<typeof saveAuthProviders>[1],
        ) =>
          vault.enqueueStorage(() =>
            saveAuthProviders(vault.requireManager(), snapshot),
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

export function updateApplicationDocument(
  colorMode: ColorMode,
  legalRoute: LegalRoute,
  logsPage: boolean,
  extensionConnectRoute: boolean,
  sentinelApplication: boolean,
): void {
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
