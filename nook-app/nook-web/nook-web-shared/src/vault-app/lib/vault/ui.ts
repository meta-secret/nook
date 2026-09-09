import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk, type Result } from 'neverthrow'
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from '$lib/runtime/storage-failure'

import type {
  OpenAdminAccordion,
  SettingsNavigationRequest,
  UiActionsContext,
} from '$lib/vault/action-contexts'
import { browserDataLifecycle } from '$lib/runtime/browser-data'
import { set_vault_session_locked } from '$app-wasm'
import {
  AdminAccordionSection,
  SettingsAccordionSection,
  SettingsSection,
} from '$lib/vault/state/ui.svelte'
import { WorkspaceRoute, WorkspaceLocation } from '$lib/app/workspace-route'

export type OpenSettingsRequest = SettingsNavigationRequest & {}

type SettingsViewSelection = {
  readonly section: SettingsSection
  readonly accordion: SettingsAccordionSection
}

type AdminViewSelection = {
  readonly accordion: OpenAdminAccordion
}

/** Apply browser history to UI state without creating another history entry. */
type WorkspaceRouteApplication = {
  readonly route: WorkspaceRoute
}

type AdminPanelOpening = {
  readonly accordion: OpenAdminAccordion
}

/** Owns browser orchestration for one ui context. */
export class VaultWorkspaceActions {
  constructor(private readonly state: UiActionsContext) {}

  static pushWorkspaceRoute(route: WorkspaceRoute): void {
    if (!('window' in globalThis)) return
    const path = new WorkspaceLocation(route).path
    const nextUrl = new URL(path, window.location.href)
    if (
      window.location.pathname === nextUrl.pathname &&
      window.location.search === '' &&
      window.location.hash === ''
    ) {
      return
    }
    const pushStateArgs: Parameters<typeof window.history.pushState>[0] = {}
    window.history.pushState(pushStateArgs, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  private applySettings({ section, accordion }: SettingsViewSelection): void {
    const state = this.state
    state.helpOpen = false
    state.settingsSection = section
    if (section === SettingsSection.Storage) {
      state.cancelProviderSetup()
      state.cancelAddProvider()
      state.settingsAccordionSection = accordion
    }
    state.settingsOpen = true
    // Access and enrolled-device settings read last-known evidence. A vault
    // sync here races that snapshot when the dashboard remounts after leaving
    // Access through "Manage enrolled devices".
    const skipDeviceRefresh =
      section === SettingsSection.DevicesAccess ||
      (section === SettingsSection.Storage &&
        accordion === SettingsAccordionSection.Devices)
    if (!skipDeviceRefresh) {
      void state.refreshDeviceState()
    }
  }

  private applyAdmin({ accordion }: AdminViewSelection): void {
    const state = this.state
    state.helpOpen = false
    state.cancelProviderSetup()
    state.cancelAddProvider()
    state.adminAccordionSection = accordion
    state.settingsSection = SettingsSection.Admin
    state.settingsOpen = true
    void state.refreshLocalVaultCatalog().then((result) => {
      if (result.isErr()) state.errorMsg = state.t(result.error.translationKey)
    })
    void state.refreshDeviceState()
  }

  private applyVault(): void {
    const state = this.state
    state.cancelProviderSetup()
    state.cancelAddProvider()
    state.settingsOpen = false
    state.helpOpen = false
  }

  applyWorkspaceRoute({ route }: WorkspaceRouteApplication): void {
    const state = this.state
    switch (route) {
      case WorkspaceRoute.Vault:
        this.applyVault()
        return
      case WorkspaceRoute.DevicesAccess:
        ;(() => {
          const applySettingsArgs: Parameters<
            VaultWorkspaceActions['applySettings']
          >[0] = {
            section: SettingsSection.DevicesAccess,
            accordion: SettingsAccordionSection.Devices,
          }
          return this.applySettings(applySettingsArgs)
        })()
        return
      case WorkspaceRoute.Admin:
        ;(() => {
          const applyAdminArgs: Parameters<VaultWorkspaceActions['applyAdmin']>[0] =
            {
              accordion: AdminAccordionSection.Vaults,
            }
          return this.applyAdmin(applyAdminArgs)
        })()
        return
      case WorkspaceRoute.Onboard:
        ;(() => {
          const applySettingsArgs2: Parameters<
            VaultWorkspaceActions['applySettings']
          >[0] = {
            section: SettingsSection.Onboard,
            accordion: SettingsAccordionSection.Devices,
          }
          return this.applySettings(applySettingsArgs2)
        })()
        return
      case WorkspaceRoute.Settings:
        ;(() => {
          const applySettingsArgs3: Parameters<
            VaultWorkspaceActions['applySettings']
          >[0] = {
            section: SettingsSection.Storage,
            accordion: SettingsAccordionSection.Devices,
          }
          return this.applySettings(applySettingsArgs3)
        })()
        return
      case WorkspaceRoute.Help:
        state.settingsOpen = false
        state.helpOpen = true
    }
  }

  private static workspaceRouteForSettings(
    section: SettingsSection,
  ): WorkspaceRoute {
    switch (section) {
      case SettingsSection.DevicesAccess:
        return WorkspaceRoute.DevicesAccess
      case SettingsSection.Admin:
        return WorkspaceRoute.Admin
      case SettingsSection.Onboard:
        return WorkspaceRoute.Onboard
      case SettingsSection.Storage:
        return WorkspaceRoute.Settings
    }
  }

  openSettings({ section, accordion }: OpenSettingsRequest): void {
    const state = this.state
    VaultWorkspaceActions.pushWorkspaceRoute(
      VaultWorkspaceActions.workspaceRouteForSettings(section),
    )
    const applySettingsArgs4: Parameters<VaultWorkspaceActions['applySettings']>[0] =
      {
        section,
        accordion,
      }
    this.applySettings(applySettingsArgs4)
  }

  openAdmin({ accordion }: AdminPanelOpening): void {
    const state = this.state
    VaultWorkspaceActions.pushWorkspaceRoute(WorkspaceRoute.Admin)
    const applyAdminArgs2: Parameters<VaultWorkspaceActions['applyAdmin']>[0] = {
      accordion,
    }
    this.applyAdmin(applyAdminArgs2)
  }

  closeSettings(): void {
    const state = this.state
    VaultWorkspaceActions.pushWorkspaceRoute(WorkspaceRoute.Vault)
    this.applyVault()
  }

  async deleteLocalData(): Promise<void> {
    const state = this.state
    if (!state.hasManager || state.isSaving || state.localDataDeletionStarted) return
    state.errorMsg = ''
    state.dismissSuccess()
    state.isSaving = true
    state.stopIdleSessionTracking()
    state.stopVaultSync()
    try {
      const supported = browserDataLifecycle.requireLocalDataRecoverySupport()
      if (supported.isErr()) {
        state.errorMsg = state.t(supported.error.translationKey)
        return
      }
      const admitted = state.admitManager()
      if (admitted.isErr()) {
        state.errorMsg = state.t(admitted.error.translationKey)
        return
      }
      await state.waitForStorageChain()
      state.localDataDeletionStarted = true
      const deletion = await browserDataLifecycle.deleteLocalBrowserData(
        async () => {
          try {
            await admitted.value.delete_local_browser_data()
            return storageOk(undefined)
          } catch {
            return storageErr(
              new StorageOperationFailure(
                StorageOperationFailureKind.DatabaseCleanupFailed,
              ),
            )
          }
        },
      )
      if (deletion.isErr()) {
        set_vault_session_locked(true)
        state.clearUnlockedSession(false)
        state.localDataDeletionStarted = false
        state.errorMsg = state.t(deletion.error.translationKey)
      }
    } finally {
      state.isSaving = false
    }
  }

  async handleRemoteLocalBrowserDataDeletion(): Promise<
    Result<void, StorageOperationFailure>
  > {
    const state = this.state
    if (state.localDataDeletionStarted) {
      return storageErr(
        new StorageOperationFailure(StorageOperationFailureKind.DeletionActive),
      )
    }
    const resetManager = state.hasManager
      ? state.enqueueStorage(async () => {
          const manager = state.admitManager()
          if (manager.isErr()) return storageErr(manager.error)
          try {
            await manager.value.quiesce_for_local_recovery()
            return storageOk(undefined)
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure))
          }
        })
      : state.waitForStorageChain().then(() => storageOk(undefined))
    state.localDataDeletionStarted = true
    state.stopIdleSessionTracking()
    state.stopVaultSync()
    set_vault_session_locked(true)
    state.clearUnlockedSession(false)
    const quiescence = await resetManager
    const cleanup = browserDataLifecycle.clearTabScopedBrowserData()
    if (quiescence.isErr()) return storageErr(quiescence.error)
    return cleanup
  }

  openHelp(): void {
    const state = this.state
    VaultWorkspaceActions.pushWorkspaceRoute(WorkspaceRoute.Help)
    state.settingsOpen = false
    state.helpOpen = true
  }

  closeHelp(): void {
    const state = this.state
    VaultWorkspaceActions.pushWorkspaceRoute(WorkspaceRoute.Vault)
    state.helpOpen = false
  }
}
