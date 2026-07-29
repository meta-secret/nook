import { omittedValue } from "../../../explicit-state";
/** Sync actions that snapshot reactive Svelte state at WASM boundaries. */
import type { SyncActionsContext } from "$lib/vault/action-contexts";
import { SvelteDate } from "svelte/reactivity";
import { createLogger } from "$lib/log";
import {
  isoTimestamp,
  VaultAccessStatus,
  type JoinRequest,
  type NookVaultSyncResult,
  type VaultMember,
} from "$lib/nook";
import {
  importLocalVaultBlob,
  isVaultSessionLocked,
  JoinEnrollmentState,
  NookEventLogSyncIssueState,
  NookPendingSyncConflict,
  readLocalVaultYaml,
  UnauthenticatedSyncDecision,
  updateProviderSyncMetadata as updateProviderSyncMetadataWasm,
} from "$app-wasm";
import {
  LOCAL_FOLDER_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  type StorageProvider,
} from "$lib/auth-providers";
import { publishExtensionEventLogUpdate } from "$web-shared/extension/event-log-bridge";
import type { ExtensionEventLogRecord } from "$web-shared/extension/runtime-messages";
import { intoWasmStringValue } from "$lib/wasm-string-value";
type ConflictProviderSave =
  | { kind: "not-saved" }
  | { kind: "saved"; providerId: string };
type LocalFolderInspection =
  | { kind: "single-vault" }
  | { kind: "multiple-vaults"; issue: LocalFolderMultipleVaultsIssue };

export * from "$lib/vault/sync-resolution";
export { syncConflictLabel } from "$lib/vault/sync-conflict-label";

const log = createLogger("vault-sync");

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

function syncError(context: string, error: unknown) {
  log.warn(`${context} failed`, {
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  });
}

function scheduleAutoConnectAfterApproval(state: SyncActionsContext): void {
  if (
    !state.clientPolicy.shouldAutoConnectAfterApproval(
      state.isAuthenticated,
      state.isVerifying,
      state.loginPasswordPrompt,
      state.sessionExpiredByIdle,
      isVaultSessionLocked(),
    )
  ) {
    return;
  }
  log.info("scheduling auto-connect after join approval");
  setTimeout(() => {
    if (state.isAuthenticated || state.isVerifying) return;
    void state.loadDb();
  }, 0);
}

export function applyVaultSyncResult(
  state: SyncActionsContext,
  result: NookVaultSyncResult,
): void {
  if (state.isAuthenticated) {
    state.pendingJoins = result.pendingJoins;
    state.vaultMembers = result.vaultMembers;
    return;
  }

  log.debug("sync result (unauthenticated)", {
    changed: result.changed,
    accessStatus: result.accessStatus,
    joinEnrollmentPrompt: state.joinEnrollmentPrompt,
  });

  if (typeof result.accessStatus !== "undefined") {
    log.info("sync state changed (login gate)", {
      accessStatus: result.accessStatus,
      pendingJoins: result.pendingJoins.length,
    });
  }

  const decision = state.clientPolicy.unauthenticatedSyncDecision(
    result.changed,
    typeof result.accessStatus !== "undefined",
    result.accessStatus ?? VaultAccessStatus.NewVault,
    state.joinEnrollmentPrompt,
    state.awaitingJoinApproval,
  );
  switch (decision) {
    case UnauthenticatedSyncDecision.Approved:
      state.joinEnrollmentPrompt = JoinEnrollmentState.None;
      state.showSuccess(state.t("toasts.device_approved"));
      scheduleAutoConnectAfterApproval(state);
      break;
    case UnauthenticatedSyncDecision.AutoConnect:
      scheduleAutoConnectAfterApproval(state);
      break;
    case UnauthenticatedSyncDecision.MarkJoinPending:
      state.joinEnrollmentPrompt = JoinEnrollmentState.Pending;
      state.awaitingJoinApproval = true;
      break;
  }
}

export async function hydrateMultiDeviceState(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.manager || !state.isAuthenticated) return;
  const mergedJoins: JoinRequest[] = [];
  try {
    for (const provider of state.syncProviders) {
      if (provider.type === LOCAL_FOLDER_PROVIDER_TYPE) {
        await syncLocalFolderProvider(state, provider);
        continue;
      }
      const [mode, pat, repo] = state.providerWasmArgs(provider);
      const joins = (await state.enqueueStorage(() =>
        state.manager!.mergeRemoteJoinsFromProvider(mode, pat, repo),
      )) as JoinRequest[];
      if (joins.length > 0) {
        mergedJoins.push(...joins);
      }
    }
  } catch {
    // Merge can fail transiently while wasm is busy; still read session joins.
  }
  try {
    const snapshot = await state.enqueueStorage(async () => {
      await Promise.resolve();
      try {
        await state.manager!.ensureVaultRosterHydrated();
      } catch {
        // Roster repair is best-effort; still read the current session.
      }
      let pendingJoins: JoinRequest[];
      let vaultMembers: VaultMember[];
      try {
        pendingJoins = state.manager!.list_pending_joins();
      } catch {
        pendingJoins = [];
      }
      try {
        vaultMembers = state.manager!.list_vault_members();
      } catch {
        vaultMembers = [];
      }
      return { pendingJoins, vaultMembers };
    });
    state.pendingJoins =
      snapshot.pendingJoins.length > 0 ? snapshot.pendingJoins : mergedJoins;
    state.vaultMembers = snapshot.vaultMembers;
    await state.refreshPasswordEntriesList();
  } catch {
    state.vaultMembers = [];
  }
}

export async function syncFromSyncProviders(
  state: SyncActionsContext,
  options?: { quiet?: boolean; force?: boolean },
): Promise<void> {
  if (!state.manager) return;
  if (
    !state.clientPolicy.shouldSyncFromProviders(
      state.syncBlocked,
      options?.force ?? false,
      state.isVerifying,
      state.isSaving,
      state.isPasswordBusy,
      state.isSyncing,
      state.syncProviders.length,
    )
  ) {
    return;
  }

  state.isSyncing = true;
  try {
    for (const provider of state.syncProviders) {
      if (state.syncBlocked) break;
      await state.syncProviderById(provider.id, {
        quiet: options?.quiet ?? true,
      });
    }
    if (state.isAuthenticated) {
      await hydrateMultiDeviceState(state);
    }
    await publishExtensionEventLogUpdateForVault(state);
    state.lastSyncedAt = new SvelteDate();
  } catch {
    // Background sync should not interrupt the UI.
  } finally {
    state.isSyncing = false;
  }
}

export async function runFanOutSyncToProviders(
  state: SyncActionsContext,
  options?: { quiet?: boolean },
): Promise<void> {
  if (state.isFanOutSyncing) return;
  state.isFanOutSyncing = true;
  try {
    for (const provider of state.syncProviders) {
      if (state.syncBlocked) break;
      await state.syncProviderById(provider.id, {
        quiet: options?.quiet ?? true,
      });
    }
  } finally {
    state.isFanOutSyncing = false;
  }
}

export async function runFanOutSyncAfterLocalSave(
  state: SyncActionsContext,
): Promise<void> {
  await publishExtensionEventLogUpdateForVault(state);
  if (!state.deviceProtectionReady) return;
  if (state.syncProviders.length === 0) {
    await state.flushRemoteEventOutboxNow();
    return;
  }
  for (const provider of state.syncProviders) {
    if (state.syncBlocked) break;
    await state.flushRemoteEventOutboxNow(provider);
  }
}

export async function publishExtensionEventLogUpdateForVault(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.manager) return;
  try {
    const vaultStoreId =
      state.activeVaultStoreId ??
      (await state.enqueueStorage(() => state.manager!.vaultStoreId));
    const eventLogRecords = await state.enqueueStorage(() =>
      state.manager!.exportEventLogRecords(),
    );
    try {
      publishExtensionEventLogUpdate(
        vaultStoreId,
        eventLogRecords.toArray() as ExtensionEventLogRecord[],
      );
    } finally {
      eventLogRecords.free();
    }
  } catch {
    // The extension bridge is optional and must never make a vault save fail.
    log.warn("extension event-log notification failed");
  }
}

export function remoteEventProviderArgs(
  state: SyncActionsContext,
  provider?: StorageProvider,
): [string, string, string] | void {
  if (provider?.type === LOCAL_FOLDER_PROVIDER_TYPE) return;
  if (provider) return state.providerWasmArgs(provider);
  if (state.syncProviders[0]?.type === LOCAL_FOLDER_PROVIDER_TYPE) {
    return;
  }
  if (state.syncProviders.length > 0) {
    return state.providerWasmArgs(state.syncProviders[0]!);
  }
  return state.hasRemoteCredentials()
    ? state.wasmStorageArgs()
    : omittedValue();
}

export async function flushRemoteEventOutboxNow(
  state: SyncActionsContext,
  provider?: StorageProvider,
): Promise<void> {
  if (!state.manager) return;
  const folderProvider =
    provider && provider.type === LOCAL_FOLDER_PROVIDER_TYPE
      ? provider
      : !provider &&
          state.syncProviders[0] &&
          state.syncProviders[0].type === LOCAL_FOLDER_PROVIDER_TYPE
        ? state.syncProviders[0]
        : omittedValue();
  if (folderProvider) {
    try {
      await syncLocalFolderProvider(state, folderProvider);
    } catch (error) {
      log.warn("local backup sync skipped", {
        providerId: folderProvider.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  const args = remoteEventProviderArgs(state, provider);
  if (!args) return;
  try {
    await state.enqueueStorage(() =>
      state.manager!.flushEventOutboxForProvider(...args),
    );
  } catch (error) {
    log.warn("event outbox flush skipped", {
      providerId: provider?.id ?? "active",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateProviderSyncMetadata(
  state: SyncActionsContext,
  providerId: string,
  yaml: string,
  revision: string | void,
): Promise<void> {
  const managerStoreId = state.manager
    ? await state.enqueueStorage(() => state.manager!.vaultStoreId)
    : "";
  state.providers = updateProviderSyncMetadataWasm(
    $state.snapshot({
      providers: state.providers,
      ...(state.activeVaultStoreId
        ? { activeVaultStoreId: state.activeVaultStoreId }
        : {}),
    }),
    providerId,
    yaml,
    intoWasmStringValue(revision),
    intoWasmStringValue(managerStoreId || omittedValue()),
    isoTimestamp(),
  ).providers;
  await state.persistProviders();
  state.lastSyncedAt = new SvelteDate();
}

export function dismissLocalFolderMultipleVaultsIssue(
  state: SyncActionsContext,
): void {
  state.clearLocalFolderMultipleVaultsIssue();
}

export async function disconnectLocalFolderMultipleVaultsProvider(
  state: SyncActionsContext,
): Promise<void> {
  const issue = state.localFolderMultipleVaultsIssue;
  if (!issue) return;
  state.clearLocalFolderMultipleVaultsIssue();
  await state.removeProvider(issue.providerId);
}

export async function chooseReplacementLocalFolderForIssue(
  state: SyncActionsContext,
): Promise<void> {
  const issue = state.localFolderMultipleVaultsIssue;
  if (!issue) return;
  state.clearLocalFolderMultipleVaultsIssue();
  if (state.providers.some((provider) => provider.id === issue.providerId)) {
    await state.removeProvider(issue.providerId);
  }
  state.errorMsg = "";
  state.settingsOpen = true;
  state.settingsSection = "admin";
  state.adminAccordionSection = "storage";
  state.beginAddProvider();
  state.beginProviderSetup(LOCAL_FOLDER_PROVIDER_TYPE);
}

export function finishStagedProviderConnectAfterConflict(
  state: SyncActionsContext,
  conflict: NookPendingSyncConflict,
): void {
  if (!conflict.isPendingProvider) return;
  state.clearLoginSetup();
  state.addProviderOpen = false;
}

export async function ensureProviderSavedAfterConflict(
  state: SyncActionsContext,
  conflict: NookPendingSyncConflict,
): Promise<string> {
  if (
    !conflict.isPendingProvider &&
    state.providers.some((provider) => provider.id === conflict.providerId)
  ) {
    return conflict.providerId;
  }
  const saved = await state.ensureProviderSaved();
  if (!saved) {
    throw new Error(state.t("auth_storage.duplicate_sync_provider"));
  }
  const provider =
    state.syncProviders[state.syncProviders.length - 1] ??
    state.providers[state.providers.length - 1];
  if (!provider || provider.type === LOCAL_PROVIDER_TYPE) {
    throw new Error(state.t("errors.cloud_sync_provider_required"));
  }
  return provider.id;
}

function localFolderMultipleVaultsIssueFromTypedIssue(
  provider: StorageProvider,
  storeIds: string[],
  message: string,
): LocalFolderMultipleVaultsIssue | void {
  if (provider.type !== "local-folder") return;
  return {
    providerId: provider.id,
    providerLabel: provider.label,
    storeIds,
    message,
  };
}

async function stageProviderStoreMismatchConflict(
  state: SyncActionsContext,
  provider: StorageProvider,
  localStoreId: string,
  remoteStoreId: string,
): Promise<boolean> {
  const localYaml = await readLocalVaultBlob().catch(() => "");
  const args =
    provider.type === "local-folder"
      ? (["local-folder", "", ""] as const)
      : state.providerWasmArgs(provider);
  state.stageSyncConflict(
    NookPendingSyncConflict.storeId(
      provider.id,
      provider.label,
      localYaml,
      "",
      args[0],
      args[1],
      args[2],
      omittedValue(),
      localStoreId,
      remoteStoreId,
    ),
  );
  log.warn("provider store mismatch staged", {
    provider: provider.label,
    localStoreId,
    remoteStoreId,
  });
  return true;
}

/** Map a typed mismatch found during provider assessment into the global dialog. */
export async function stageStagedProviderSyncIssue(
  state: SyncActionsContext,
  args: [string, string, string],
): Promise<boolean> {
  const manager = state.manager;
  const issueResult = manager?.takeEventLogSyncIssue();
  if (!issueResult) return false;
  if (issueResult.state === NookEventLogSyncIssueState.Clear) {
    issueResult.free();
    return false;
  }
  const issue = issueResult.issue();
  issueResult.free();
  try {
    if (!issue.isStoreMismatch) return false;
    const localStoreId = issue.localStoreId;
    const remoteStoreId = issue.remoteStoreId;
    if (!localStoreId || !remoteStoreId || !manager) return false;

    const localYaml = await readLocalVaultBlob().catch(() => "");
    await state.enqueueStorage(() =>
      manager.restoreLocalAfterProviderAssessment(),
    );
    state.stageSyncConflict(
      NookPendingSyncConflict.pendingStoreId(
        state.stagedProviderLabel(),
        localYaml,
        "",
        args[0],
        args[1],
        args[2],
        omittedValue(),
        localStoreId,
        remoteStoreId,
      ),
    );
    log.warn("staged provider store mismatch staged", {
      provider: state.stagedProviderLabel(),
      localStoreId,
      remoteStoreId,
    });
    return true;
  } finally {
    issue.free();
  }
}

export async function syncLocalFolderProvider(
  state: SyncActionsContext,
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
    await state.updateProviderSyncMetadata(
      provider.id,
      localYaml,
      omittedValue(),
    );
  }
}

export function startVaultSync(state: SyncActionsContext) {
  state.stopVaultSync();
  if (state.isAuthenticated && !state.deviceProtectionReady) {
    log.debug("vault sync timer skipped (device identity locked)");
    return;
  }
  const intervalMs = state.runtimeConfig.resolveVaultSyncIntervalMs(
    intoWasmStringValue(
      import.meta.env.VITE_VAULT_SYNC_INTERVAL_MS ?? omittedValue(),
    ),
  );
  const needsRemoteUpdates =
    state.isAuthenticated ||
    state.joinEnrollmentPrompt !== JoinEnrollmentState.None ||
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
      state.joinEnrollmentPrompt === JoinEnrollmentState.None &&
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
      state.joinEnrollmentPrompt === JoinEnrollmentState.None
    ) {
      return;
    }
    void state.syncFromStorage();
  }, intervalMs);
}

export function stopVaultSync(state: SyncActionsContext) {
  if (typeof state.syncTimer !== "undefined") {
    clearInterval(state.syncTimer);
    state.clearSyncTimer();
    log.debug("vault sync timer stopped");
  }
}

export async function syncFromStorage(
  state: SyncActionsContext,
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

export async function manualSync(state: SyncActionsContext) {
  if (!state.manager) return;
  if (state.syncBlocked) return;
  if (state.isSyncing) return;

  // A fresh browser may retain provider credentials before it has a vault, but
  // credentials alone do not establish a sync target. Initializing
  // device-dependent sync in that state asks the WASM manager to encrypt before
  // vault crypto exists. Keep the device roster projection empty until a vault
  // or a connected sync provider exists.
  if (
    !state.clientPolicy.manualSyncHasTarget(
      state.localVaultPresent,
      state.syncProviders.length,
    )
  ) {
    state.pendingJoins = [];
    state.vaultMembers = [];
    return;
  }

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
  state: SyncActionsContext,
  options?: { quiet?: boolean },
): Promise<void> {
  if (!state.manager || !state.isAuthenticated) return;
  if (state.syncBlocked) return;
  if (state.syncProviders.length === 0) return;

  log.debug("fan-out sync queued", { providers: state.syncProviders.length });
  const run = state.fanOutSyncChain.then(() =>
    state.runFanOutSyncToProviders(options),
  );
  state.fanOutSyncChain = run.catch(() => {});
  return run;
}

export function stageSyncConflict(
  state: SyncActionsContext,
  conflict: NookPendingSyncConflict,
) {
  state.pendingSyncConflict = conflict;
  state.errorMsg = "";
  log.warn("sync conflict staged", {
    provider: conflict.providerLabel,
    kind: conflict.kind,
  });
}

function stageLocalFolderMultipleVaultsIssue(
  state: SyncActionsContext,
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
  if (!state.manager) return;
  if (!state.stagedRemoteStorageArgs() && state.syncProviders.length === 0) {
    return;
  }
  await state.loadDb();
}

export async function resolveSyncConflictImportRemote(
  state: SyncActionsContext,
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
  let providerSave: ConflictProviderSave = { kind: "not-saved" };
  let importedAsSeparateVault = false;
  try {
    let importedStoreId: string;
    if (conflict.remoteYaml.trim()) {
      importedStoreId = await importLocalVaultBlob(
        conflict.remoteYaml,
        conflict.providerLabel ?? omittedValue(),
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
    await state.refreshLocalVaultCatalog();
    const providerId = await state.ensureProviderSavedAfterConflict(conflict);
    providerSave = { kind: "saved", providerId };
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
              lastSyncedAt: new SvelteDate().toISOString(),
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
    providerSave = { kind: "not-saved" };
  } finally {
    state.isVerifying = false;
  }
  if (providerSave.kind === "saved" && !importedAsSeparateVault) {
    await resumeConnectAfterSyncConflict(
      state,
      providerSave.providerId,
      conflict.isPendingProvider,
    );
  }
}

export async function syncProviderById(
  state: SyncActionsContext,
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
      omittedValue(),
    );
    log.debug("provider sync finished", { providerId, type: provider.type });
    return;
  } catch (e: unknown) {
    syncError(`provider sync (${provider.label})`, e);
    const eventLogIssueResult = state.manager.takeEventLogSyncIssue();
    const eventLogIssue =
      eventLogIssueResult.state === NookEventLogSyncIssueState.Pending
        ? eventLogIssueResult.issue()
        : omittedValue();
    eventLogIssueResult.free();
    const message = e instanceof Error ? e.message : String(e);
    let stagedStoreMismatch = false;
    let localFolderInspection: LocalFolderInspection = {
      kind: "single-vault",
    };
    if (eventLogIssue?.isStoreMismatch) {
      const localStoreId = eventLogIssue.localStoreId;
      const remoteStoreId = eventLogIssue.remoteStoreId;
      if (localStoreId && remoteStoreId) {
        stagedStoreMismatch = await stageProviderStoreMismatchConflict(
          state,
          provider,
          localStoreId,
          remoteStoreId,
        );
      }
    } else if (eventLogIssue?.isMultipleStores) {
      localFolderInspection = {
        kind: "multiple-vaults",
        issue: localFolderMultipleVaultsIssueFromTypedIssue(
          provider,
          eventLogIssue.storeIds,
          message,
        ),
      };
    }
    eventLogIssue?.free();
    if (localFolderInspection.kind === "multiple-vaults") {
      stageLocalFolderMultipleVaultsIssue(state, localFolderInspection.issue);
    }
    if (!options?.quiet) {
      state.errorMsg = stagedStoreMismatch
        ? state.t("auth_storage.sync_conflict_store_id_banner", {
            provider: provider.label,
          })
        : localFolderInspection.kind === "multiple-vaults"
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
      state.clearSyncingProvider();
    }
  }
}
