import type { SyncActionsContext } from "$lib/vault/action-contexts";
import {
  importNamedLocalVaultBlob,
  NookSyncConflictReviewState,
  RemoteVaultRecoveryState,
  setActiveVault,
  setVaultSessionLocked,
  type NookReplacementConflict,
  type NookSecurityConflict,
  VaultSyncConflictKind,
} from "$app-wasm";
import { createLogger } from "$lib/runtime/log";
import type { NookSecretRecord } from "$lib/nook";
import { LoginSetupKind } from "$lib/vault/state/provider.svelte";
import {
  ConflictProviderSaveKind,
  type ConflictProviderSave,
} from "$lib/vault/sync-operation-state";
import { StagedRemoteStorageKind } from "$lib/vault/state/provider.svelte";
import {
  localFolderHandle,
  LocalFolderHandleKind,
  localFolderProviderConfiguration,
  LocalFolderProviderConfigurationKind,
  scopedProviderVault,
} from "$lib/auth/providers";
import { refreshLoginUnlockCapabilities } from "$lib/vault/login-unlock-capabilities";

const log = createLogger("vault-sync-resolution");

export async function resolveReplacementConflict(
  state: SyncActionsContext,
  oldSecretId: string,
  chosenSecretId: string,
): Promise<void> {
  if (!state.hasManager || state.isSaving) return;
  state.isSaving = true;
  state.errorMsg = "";
  try {
    const raw = await state.enqueueStorage(() =>
      state
        .requireManager()
        .resolveProjectionConflict(oldSecretId, chosenSecretId),
    );
    for (const record of raw as NookSecretRecord[]) record.free();
    await state.refreshSecretsFromSession();
    await state.refreshReplacementConflicts();
    void state.runFanOutSyncAfterLocalSave();
    state.showSuccess(state.t("toasts.secret_conflict_resolved"));
  } catch (error: unknown) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : state.t("errors.conflict_resolution_failed");
  } finally {
    state.isSaving = false;
  }
}

export async function refreshReplacementConflicts(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.hasManager) {
    state.replacementConflicts = [];
    state.securityConflicts = [];
    return;
  }
  // These borrow the wasm manager (`&mut self`); route them through the storage
  // chain so they never alias an in-flight foreground op (e.g. a delete), which
  // would trigger a wasm-bindgen recursive-borrow hang/panic.
  const [conflicts, securityConflicts] = await state.enqueueStorage(
    async () => {
      if (!state.requireManager().eventLogMode()) {
        return [
          [] as NookReplacementConflict[],
          [] as NookSecurityConflict[],
        ] as const;
      }
      // Both wasm methods take `&mut self`; starting them together causes their
      // IndexedDB callbacks to re-enter a dropped wasm-bindgen closure. Keep
      // this pair serial even though the outer storage operation is queued.
      const conflicts = await state.requireManager().listProjectionConflicts();
      const securityConflicts = await state
        .requireManager()
        .listProjectionSecurityConflicts();
      return [conflicts, securityConflicts] as const;
    },
  );
  state.replacementConflicts = conflicts.map((conflict) => {
    const candidates = conflict.candidates.map((candidate) => {
      const value = {
        eventId: candidate.eventId,
        secretId: candidate.secretId,
      };
      candidate.free();
      return value;
    });
    const value = { oldSecretId: conflict.oldSecretId, candidates };
    conflict.free();
    return value;
  });
  state.securityConflicts = securityConflicts.map((conflict) => {
    const value = { events: conflict.events, reasons: conflict.reasons };
    conflict.free();
    return value;
  });
}

export async function resolveSyncConflictKeepLocal(
  state: SyncActionsContext,
): Promise<void> {
  const review = state.syncConflictReview;
  if (
    review.state !== NookSyncConflictReviewState.RequiresDecision ||
    state.isVerifying
  )
    return;
  const conflict = review;

  state.isVerifying = true;
  state.errorMsg = "";
  log.info("sync conflict resolved (keep local)", {
    provider: conflict.providerLabel,
    kind: conflict.conflictKind,
  });
  state.errorMsg = state.t("errors.whole_vault_conflict_resolution_retired");
  state.isVerifying = false;
}

export async function resolveSyncConflictKeepRemote(
  state: SyncActionsContext,
): Promise<void> {
  const review = state.syncConflictReview;
  if (
    review.state !== NookSyncConflictReviewState.RequiresDecision ||
    state.isVerifying
  )
    return;
  const conflict = review;

  log.info("sync conflict resolved (keep remote)", {
    provider: conflict.providerLabel,
    kind: conflict.conflictKind,
  });
  state.errorMsg = state.t("errors.whole_vault_conflict_resolution_retired");
  state.isVerifying = false;
}

export async function confirmRecoverRemoteVault(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.hasManager) return;
  state.errorMsg = "";
  state.isVerifying = true;
  try {
    await state.enqueueStorage(() =>
      state.requireManager().prepareConnectFromLocalCache(),
    );
    state.remoteVaultRecoveryState = RemoteVaultRecoveryState.ConnectFromCache;
    if (state.loginSetup.kind === LoginSetupKind.Active) {
      await state.loadDb();
      return;
    }
    await state.refreshPasswordEntriesList();
  } catch (error: unknown) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Could not load the local vault copy.";
  } finally {
    state.isVerifying = false;
  }
}

export async function confirmCreateFreshRemoteVault(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.hasManager) return;
  state.errorMsg = "";
  state.remoteVaultRecoveryState = RemoteVaultRecoveryState.ConnectFresh;
  if (state.loginSetup.kind === LoginSetupKind.Active) {
    state.isVerifying = true;
    try {
      await state.loadDb();
    } catch (error: unknown) {
      state.errorMsg =
        error instanceof Error
          ? error.message
          : "Could not create a new vault file.";
    } finally {
      state.isVerifying = false;
    }
  }
}

export function clearRemoteVaultRecovery(state: SyncActionsContext): void {
  state.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
  try {
    if (state.hasManager) state.requireManager().clearConnectRecovery();
  } catch {
    // Engine not ready yet.
  }
}

/** Finish connect/sync that was paused when the conflict dialog opened. */
async function resumeConnectAfterSyncConflict(
  state: SyncActionsContext,
  providerId: string,
  pendingProvider: boolean,
): Promise<void> {
  if (state.isAuthenticated) {
    if (!pendingProvider) {
      await state.syncProviderById(providerId, { quiet: true });
    }
    await state.hydrateMultiDeviceState();
    return;
  }
  if (!state.hasManager) return;
  if (
    state.stagedRemoteStorageArgs().kind ===
      StagedRemoteStorageKind.Unavailable &&
    state.syncProviders.length === 0
  ) {
    return;
  }
  await state.loadDb();
}

export async function resolveSyncConflictImportRemote(
  state: SyncActionsContext,
): Promise<void> {
  const review = state.syncConflictReview;
  if (
    review.state !== NookSyncConflictReviewState.RequiresDecision ||
    review.conflictKind !== VaultSyncConflictKind.StoreId ||
    state.isVerifying
  ) {
    return;
  }
  const conflict = review;
  const remoteStoreId = conflict.remoteStoreId();
  if (!remoteStoreId) return;
  const pendingProvider = conflict.isPendingProvider;
  const providerLabel = conflict.providerLabel;

  state.isVerifying = true;
  state.errorMsg = "";
  let providerSave: ConflictProviderSave;
  let importedAsSeparateVault = false;
  try {
    let importedStoreId: string;
    if (conflict.remoteYaml.trim()) {
      importedStoreId = await importNamedLocalVaultBlob(
        conflict.remoteYaml,
        conflict.providerLabel,
      );
    } else {
      if (!state.hasManager) {
        throw new Error(state.t("errors.manager_uninitialized"));
      }
      const provider = state.providers.find(
        (p) => p.id === conflict.providerId,
      );
      if (provider && provider.type === "local-folder") {
        const configuration = localFolderProviderConfiguration(provider);
        if (
          configuration.kind === LocalFolderProviderConfigurationKind.Missing
        ) {
          throw new Error(state.t("auth_storage.local_folder_choose_err"));
        }
        const handle = localFolderHandle(configuration.config);
        if (handle.kind === LocalFolderHandleKind.Unselected) {
          throw new Error(state.t("auth_storage.local_folder_choose_err"));
        }
        importedStoreId = (await state.enqueueStorage(() =>
          state
            .requireManager()
            .importLocalFolderEventLogAsLocalVault(handle.handleId),
        )) as string;
      } else {
        importedStoreId = (await state.enqueueStorage(() =>
          state
            .requireManager()
            .importProviderEventLogAsLocalVault(
              conflict.mode,
              conflict.pat,
              conflict.repo,
            ),
        )) as string;
      }
    }
    await setActiveVault(importedStoreId);
    state.openActiveVault(importedStoreId);
    state.localVaultPresent = true;
    await state.refreshLocalVaultCatalog();
    // Keep every prior local vault discoverable. Selecting the imported vault
    // here used to hide the multi-vault picker even though the toast tells the
    // user to unlock from that picker.
    if (state.localVaults.length > 1) {
      state.clearSelectedLoginVaultStore();
    } else {
      state.selectLoginVault(importedStoreId);
    }
    const providerId = await state.ensureProviderSavedAfterConflict(conflict);
    providerSave = { kind: ConflictProviderSaveKind.Saved, providerId };
    if (conflict.remoteYaml.trim()) {
      const remoteRevision = conflict.remoteRevision;
      await state.updateProviderSyncMetadata(
        providerId,
        conflict.remoteYaml,
        remoteRevision,
      );
    } else {
      state.providers = state.providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              storeId: scopedProviderVault(importedStoreId),
            }
          : provider,
      );
      await state.persistProviders();
    }
    state.finishStagedProviderConnectAfterConflict(conflict);
    state.clearPendingSyncConflict();
    await state.syncActiveVaultStoreIdToAuth();
    importedAsSeparateVault = true;
    setVaultSessionLocked(true);
    state.clearUnlockedSession();
    await state.refreshPasswordEntriesList();
    if (state.localVaults.length <= 1) {
      await refreshLoginUnlockCapabilities(state);
    }
    state.showSuccess(
      state.t("auth_storage.sync_conflict_imported_vault", {
        provider: providerLabel,
      }),
    );
  } catch (error: unknown) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : state.t("auth_storage.sync_failed");
    providerSave = { kind: ConflictProviderSaveKind.NotSaved };
  } finally {
    state.isVerifying = false;
  }
  if (
    providerSave.kind === ConflictProviderSaveKind.Saved &&
    !importedAsSeparateVault
  ) {
    await resumeConnectAfterSyncConflict(
      state,
      providerSave.providerId,
      pendingProvider,
    );
  }
}
