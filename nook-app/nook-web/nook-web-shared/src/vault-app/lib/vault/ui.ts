import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";

import type { UiActionsContext } from "$lib/vault/action-contexts";
import {
  browserDataLifecycle,
  LocalDataRecoveryQuiescenceOutcome,
  NookDatabaseCleanupOutcome,
  RemoteLocalBrowserDataDeletionOutcome,
} from "$lib/runtime/browser-data";
import { set_vault_session_locked } from "$app-wasm";
import { WorkspaceSection } from "$lib/vault/state/ui.svelte";
import { WorkspaceRoute, WorkspaceLocation } from "$lib/app/workspace-route";

/** Apply browser history to UI state without creating another history entry. */
type WorkspaceRouteApplication = {
  readonly route: WorkspaceRoute;
};

/** Translate between the workspace section a page shows and its URL. */
export class WorkspaceSectionRoute {
  constructor(private readonly section: WorkspaceSection) {}

  get route(): WorkspaceRoute {
    switch (this.section) {
      case WorkspaceSection.Vault:
        return WorkspaceRoute.Vault;
      case WorkspaceSection.Identities:
        return WorkspaceRoute.Identities;
      case WorkspaceSection.Keys:
        return WorkspaceRoute.Keys;
      case WorkspaceSection.Vaults:
        return WorkspaceRoute.Vaults;
      case WorkspaceSection.Settings:
        return WorkspaceRoute.Settings;
      case WorkspaceSection.Devices:
        return WorkspaceRoute.Devices;
      case WorkspaceSection.AddDevice:
        return WorkspaceRoute.AddDevice;
      case WorkspaceSection.Sync:
        return WorkspaceRoute.Sync;
      case WorkspaceSection.Passwords:
        return WorkspaceRoute.Passwords;
      case WorkspaceSection.Import:
        return WorkspaceRoute.Import;
    }
  }
}

/** Owns browser orchestration for one ui context. */
export class VaultWorkspaceActions {
  constructor(private readonly state: UiActionsContext) {}

  /** Refreshes read through the engine. A page opened by URL is applied
   * before the engine is open; startup reads that state itself. */
  private reportRefresh(): void {
    const state = this.state;
    if (!state.hasManager) return;
    void state.refreshDeviceState().then((refreshed) => {
      if (refreshed.isOk()) return;
      // A backup-password session has no device key to sync with; the
      // page still shows what this browser last read.
      const passwordSession =
        refreshed.error instanceof StorageOperationFailure &&
        refreshed.error.kind ===
          StorageOperationFailureKind.DeviceAuthorizationRequired;
      if (!passwordSession)
        state.errorMsg = state.t(refreshed.error.translationKey);
    });
  }

  private refreshCatalog(): void {
    const state = this.state;
    if (!state.hasManager) return;
    void state.refreshLocalVaultCatalog().then((result) => {
      if (result.isErr()) state.errorMsg = state.t(result.error.translationKey);
    });
  }

  private applySection(section: WorkspaceSection): void {
    const state = this.state;
    state.helpOpen = false;
    state.workspaceSection = section;
    switch (section) {
      case WorkspaceSection.Keys:
        // Access reads last-known evidence. A vault sync here races that
        // snapshot when the Keys page remounts.
        return;
      case WorkspaceSection.Devices:
      case WorkspaceSection.AddDevice:
        // Enrolled devices read the same last-known evidence as Keys.
        state.cancelProviderSetup();
        state.cancelAddProvider();
        return;
      case WorkspaceSection.Vault:
        state.cancelProviderSetup();
        state.cancelAddProvider();
        return;
      case WorkspaceSection.Identities:
        state.cancelProviderSetup();
        state.cancelAddProvider();
        this.refreshCatalog();
        return;
      case WorkspaceSection.Settings:
        state.cancelProviderSetup();
        state.cancelAddProvider();
        this.reportRefresh();
        return;
      case WorkspaceSection.Vaults:
      case WorkspaceSection.Sync:
      case WorkspaceSection.Passwords:
      case WorkspaceSection.Import:
        state.cancelProviderSetup();
        state.cancelAddProvider();
        this.refreshCatalog();
        this.reportRefresh();
        return;
    }
  }

  applyWorkspaceRoute({ route }: WorkspaceRouteApplication): void {
    const state = this.state;
    switch (route) {
      case WorkspaceRoute.Help:
        state.workspaceSection = WorkspaceSection.Vault;
        state.helpOpen = true;
        return;
      case WorkspaceRoute.Vault:
        this.applySection(WorkspaceSection.Vault);
        return;
      case WorkspaceRoute.Identities:
        this.applySection(WorkspaceSection.Identities);
        return;
      case WorkspaceRoute.Keys:
        this.applySection(WorkspaceSection.Keys);
        return;
      case WorkspaceRoute.Vaults:
        this.applySection(WorkspaceSection.Vaults);
        return;
      case WorkspaceRoute.Settings:
        this.applySection(WorkspaceSection.Settings);
        return;
      case WorkspaceRoute.Devices:
        this.applySection(WorkspaceSection.Devices);
        return;
      case WorkspaceRoute.AddDevice:
        this.applySection(WorkspaceSection.AddDevice);
        return;
      case WorkspaceRoute.Sync:
        this.applySection(WorkspaceSection.Sync);
        return;
      case WorkspaceRoute.Passwords:
        this.applySection(WorkspaceSection.Passwords);
        return;
      case WorkspaceRoute.Import:
        this.applySection(WorkspaceSection.Import);
        return;
    }
  }

  /** Navigate to a workspace page and apply it. */
  openSection(section: WorkspaceSection): void {
    const state = this.state;
    const navigation = new WorkspaceLocation(
      new WorkspaceSectionRoute(section).route,
    ).navigate();
    if (navigation.isErr()) {
      state.errorMsg = state.t(navigation.error.translationKey);
      return;
    }
    this.applySection(section);
  }

  async deleteLocalData(): Promise<void> {
    const state = this.state;
    if (!state.hasManager || state.isSaving || state.localDataDeletionStarted)
      return;
    state.errorMsg = "";
    state.dismissSuccess();
    state.isSaving = true;
    try {
      const supported = browserDataLifecycle.requireLocalDataRecoverySupport();
      if (supported.isErr()) {
        state.errorMsg = state.t(supported.error.translationKey);
        return;
      }
      const admitted = state.admitManager();
      if (admitted.isErr()) {
        state.errorMsg = state.t(admitted.error.translationKey);
        return;
      }
      await state.waitForStorageChain();
      state.stopIdleSessionTracking();
      state.stopVaultSync();
      state.localDataDeletionStarted = true;
      const deletion = await browserDataLifecycle.deleteLocalBrowserData(
        async () => {
          try {
            await admitted.value.delete_local_browser_data();
            return storageOk(NookDatabaseCleanupOutcome.Cleared);
          } catch {
            return storageErr(
              new StorageOperationFailure(
                StorageOperationFailureKind.DatabaseCleanupFailed,
              ),
            );
          }
        },
      );
      if (deletion.isErr()) {
        set_vault_session_locked(true);
        state.clearUnlockedSession(false);
        state.localDataDeletionStarted = false;
        state.errorMsg = state.t(deletion.error.translationKey);
      }
    } finally {
      state.isSaving = false;
    }
  }

  async handleRemoteLocalBrowserDataDeletion(): Promise<
    Result<RemoteLocalBrowserDataDeletionOutcome, StorageOperationFailure>
  > {
    const state = this.state;
    if (state.localDataDeletionStarted) {
      return storageErr(
        new StorageOperationFailure(StorageOperationFailureKind.DeletionActive),
      );
    }
    const resetManager = state.hasManager
      ? state.enqueueStorage(async () => {
          const manager = state.admitManager();
          if (manager.isErr()) return storageErr(manager.error);
          try {
            manager.value.quiesce_for_local_recovery();
            return storageOk(LocalDataRecoveryQuiescenceOutcome.Quiesced);
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure));
          }
        })
      : state
          .waitForStorageChain()
          .then(() => storageOk(LocalDataRecoveryQuiescenceOutcome.Quiesced));
    state.localDataDeletionStarted = true;
    state.stopIdleSessionTracking();
    state.stopVaultSync();
    set_vault_session_locked(true);
    state.clearUnlockedSession(false);
    const quiescence = await resetManager;
    const cleanup = browserDataLifecycle.clearTabScopedBrowserData();
    if (quiescence.isErr()) return storageErr(quiescence.error);
    return cleanup.map(() => RemoteLocalBrowserDataDeletionOutcome.Quiesced);
  }

  openHelp(): void {
    const state = this.state;
    const navigation = new WorkspaceLocation(WorkspaceRoute.Help).navigate();
    if (navigation.isErr()) {
      state.errorMsg = state.t(navigation.error.translationKey);
      return;
    }
    state.workspaceSection = WorkspaceSection.Vault;
    state.helpOpen = true;
  }

  closeHelp(): void {
    const state = this.state;
    const navigation = new WorkspaceLocation(WorkspaceRoute.Vault).navigate();
    if (navigation.isErr()) {
      state.errorMsg = state.t(navigation.error.translationKey);
      return;
    }
    state.helpOpen = false;
  }
}
