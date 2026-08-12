import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { SyncActionsContext } from "$lib/vault/action-contexts";
import {
  import_named_local_vault_blob,
  NookSyncConflictReviewState,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
  RemoteVaultRecoveryState,
  set_active_vault,
  set_vault_session_locked,
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

export interface ReplacementConflictResolution {
  readonly state: SyncActionsContext;
  readonly oldSecretId: string;
  readonly chosenSecretId: string;
}

interface SyncConflictResumption {
  readonly state: SyncActionsContext;
  readonly providerId: string;
  readonly pendingProvider: boolean;
}

export async function resolveReplacementConflict({
  state,
  oldSecretId,
  chosenSecretId,
}: ReplacementConflictResolution): Promise<void> {
  if (!state.hasManager || state.isSaving) return;
  state.isSaving = true;
  state.errorMsg = "";
  try {
    const raw = await state.enqueueStorage(() =>
      state
        .requireManager()
        .resolve_projection_conflict(oldSecretId, chosenSecretId),
    );
    for (const record of raw as NookSecretRecord[]) record.free();
    await state.refreshSecretsFromSession();
    await state.refreshReplacementConflicts();
    void state.runFanOutSyncAfterLocalSave();
    state.showSuccess(state.t(I18N_KEYS.ToastsSecretConflictResolved));
  } catch (error) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : state.t(I18N_KEYS.ErrorsConflictResolutionFailed);
  } finally {
    state.isSaving = false;
  }
}

export async function refreshReplacementConflicts(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.hasManager) {
    state.clearProjectionConflicts();
    return;
  }
  // These borrow the wasm manager (`&mut self`); route them through the storage
  // chain so they never alias an in-flight foreground op (e.g. a delete), which
  // would trigger a wasm-bindgen recursive-borrow hang/panic.
  const [conflicts, securityConflicts] = await state.enqueueStorage(
    async () => {
      if (!state.requireManager().event_log_mode()) {
        return [
          [] as NookReplacementConflict[],
          [] as NookSecurityConflict[],
        ] as const;
      }
      // Both wasm methods take `&mut self`; starting them together causes their
      // IndexedDB callbacks to re-enter a dropped wasm-bindgen closure. Keep
      // this pair serial even though the outer storage operation is queued.
      const conflicts = await state
        .requireManager()
        .list_projection_conflicts();
      const securityConflicts = await state
        .requireManager()
        .list_projection_security_conflicts();
      return [conflicts, securityConflicts] as const;
    },
  );
  const replaceProjectionConflictsArgs: Parameters<
    typeof state.replaceProjectionConflicts
  >[0] = { replacementConflicts: conflicts, securityConflicts };
  state.replaceProjectionConflicts(replaceProjectionConflictsArgs);
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
  state.isVerifying = true;
  state.errorMsg = "";
  log.info("sync conflict resolved (keep local)");
  state.errorMsg = state.t(I18N_KEYS.ErrorsWholeVaultConflictResolutionRetired);
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
  log.info("sync conflict resolved (keep remote)");
  state.errorMsg = state.t(I18N_KEYS.ErrorsWholeVaultConflictResolutionRetired);
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
      state.requireManager().prepare_connect_from_local_cache(),
    );
    state.remoteVaultRecoveryState = RemoteVaultRecoveryState.ConnectFromCache;
    if (state.loginSetup.kind === LoginSetupKind.Active) {
      await state.loadDb();
      return;
    }
    await state.refreshPasswordEntriesList();
  } catch (error) {
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
    } catch (error) {
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
    if (state.hasManager) state.requireManager().clear_connect_recovery();
  } catch {
    // Engine not ready yet.
  }
}

/** Finish connect/sync that was paused when the conflict dialog opened. */
async function resumeConnectAfterSyncConflict({
  state,
  providerId,
  pendingProvider,
}: SyncConflictResumption): Promise<void> {
  if (state.isAuthenticated) {
    if (!pendingProvider) {
      const syncProviderByIdArgs: Parameters<typeof state.syncProviderById>[0] =
        {
          providerId,
          visibility: ProviderSyncVisibility.Quiet,
          failureHandling: ProviderSyncFailureHandling.Capture,
        };
      await state.syncProviderById(syncProviderByIdArgs);
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
  const remoteStoreId = conflict.remote_store_id();
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
      importedStoreId = await import_named_local_vault_blob(
        conflict.remoteYaml,
        conflict.providerLabel,
      );
    } else {
      if (!state.hasManager) {
        throw new Error(state.t(I18N_KEYS.ErrorsManagerUninitialized));
      }
      const provider = state.providers.find(
        (p) => p.id === conflict.providerId,
      );
      if (provider && provider.type === "local-folder") {
        const configuration = localFolderProviderConfiguration(provider);
        if (
          configuration.kind === LocalFolderProviderConfigurationKind.Missing
        ) {
          throw new Error(state.t(I18N_KEYS.AuthStorageLocalFolderChooseErr));
        }
        const handle = localFolderHandle(configuration.config);
        if (handle.kind === LocalFolderHandleKind.Unselected) {
          throw new Error(state.t(I18N_KEYS.AuthStorageLocalFolderChooseErr));
        }
        importedStoreId = (await state.enqueueStorage(() =>
          state
            .requireManager()
            .import_local_folder_event_log_as_local_vault(handle.handleId),
        )) as string;
      } else {
        importedStoreId = (await state.enqueueStorage(() =>
          state
            .requireManager()
            .import_provider_event_log_as_local_vault(
              conflict.mode,
              conflict.pat,
              conflict.repo,
            ),
        )) as string;
      }
    }
    await set_active_vault(importedStoreId);
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
      const metadataRequest: Parameters<
        typeof state.updateProviderSyncMetadata
      >[0] = {
        providerId,
        yaml: conflict.remoteYaml,
        revision: remoteRevision,
      };
      await state.updateProviderSyncMetadata(metadataRequest);
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
    set_vault_session_locked(true);
    state.clearUnlockedSession();
    await state.refreshPasswordEntriesList();
    if (state.localVaults.length <= 1) {
      await refreshLoginUnlockCapabilities(state);
    }
    const tArgs: Parameters<typeof state.t>[0] = {
      key: I18N_KEYS.AuthStorageSyncConflictImportedVault,
      replacements: {
        provider: providerLabel,
      },
    };
    state.showSuccess(state.t(tArgs));
  } catch (error) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : state.t(I18N_KEYS.AuthStorageSyncFailed);
    providerSave = { kind: ConflictProviderSaveKind.NotSaved };
  } finally {
    state.isVerifying = false;
  }
  if (
    providerSave.kind === ConflictProviderSaveKind.Saved &&
    !importedAsSeparateVault
  ) {
    const resumeConnectAfterSyncConflictArgs: Parameters<
      typeof resumeConnectAfterSyncConflict
    >[0] = { state, providerId: providerSave.providerId, pendingProvider };
    await resumeConnectAfterSyncConflict(resumeConnectAfterSyncConflictArgs);
  }
}
