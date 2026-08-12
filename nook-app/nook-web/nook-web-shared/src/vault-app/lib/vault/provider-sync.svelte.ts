import { I18N_KEYS } from "../../../generated/i18n-keys";
/** Sync actions that snapshot reactive Svelte state at WASM boundaries. */
import type {
  ProviderSyncRequest,
  SyncActionsContext,
} from "$lib/vault/action-contexts";
import { createLogger, runtimeFailure } from "$lib/runtime/log";
import { syncVaultFromStorage, type NookVaultSyncResult } from "$lib/nook";
import {
  NookEventLogSyncIssueState,
  NookLocalFolderHealth,
  NookManualProviderSyncState,
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
  read_local_vault_yaml,
} from "$app-wasm";
import {
  localFolderHandle,
  LocalFolderHandleKind,
  localFolderProviderConfiguration,
  LocalFolderProviderConfigurationKind,
  type StorageProvider,
} from "$lib/auth/providers";
import {
  LocalFolderInspectionKind,
  type LocalFolderInspection,
} from "$lib/vault/sync-operation-state";
import { syncError } from "$lib/vault/sync-runtime";

const log = createLogger("vault-sync");

interface ProviderStoreMismatchConflict {
  readonly state: SyncActionsContext;
  readonly provider: StorageProvider;
  readonly localStoreId: string;
  readonly remoteStoreId: string;
}

interface LocalFolderProviderSync {
  readonly state: SyncActionsContext;
  readonly provider: StorageProvider;
}

interface StagedLocalFolderMultipleVaultsIssue {
  readonly state: SyncActionsContext;
  readonly issue: NookLocalFolderHealth;
}

async function stageProviderStoreMismatchConflict({
  state,
  provider,
  localStoreId,
  remoteStoreId,
}: ProviderStoreMismatchConflict): Promise<boolean> {
  const localYaml = await read_local_vault_yaml().catch(() => "");
  const args =
    provider.type === "local-folder"
      ? (["local-folder", "", ""] as const)
      : state.providerWasmArgs(provider);
  const revision = NookProviderSyncRevision.untracked();
  try {
    state.stageSyncConflict(
      NookPendingSyncConflict.store_id(
        provider.id,
        provider.label,
        localYaml,
        "",
        args[0],
        args[1],
        args[2],
        revision,
        localStoreId,
        remoteStoreId,
      ),
    );
  } finally {
    revision.free();
  }
  log.warn("provider store mismatch staged");
  return true;
}

export async function syncLocalFolderProvider({
  state,
  provider,
}: LocalFolderProviderSync): Promise<void> {
  if (!state.hasManager) {
    throw new Error(state.t(I18N_KEYS.ErrorsManagerUninitialized));
  }
  const manager = state.requireManager();
  const configuration = localFolderProviderConfiguration(provider);
  if (configuration.kind === LocalFolderProviderConfigurationKind.Missing) {
    throw new Error(state.t(I18N_KEYS.ErrorsLocalBackupFolderRequired));
  }
  const handle = localFolderHandle(configuration.config);
  if (handle.kind === LocalFolderHandleKind.Unselected) {
    throw new Error(state.t(I18N_KEYS.ErrorsLocalBackupFolderRequired));
  }
  const localYaml = (await state.enqueueStorage(() =>
    manager.sync_local_folder_provider_js(handle.handleId),
  )) as string;
  if (localYaml.trim()) {
    const metadataRequest: Parameters<
      typeof state.updateProviderSyncMetadata
    >[0] = {
      providerId: provider.id,
      yaml: localYaml,
      revision: NookProviderSyncRevision.untracked(),
    };
    await state.updateProviderSyncMetadata(metadataRequest);
  }
}

function stageLocalFolderMultipleVaultsIssue({
  state,
  issue,
}: StagedLocalFolderMultipleVaultsIssue) {
  log.warn("local folder contains multiple vault logs");
  state.reportLocalFolderMultipleVaults(issue);
}

type ProviderSyncExecution = ProviderSyncRequest & {
  readonly state: SyncActionsContext;
};

export async function syncProviderById({
  state,
  providerId,
  visibility,
  failureHandling,
}: ProviderSyncExecution): Promise<void> {
  if (!state.hasManager) return;
  if (state.syncBlocked) return;
  // A foreground password op (verify/enroll/rotate) borrows the wasm manager;
  // a per-provider sync's `&mut self` future would alias that borrow.
  if (state.isPasswordBusy) return;
  // A foreground secret edit (add/delete) writes the event log to IndexedDB via
  // the serialized storage chain; this per-provider sync's out-of-chain IDB
  // reads (fetch/read local/update metadata) would otherwise race that write
  // and deadlock the IndexedDB transaction.
  if (state.isSaving) return;
  const provider = state.providers.find((p) => p.id === providerId);
  if (!provider || provider.type === "local") return;
  if (
    state.manualProviderSync.state === NookManualProviderSyncState.Running &&
    state.manualProviderSync.providerId !== providerId
  )
    return;

  state.beginManualProviderSync(providerId);
  if (visibility === ProviderSyncVisibility.Visible) {
    state.errorMsg = "";
  }
  log.debug("provider sync started");
  try {
    if (provider.type === "local-folder") {
      const syncLocalFolderProviderArgs4: Parameters<
        typeof syncLocalFolderProvider
      >[0] = { state, provider };
      await syncLocalFolderProvider(syncLocalFolderProviderArgs4);
      await state.refreshSecretsFromSession();
      await state.refreshReplacementConflicts();
      log.debug("provider sync finished");
      return;
    }

    const [mode, pat, repo] = state.providerWasmArgs(provider);
    // `sync_vault_from_storage` checks the IDB event-log flag; the in-memory
    // `event_log_mode()` bit can be false after reload until connect finishes.
    const raw = await state.enqueueStorage<NookVaultSyncResult>(() =>
      (() => {
        const syncRequest: Parameters<typeof syncVaultFromStorage>[0] = {
          manager: state.requireManager(),
          mode,
          pat,
          repo,
        };
        const raceStorageTimeoutArgs: {
          readonly promise: Promise<NookVaultSyncResult>;
          readonly label: string;
        } = {
          promise: syncVaultFromStorage(syncRequest),
          label: "Vault sync",
        };
        return state.raceStorageTimeout<NookVaultSyncResult>(
          raceStorageTimeoutArgs,
        );
      })(),
    );
    state.applyVaultSyncResult(raw);
    await state.refreshSecretsFromSession();
    await state.refreshReplacementConflicts();
    const metadataRequest: Parameters<
      typeof state.updateProviderSyncMetadata
    >[0] = {
      providerId,
      yaml: await read_local_vault_yaml(),
      revision: NookProviderSyncRevision.untracked(),
    };
    await state.updateProviderSyncMetadata(metadataRequest);
    log.debug("provider sync finished");
    return;
  } catch (e) {
    const syncErrorArgs4: Parameters<typeof syncError>[0] = {
      context: `provider sync (${provider.label})`,
      failure: runtimeFailure(e),
    };
    syncError(syncErrorArgs4);
    const eventLogIssueResult = state
      .requireManager()
      .take_event_log_sync_issue();
    const message = e instanceof Error ? e.message : String(e);
    let stagedStoreMismatch = false;
    let localFolderInspection: LocalFolderInspection = {
      kind: LocalFolderInspectionKind.SingleVault,
    };
    if (eventLogIssueResult.state === NookEventLogSyncIssueState.Pending) {
      const eventLogIssue = eventLogIssueResult.issue();
      try {
        if (eventLogIssue.isStoreMismatch) {
          const localStoreId = eventLogIssue.localStoreId;
          const remoteStoreId = eventLogIssue.remoteStoreId;
          const stageProviderStoreMismatchConflictArgs: Parameters<
            typeof stageProviderStoreMismatchConflict
          >[0] = { state, provider, localStoreId, remoteStoreId };
          stagedStoreMismatch = await stageProviderStoreMismatchConflict(
            stageProviderStoreMismatchConflictArgs,
          );
        } else if (eventLogIssue.isMultipleStores) {
          if (provider.type !== "local-folder") {
            const multipleVaultStorageIssueErrorOptions: ErrorOptions = {
              cause: e,
            };
            throw new Error(
              "Multiple-vault storage issue requires a local folder",
              multipleVaultStorageIssueErrorOptions,
            );
          }
          localFolderInspection = {
            kind: LocalFolderInspectionKind.MultipleVaults,
            issue: NookLocalFolderHealth.multiple_vaults(
              provider.id,
              provider.label,
              eventLogIssue.storeIds,
              message,
            ),
          };
        }
      } finally {
        eventLogIssue.free();
      }
    }
    eventLogIssueResult.free();
    if (
      localFolderInspection.kind === LocalFolderInspectionKind.MultipleVaults
    ) {
      const stageLocalFolderMultipleVaultsIssueArgs: Parameters<
        typeof stageLocalFolderMultipleVaultsIssue
      >[0] = { state, issue: localFolderInspection.issue };
      stageLocalFolderMultipleVaultsIssue(
        stageLocalFolderMultipleVaultsIssueArgs,
      );
    }
    if (visibility === ProviderSyncVisibility.Visible) {
      state.errorMsg = stagedStoreMismatch
        ? (() => {
            const tArgs: Parameters<typeof state.t>[0] = {
              key: I18N_KEYS.AuthStorageSyncConflictStoreIdBanner,
              replacements: {
                provider: provider.label,
              },
            };
            return state.t(tArgs);
          })()
        : localFolderInspection.kind ===
            LocalFolderInspectionKind.MultipleVaults
          ? state.t(I18N_KEYS.AuthStorageLocalFolderMultipleVaultsShort)
          : e instanceof Error
            ? e.message
            : "Sync failed for state provider.";
    }
    if (
      failureHandling === ProviderSyncFailureHandling.Propagate &&
      !stagedStoreMismatch
    ) {
      throw e;
    }
  } finally {
    if (state.isAuthenticated) {
      await state.hydrateMultiDeviceState();
    }
    if (
      state.manualProviderSync.state === NookManualProviderSyncState.Running &&
      state.manualProviderSync.providerId === providerId
    ) {
      state.clearSyncingProvider();
    }
  }
}
