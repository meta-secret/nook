import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk, type Result } from 'neverthrow'
import { VaultStorageFailure as StorageOperationFailure } from '$lib/runtime/storage-failure'
import { ColorMode } from '$lib/app/theme'

import { LegalRouteKind, type LegalRoute } from '$lib/app/route-state'

import {
  activeVaultScope,
  saveAuthProviders,
  unselectedVaultScope,
  type AuthProvidersSnapshot,
} from '$lib/auth/providers'

import { browserDataLifecycle } from '$lib/runtime/browser-data'

import { configured_vault_application_name } from '$app-wasm'

import { LegalPageSelection } from '$lib/content/legal'

import type { VaultState } from '$lib/vault.svelte'

export const THEME_STORAGE_KEY = 'nook_color_mode'

type BrowserLifecycleOptions = {
  vault: VaultState
  followsSystemColorMode(): boolean
  setColorMode(mode: ColorMode): void
  stopFollowingSystemColorMode(): void
  syncRoute(): void
}

type AuthProviderDebugHooks = {
  activeVaultScope(storeId: string): AuthProvidersSnapshot['activeVaultStoreId']
  loadAuthProviders(): Promise<
    Result<AuthProvidersSnapshot, StorageOperationFailure>
  >
  saveAuthProviders(
    snapshot: AuthProvidersSnapshot,
  ): ReturnType<typeof saveAuthProviders>
  unselectedVaultScope(): AuthProvidersSnapshot['activeVaultStoreId']
}

type BrowserDebugHooks = {
  __nookVault: VaultState
  __nookConfiguredVaultApplication: string
  __nookAuthProviders: AuthProviderDebugHooks
}

type ApplicationDocumentUpdate = {
  readonly colorMode: ColorMode
  readonly legalRoute: LegalRoute
  readonly logsPage: boolean
  readonly extensionConnectRoute: boolean
  readonly sentinelApplication: boolean
}

/** Owns this browser host’s resources and interaction lifecycle. */
class VaultBrowserLifecycle {
  constructor(private readonly browser: typeof globalThis) {}

  mountBrowserLifecycle({
    vault,
    followsSystemColorMode,
    setColorMode,
    stopFollowingSystemColorMode,
    syncRoute,
  }: BrowserLifecycleOptions): () => void {
    const colorScheme = this.browser.window.matchMedia(
      '(prefers-color-scheme: dark)',
    )
    const savedMode = this.browser.localStorage.getItem(THEME_STORAGE_KEY)
    if (savedMode === ColorMode.Light || savedMode === ColorMode.Dark) {
      setColorMode(savedMode)
      stopFollowingSystemColorMode()
    } else {
      setColorMode(colorScheme.matches ? ColorMode.Dark : ColorMode.Light)
    }
    const handleColorSchemeChange = (event: MediaQueryListEvent) => {
      if (followsSystemColorMode()) {
        setColorMode(event.matches ? ColorMode.Dark : ColorMode.Light)
      }
    }
    colorScheme.addEventListener('change', handleColorSchemeChange)
    const unsubscribeLocalDataDeletion =
      browserDataLifecycle.subscribeToLocalBrowserDataDeletion(() =>
        vault.handleRemoteLocalBrowserDataDeletion(),
      )
    if (unsubscribeLocalDataDeletion.isErr()) {
      vault.errorMsg = vault.t(unsubscribeLocalDataDeletion.error.translationKey)
    }
    void vault.init()

    if (vault.runtimeConfig.expose_debug_hooks()) {
      const debugHooks: BrowserDebugHooks = {
        __nookVault: vault,
        __nookConfiguredVaultApplication: configured_vault_application_name(),
        __nookAuthProviders: {
          activeVaultScope,
          loadAuthProviders: () =>
            vault.enqueueStorage(async () => {
              const admittedManager = vault.admitManager()
              if (admittedManager.isErr()) return storageErr(admittedManager.error)
              try {
                return storageOk(
                  await admittedManager.value.load_auth_providers_snapshot(),
                )
              } catch (nativeFailure) {
                return storageErr(new NativeVaultStorageFailure(nativeFailure))
              }
            }),
          saveAuthProviders: (snapshot: AuthProvidersSnapshot) =>
            vault.enqueueStorage(async () => {
              const manager = vault.admitManager()
              if (manager.isErr()) return storageErr(manager.error)
              return saveAuthProviders({ manager: manager.value, snapshot })
            }),
          unselectedVaultScope,
        },
      }
      Object.assign(this.browser.window, debugHooks)
    }

    syncRoute()
    this.browser.window.addEventListener('popstate', syncRoute)
    this.browser.window.addEventListener('hashchange', syncRoute)

    return () => {
      vault.stopVaultSync()
      vault.stopIdleSessionTracking()
      void vault.lockDeviceProtection()
      this.browser.window.removeEventListener('popstate', syncRoute)
      this.browser.window.removeEventListener('hashchange', syncRoute)
      colorScheme.removeEventListener('change', handleColorSchemeChange)
      if (unsubscribeLocalDataDeletion.isOk()) unsubscribeLocalDataDeletion.value()
    }
  }

  updateApplicationDocument({
    colorMode,
    legalRoute,
    logsPage,
    extensionConnectRoute,
    sentinelApplication,
  }: ApplicationDocumentUpdate): void {
    this.browser.document.documentElement.classList.toggle(
      'dark',
      colorMode === ColorMode.Dark,
    )
    if (legalRoute.kind === LegalRouteKind.Legal) {
      this.browser.document.title = `${new LegalPageSelection(legalRoute.page).legalPageForId().title} · Nook`
      return
    }
    if (logsPage) {
      this.browser.document.title = 'Application logs · Nook'
      return
    }
    if (extensionConnectRoute) {
      this.browser.document.title = 'Approve extension · Nook'
      return
    }
    this.browser.document.title = sentinelApplication
      ? 'Nook Sentinel Vault'
      : 'Nook Simple Vault'
  }
}

export const vaultBrowserLifecycle = new VaultBrowserLifecycle(globalThis)
