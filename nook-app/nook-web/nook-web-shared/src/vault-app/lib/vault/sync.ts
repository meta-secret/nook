import type { VaultState } from "$lib/vault.svelte";
import { SvelteDate } from "svelte/reactivity";
import { createLogger } from "$lib/log";
import {
  importLocalVaultBlob,
  readLocalVaultYaml,
  VaultSyncConflictKind,
  type NookPendingSyncConflict,
} from "$app-wasm";
import type { StorageProvider } from "$lib/auth-providers";
import * as localLoginActions from "$lib/vault/local-login";

const log = createLogger("vault-sync");

/** Pending user choice when local and remote vaults diverge. */
export type PendingSyncConflict = NookPendingSyncConflict;

/** A local folder was chosen at a level that contains event logs for many vaults. */
export type LocalFolderMultipleVaultsIssue = {
  providerId: string;
  providerLabel: string;
  storeIds: string[];
  message: string;
};

async function readLocalVaultBlob(): Promise<string> {
  return readLocalVaultYaml();
}

type SyncConflictLabelState = {
  pendingSyncConflict: PendingSyncConflict | undefined;
  t(key: string, values?: Record<string, string>): string;
};

export function syncConflictLabel(state: SyncConflictLabelState): string {
  const conflict = state.pendingSyncConflict;
  if (!conflict) return "";
  const key =
    conflict.kind === VaultSyncConflictKind.StoreId
      ? "auth_storage.sync_conflict_store_id_banner"
      : "auth_storage.sync_conflict_banner";
  return state.t(key, { provider: conflict.providerLabel });
}

function syncError(context: string, error: unknown) {
  log.warn(`${context} failed`, {
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  });
}

function localFolderMultipleVaultsIssueFromTypedIssue(
  provider: StorageProvider,
  storeIds: string[],
  message: string,
): LocalFolderMultipleVaultsIssue | undefined {
  if (provider.type !== "local-folder") return undefined;
  return {
    providerId: provider.id,
    providerLabel: provider.label,
    storeIds,
    message,
  };
}

type ProviderStoreMismatch = {
  localStoreId: string;
  remoteStoreId: string;
};

async function stageProviderStoreMismatchConflict(
  state: VaultState,
  provider: StorageProvider,
  mismatch: ProviderStoreMismatch,
): Promise<boolean> {
  const localYaml = await readLocalVaultBlob().catch(() => "");
  const args =
    provider.type === "local-folder"
      ? (["local-folder", "", ""] as const)
      : state.providerWasmArgs(provider);
  await state.stageVaultSyncConflict({
    providerId: provider.id,
    providerLabel: provider.label,
    localYaml,
    remoteYaml: "",
    mode: args[0],
    pat: args[1],
    repo: args[2],
    kind: "store_id",
    localStoreId: mismatch.localStoreId,
    remoteStoreId: mismatch.remoteStoreId,
  });
  log.warn("provider store mismatch staged", {
    provider: provider.label,
    localStoreId: mismatch.localStoreId,
    remoteStoreId: mismatch.remoteStoreId,
  });
  return true;
}

export async function syncLocalFolderProvider(
  state: VaultState,
  provider: StorageProvider,
): Promise<void> {
  const manager = state.manager;
  if (!manager) {
    throw new Error(state.t("errors.manager_uninitialized"));
  }
  const handleId = provider.localFolder?.handleId;
  if (!handleId) {
    throw new Error(state.t("errors.local_backup_folder_required"));
  }
  const localYaml = (await state.enqueueStorage(() =>
    manager.syncLocalFolderProvider(handleId),
  )) as string;
  if (localYaml.trim()) {
    await state.updateProviderSyncMetadata(provider.id, localYaml, undefined);
  }
}

export function startVaultSync(state: VaultState) {
  state.stopVaultSync();
  if (state.isAuthenticated && !state.deviceProtectionReady) {
    log.debug("vault sync timer skipped (device identity locked)");
    return;
  }
  const intervalMs = state.runtimeConfig.resolveVaultSyncIntervalMs(
    import.meta.env.VITE_VAULT_SYNC_INTERVAL_MS ?? undefined,
  );
  const needsRemoteUpdates =
    state.isAuthenticated ||
    state.joinEnrollmentPrompt !== "none" ||
    state.awaitingJoinApproval;
  if (!needsRemoteUpdates) {
    log.debug("vault sync timer skipped (no remote updates needed)");
    return;
  }
  log.info("vault sync timer started", {
    authenticated: state.isAuthenticated,
    providers: state.syncProviders.length,
    intervalMs,
  });
  if (state.isAuthenticated) {
    void state.syncFromStorage();
  }
  state.syncTimer = setInterval(() => {
    if (
      state.isVerifying ||
      state.isSaving ||
      state.isSyncing ||
      state.isPasswordBusy
    ) {
      return;
    }
    if (
      !state.isAuthenticated &&
      state.joinEnrollmentPrompt === "none" &&
      !state.awaitingJoinApproval
    ) {
      return;
    }
    // Local-only vaults with no sync provider and no pending join have
    // nothing remote to reconcile — skip the tick entirely rather than
    // re-reading local IndexedDB into itself every interval.
    if (
      state.isAuthenticated &&
      state.syncProviders.length === 0 &&
      state.joinEnrollmentPrompt === "none"
    ) {
      return;
    }
    void state.syncFromStorage();
  }, intervalMs);
}

export function stopVaultSync(state: VaultState) {
  if (state.syncTimer !== undefined) {
    clearInterval(state.syncTimer);
    state.syncTimer = undefined;
    log.debug("vault sync timer stopped");
  }
}

export async function syncFromStorage(
  state: VaultState,
  options?: { force?: boolean },
) {
  if (!state.manager) return;
  if (state.syncBlocked) return;
  if (!options?.force && state.isVerifying) return;
  if (!options?.force && state.isSaving) return;
  if (!options?.force && state.isPasswordBusy) return;
  if (!options?.force && state.isSyncing) return;

  if (!state.isAuthenticated && state.syncProviders.length > 0) {
    state.isSyncing = true;
    try {
      const provider = state.syncProviders[0]!;
      if (provider.type === "local-folder") {
        await syncLocalFolderProvider(state, provider);
      } else {
        const [mode, pat, repo] = state.providerWasmArgs(provider);
        const raw = await state.enqueueStorage(() =>
          state.manager!.sync_vault_from_storage(mode, pat, repo),
        );
        state.applyVaultSyncResult(raw);
      }
      await state.refreshSecretsFromSession();
      state.lastSyncedAt = new SvelteDate();
    } catch (error) {
      syncError("background sync (unauthenticated)", error);
    } finally {
      state.isSyncing = false;
    }
    return;
  }

  if (!state.hasRemoteCredentials()) return;

  if (
    state.isAuthenticated &&
    state.localVaultPresent &&
    state.syncProviders.length > 0
  ) {
    await state.syncFromSyncProviders({ quiet: true, force: options?.force });
    return;
  }

  await state.ensureOAuthTokensFresh();

  state.isSyncing = true;
  try {
    const raw = await state.enqueueStorage(() =>
      state.manager!.sync_vault_from_storage(...state.wasmStorageArgs()),
    );
    state.applyVaultSyncResult(raw);
    await state.refreshSecretsFromSession();
    state.lastSyncedAt = new SvelteDate();
  } catch (error) {
    syncError("background sync", error);
  } finally {
    state.isSyncing = false;
  }
}

export async function manualSync(state: VaultState) {
  if (!state.manager) return;
  if (state.syncBlocked) return;
  if (state.isSyncing) return;
  log.info("manual sync started", { providers: state.syncProviders.length });
  state.isSyncing = true;
  try {
    await state.initDeviceIdentity();
    if (state.syncProviders.length === 0) {
      if (state.hasRemoteCredentials()) {
        await state.syncFromStorage({ force: true });
      } else {
        state.pendingJoins = [];
        state.vaultMembers = [];
      }
      return;
    }
    for (const provider of state.syncProviders) {
      await state.syncProviderById(provider.id);
    }
    if (state.isAuthenticated) {
      await state.hydrateMultiDeviceState();
    } else {
      state.pendingJoins = [];
      state.vaultMembers = [];
    }
  } catch (error) {
    syncError("manual sync", error);
  } finally {
    state.isSyncing = false;
    log.debug("manual sync finished");
  }
}

export async function fanOutSyncToProviders(
  state: VaultState,
  options?: { quiet?: boolean },
): Promise<void> {
  if (!state.manager || !state.isAuthenticated) return;
  if (state.syncBlocked) return;
  if (state.syncProviders.length === 0) return;

  log.debug("fan-out sync queued", { providers: state.syncProviders.length });
  const run = state.fanOutSyncChain.then(() =>
    state.runFanOutSyncToProviders(options),
  );
  state.fanOutSyncChain = run.catch(() => undefined);
  return run;
}

export async function refreshReplacementConflicts(
  state: VaultState,
): Promise<void> {
  if (!state.manager) {
    state.replacementConflicts = [];
    state.securityConflicts = [];
    return;
  }
  // These borrow the wasm manager (`&mut self`); route them through the storage
  // chain so they never alias an in-flight foreground op (e.g. a delete), which
  // would trigger a wasm-bindgen recursive-borrow hang/panic.
  const [conflicts, securityConflicts] = await state.enqueueStorage(() => {
    if (!state.manager!.eventLogMode()) {
      return [
        [] as Awaited<ReturnType<typeof state.manager.listProjectionConflicts>>,
        [] as Awaited<
          ReturnType<typeof state.manager.listProjectionSecurityConflicts>
        >,
      ] as const;
    }
    return Promise.all([
      state.manager!.listProjectionConflicts(),
      state.manager!.listProjectionSecurityConflicts(),
    ]);
  });
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

export function stageSyncConflict(
  state: VaultState,
  conflict: PendingSyncConflict,
) {
  state.pendingSyncConflict = conflict;
  state.errorMsg = "";
  log.warn("sync conflict staged", {
    provider: conflict.providerLabel,
    kind: conflict.kind,
  });
}

function stageLocalFolderMultipleVaultsIssue(
  state: VaultState,
  issue: LocalFolderMultipleVaultsIssue,
) {
  state.localFolderMultipleVaultsIssue = issue;
  log.warn("local folder contains multiple vault logs", {
    provider: issue.providerLabel,
    storeIds: issue.storeIds,
  });
}

/** Finish connect/sync that was paused when the conflict dialog opened. */
async function resumeConnectAfterSyncConflict(
  state: VaultState,
  providerId: string,
): Promise<void> {
  if (state.isAuthenticated) {
    if (providerId !== "__pending_provider__") {
      await state.syncProviderById(providerId, { quiet: true });
    }
    await state.hydrateMultiDeviceState();
    return;
  }
  if (!state.manager) return;
  if (!state.stagedRemoteStorageArgs() && state.syncProviders.length === 0) {
    return;
  }
  await state.loadDb();
}

export async function resolveSyncConflictImportRemote(
  state: VaultState,
): Promise<void> {
  const conflict = state.pendingSyncConflict;
  if (
    !conflict ||
    conflict.kind !== VaultSyncConflictKind.StoreId ||
    state.isVerifying
  ) {
    return;
  }
  const remoteStoreId = conflict.remoteStoreId();
  if (!remoteStoreId) return;

  state.isVerifying = true;
  state.errorMsg = "";
  let providerId: string | undefined;
  let importedAsSeparateVault = false;
  try {
    let importedStoreId: string;
    if (conflict.remoteYaml.trim()) {
      importedStoreId = await importLocalVaultBlob(
        conflict.remoteYaml,
        conflict.providerLabel ?? undefined,
      );
    } else {
      if (!state.manager) {
        throw new Error(state.t("errors.manager_uninitialized"));
      }
      const provider = state.providers.find(
        (p) => p.id === conflict.providerId,
      );
      if (provider?.type === "local-folder") {
        const handleId = provider.localFolder?.handleId;
        if (!handleId) {
          throw new Error(state.t("auth_storage.local_folder_choose_err"));
        }
        importedStoreId = (await state.enqueueStorage(() =>
          state.manager!.importLocalFolderEventLogAsLocalVault(handleId),
        )) as string;
      } else {
        importedStoreId = (await state.enqueueStorage(() =>
          state.manager!.importProviderEventLogAsLocalVault(
            conflict.mode,
            conflict.pat,
            conflict.repo,
          ),
        )) as string;
      }
    }
    state.activeVaultStoreId = importedStoreId;
    state.selectedLoginVaultStoreId = importedStoreId;
    if (state.manager) {
      await state.enqueueStorage(() => state.manager!.resetVaultSession());
    }
    state.localVaultPresent = true;
    await localLoginActions.refreshLocalVaultCatalog(state);
    providerId = await state.ensureProviderSavedAfterConflict(conflict);
    if (conflict.remoteYaml.trim()) {
      await state.updateProviderSyncMetadata(
        providerId,
        conflict.remoteYaml,
        conflict.remoteRevision,
      );
    } else {
      state.providers = state.providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              storeId: importedStoreId,
              lastSyncedAt: new Date().toISOString(),
            }
          : provider,
      );
      await state.persistProviders();
    }
    state.clearPendingSyncConflict();
    state.finishStagedProviderConnectAfterConflict(conflict);
    await state.syncActiveVaultStoreIdToAuth();
    importedAsSeparateVault = true;
    state.clearUnlockedSession();
    state.showSuccess(
      state.t("auth_storage.sync_conflict_imported_vault", {
        provider: conflict.providerLabel,
      }),
    );
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : state.t("auth_storage.sync_failed");
    providerId = undefined;
  } finally {
    state.isVerifying = false;
  }
  if (providerId && !importedAsSeparateVault) {
    await resumeConnectAfterSyncConflict(state, providerId);
  }
}

export async function resolveSyncConflictKeepLocal(
  state: VaultState,
): Promise<void> {
  const conflict = state.pendingSyncConflict;
  if (!conflict || state.isVerifying) return;

  state.isVerifying = true;
  state.errorMsg = "";
  log.info("sync conflict resolved (keep local)", {
    provider: conflict.providerLabel,
    kind: conflict.kind,
  });
  state.errorMsg =
    "Whole-vault conflict resolution is retired. Sync the event log from all providers and retry.";
  state.isVerifying = false;
}

export async function resolveSyncConflictKeepRemote(
  state: VaultState,
): Promise<void> {
  const conflict = state.pendingSyncConflict;
  if (!conflict || state.isVerifying) return;

  log.info("sync conflict resolved (keep remote)", {
    provider: conflict.providerLabel,
    kind: conflict.kind,
  });
  state.errorMsg =
    "Whole-vault conflict resolution is retired. Sync the event log from all providers and retry.";
  state.isVerifying = false;
}

export async function confirmRecoverRemoteVault(
  state: VaultState,
): Promise<void> {
  if (!state.manager) return;
  state.errorMsg = "";
  state.isVerifying = true;
  try {
    await state.enqueueStorage(() =>
      state.manager!.prepareConnectFromLocalCache(),
    );
    state.pendingConnectRecovery = "from_cache";
    state.remoteVaultRecoveryPrompt = "none";
    if (state.loginSetupType) {
      await state.loadDb();
      return;
    }
    await state.refreshPasswordEntriesList();
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : "Could not load the local vault copy.";
  } finally {
    state.isVerifying = false;
  }
}

export async function confirmCreateFreshRemoteVault(
  state: VaultState,
): Promise<void> {
  if (!state.manager) return;
  state.errorMsg = "";
  state.pendingConnectRecovery = "fresh";
  state.remoteVaultRecoveryPrompt = "none";
  if (state.loginSetupType) {
    state.isVerifying = true;
    try {
      await state.loadDb();
    } catch (e: unknown) {
      state.errorMsg =
        e instanceof Error ? e.message : "Could not create a new vault file.";
    } finally {
      state.isVerifying = false;
    }
    return;
  }
}

export function clearRemoteVaultRecovery(state: VaultState) {
  state.remoteVaultRecoveryPrompt = "none";
  state.pendingConnectRecovery = "none";
  try {
    state.manager?.clearConnectRecovery();
  } catch {
    // Engine not ready yet.
  }
}

export async function syncProviderById(
  state: VaultState,
  providerId: string,
  options?: { quiet?: boolean; propagateError?: boolean },
): Promise<void> {
  if (!state.manager) return;
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
  if (state.syncingProviderId && state.syncingProviderId !== providerId) return;

  state.syncingProviderId = providerId;
  if (!options?.quiet) {
    state.errorMsg = "";
  }
  log.debug("provider sync started", {
    providerId,
    type: provider.type,
    label: provider.label,
    quiet: options?.quiet ?? false,
  });
  try {
    if (provider.type === "local-folder") {
      await syncLocalFolderProvider(state, provider);
      await state.refreshSecretsFromSession();
      await state.refreshReplacementConflicts();
      log.debug("provider sync finished", { providerId, type: provider.type });
      return;
    }

    const [mode, pat, repo] = state.providerWasmArgs(provider);
    // `sync_vault_from_storage` checks the IDB event-log flag; the in-memory
    // `eventLogMode()` bit can be false after reload until connect finishes.
    const raw = await state.enqueueStorage(() =>
      state.raceStorageTimeout(
        state.manager!.sync_vault_from_storage(mode, pat, repo),
        "Vault sync",
      ),
    );
    state.applyVaultSyncResult(raw);
    await state.refreshSecretsFromSession();
    await state.refreshReplacementConflicts();
    await state.updateProviderSyncMetadata(
      providerId,
      await readLocalVaultBlob(),
      undefined,
    );
    log.debug("provider sync finished", { providerId, type: provider.type });
    return;
  } catch (e: unknown) {
    syncError(`provider sync (${provider.label})`, e);
    const eventLogIssue = state.manager.takeEventLogSyncIssue();
    const message = e instanceof Error ? e.message : String(e);
    let stagedStoreMismatch = false;
    let localFolderIssue: LocalFolderMultipleVaultsIssue | undefined;
    if (eventLogIssue?.isStoreMismatch) {
      const localStoreId = eventLogIssue.localStoreId;
      const remoteStoreId = eventLogIssue.remoteStoreId;
      if (localStoreId && remoteStoreId) {
        stagedStoreMismatch = await stageProviderStoreMismatchConflict(
          state,
          provider,
          { localStoreId, remoteStoreId },
        );
      }
    } else if (eventLogIssue?.isMultipleStores) {
      localFolderIssue = localFolderMultipleVaultsIssueFromTypedIssue(
        provider,
        eventLogIssue.storeIds,
        message,
      );
    }
    eventLogIssue?.free();
    if (localFolderIssue) {
      stageLocalFolderMultipleVaultsIssue(state, localFolderIssue);
    }
    if (!options?.quiet) {
      state.errorMsg = stagedStoreMismatch
        ? state.t("auth_storage.sync_conflict_store_id_banner", {
            provider: provider.label,
          })
        : localFolderIssue
          ? state.t("auth_storage.local_folder_multiple_vaults_short")
          : e instanceof Error
            ? e.message
            : "Sync failed for state provider.";
    }
    if (options?.propagateError && !stagedStoreMismatch) {
      throw e;
    }
  } finally {
    if (state.isAuthenticated) {
      await state.hydrateMultiDeviceState();
    }
    if (state.syncingProviderId === providerId) {
      state.syncingProviderId = undefined;
    }
  }
}
