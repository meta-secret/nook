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
  JoinEnrollmentState,
  NookManagerStoreScope,
  NookEventLogSyncIssueState,
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  NookVaultSyncAccessState,
  readLocalVaultYaml,
  UnauthenticatedSyncDecision,
  updateProviderSyncMetadata as updateProviderSyncMetadataWasm,
} from "$app-wasm";
import {
  activeVaultScope,
  LOCAL_FOLDER_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  localFolderHandle,
  LocalFolderHandleKind,
  localFolderProviderConfiguration,
  LocalFolderProviderConfigurationKind,
  unselectedVaultScope,
  type StorageProvider,
} from "$lib/auth-providers";
import {
  EventOutboxTargetKind,
  LocalFolderInspectionKind,
  type EventOutboxTarget,
  type LocalFolderInspection,
  type LocalFolderMultipleVaultsIssue,
} from "$lib/vault/sync-operation-state";
import {
  AdminAccordionSection,
  SettingsSection,
} from "$lib/vault/state/ui.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import {
  LocalFolderHealthKind,
  ManualProviderSyncKind,
} from "$lib/vault/state/sync.svelte";
import {
  scheduleAutoConnectAfterApproval,
  syncError,
} from "$lib/vault/sync-runtime";
import { publishExtensionEventLogUpdateForVault } from "$lib/vault/sync-extension-bridge";
export { publishExtensionEventLogUpdateForVault };

export * from "$lib/vault/sync-resolution";
export { syncConflictLabel } from "$lib/vault/sync-conflict-label";

const log = createLogger("vault-sync");

export type { LocalFolderMultipleVaultsIssue } from "$lib/vault/sync-operation-state";

export function applyVaultSyncResult(
  state: SyncActionsContext,
  result: NookVaultSyncResult,
): void {
  if (state.isAuthenticated) {
    state.pendingJoins = result.pendingJoins;
    state.vaultMembers = result.vaultMembers;
    return;
  }

  const accessAssessed =
    result.accessState === NookVaultSyncAccessState.Assessed;
  const accessStatus = accessAssessed
    ? result.accessStatus
    : VaultAccessStatus.NewVault;
  log.debug("sync result (unauthenticated)", {
    changed: result.changed,
    accessAssessed,
    accessStatus,
    joinEnrollmentPrompt: state.joinEnrollmentPrompt,
  });

  if (accessAssessed) {
    log.info("sync state changed (login gate)", {
      accessStatus,
      pendingJoins: result.pendingJoins.length,
    });
  }

  const decision = state.clientPolicy.unauthenticatedSyncDecision(
    result.changed,
    accessAssessed,
    accessStatus,
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
  if (!state.hasManager || !state.isAuthenticated) return;
  const mergedJoins: JoinRequest[] = [];
  try {
    for (const provider of state.syncProviders) {
      if (provider.type === LOCAL_FOLDER_PROVIDER_TYPE) {
        await syncLocalFolderProvider(state, provider);
        continue;
      }
      const [mode, pat, repo] = state.providerWasmArgs(provider);
      const joins = (await state.enqueueStorage(() =>
        state.requireManager().mergeRemoteJoinsFromProvider(mode, pat, repo),
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
        await state.requireManager().ensureVaultRosterHydrated();
      } catch {
        // Roster repair is best-effort; still read the current session.
      }
      let pendingJoins: JoinRequest[];
      let vaultMembers: VaultMember[];
      try {
        pendingJoins = state.requireManager().list_pending_joins();
      } catch {
        pendingJoins = [];
      }
      try {
        vaultMembers = state.requireManager().list_vault_members();
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
  if (!state.hasManager) return;
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
    state.markSynced(new SvelteDate());
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

export function eventOutboxTarget(
  state: SyncActionsContext,
  provider?: StorageProvider,
): EventOutboxTarget {
  if (provider?.type === LOCAL_FOLDER_PROVIDER_TYPE) {
    return { kind: EventOutboxTargetKind.LocalFolder, provider };
  }
  if (provider) {
    return {
      kind: EventOutboxTargetKind.Remote,
      args: state.providerWasmArgs(provider),
    };
  }
  if (state.syncProviders[0]?.type === LOCAL_FOLDER_PROVIDER_TYPE) {
    return {
      kind: EventOutboxTargetKind.LocalFolder,
      provider: state.syncProviders[0],
    };
  }
  if (state.syncProviders.length > 0) {
    return {
      kind: EventOutboxTargetKind.Remote,
      args: state.providerWasmArgs(state.syncProviders[0]!),
    };
  }
  return state.hasRemoteCredentials()
    ? {
        kind: EventOutboxTargetKind.Remote,
        args: state.wasmStorageArgs(),
      }
    : { kind: EventOutboxTargetKind.Unavailable };
}

export async function flushRemoteEventOutboxNow(
  state: SyncActionsContext,
  provider?: StorageProvider,
): Promise<void> {
  if (!state.hasManager) return;
  const target = eventOutboxTarget(state, provider);
  if (target.kind === EventOutboxTargetKind.LocalFolder) {
    try {
      await syncLocalFolderProvider(state, target.provider);
    } catch (error) {
      log.warn("local backup sync skipped", {
        providerId: target.provider.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (target.kind === EventOutboxTargetKind.Unavailable) return;
  try {
    await state.enqueueStorage(() =>
      state.requireManager().flushEventOutboxForProvider(...target.args),
    );
  } catch (error) {
    log.warn("event outbox flush skipped", {
      providerId: provider?.id ?? "active",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Persist sync metadata and consume the JS-owned WASM revision wrapper. */
export async function updateProviderSyncMetadata(
  state: SyncActionsContext,
  providerId: string,
  yaml: string,
  revision: NookProviderSyncRevision,
): Promise<void> {
  try {
    const managerStoreId = state.hasManager
      ? await state.enqueueStorage(() => state.requireManager().vaultStoreId)
      : "";
    const managerStoreScope = managerStoreId
      ? NookManagerStoreScope.scoped(managerStoreId)
      : NookManagerStoreScope.unscoped();
    try {
      state.providers = updateProviderSyncMetadataWasm(
        $state.snapshot({
          providers: state.providers,
          activeVaultStoreId:
            state.activeVault.kind === ActiveVaultKind.Open
              ? activeVaultScope(state.activeVault.storeId)
              : unselectedVaultScope(),
        }),
        providerId,
        yaml,
        revision,
        managerStoreScope,
        isoTimestamp(),
      ).providers;
    } finally {
      managerStoreScope.free();
    }
    await state.persistProviders();
    state.markSynced(new SvelteDate());
  } finally {
    revision.free();
  }
}

export function dismissLocalFolderMultipleVaultsIssue(
  state: SyncActionsContext,
): void {
  state.clearLocalFolderMultipleVaultsIssue();
}

export async function disconnectLocalFolderMultipleVaultsProvider(
  state: SyncActionsContext,
): Promise<void> {
  const health = state.localFolderHealth;
  if (health.kind !== LocalFolderHealthKind.MultipleVaults) return;
  state.clearLocalFolderMultipleVaultsIssue();
  await state.removeProvider(health.issue.providerId);
}

export async function chooseReplacementLocalFolderForIssue(
  state: SyncActionsContext,
): Promise<void> {
  const health = state.localFolderHealth;
  if (health.kind !== LocalFolderHealthKind.MultipleVaults) return;
  const issue = health.issue;
  state.clearLocalFolderMultipleVaultsIssue();
  if (state.providers.some((provider) => provider.id === issue.providerId)) {
    await state.removeProvider(issue.providerId);
  }
  state.errorMsg = "";
  state.settingsOpen = true;
  state.settingsSection = SettingsSection.Admin;
  state.adminAccordionSection = AdminAccordionSection.Storage;
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
): LocalFolderMultipleVaultsIssue {
  if (provider.type !== "local-folder") {
    throw new Error("Multiple-vault storage issue requires a local folder");
  }
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
  const localYaml = await readLocalVaultYaml().catch(() => "");
  const args =
    provider.type === "local-folder"
      ? (["local-folder", "", ""] as const)
      : state.providerWasmArgs(provider);
  const revision = NookProviderSyncRevision.untracked();
  try {
    state.stageSyncConflict(
      NookPendingSyncConflict.storeId(
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
  if (!state.hasManager) return false;
  const manager = state.requireManager();
  const issueResult = manager.takeEventLogSyncIssue();
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

    const localYaml = await readLocalVaultYaml().catch(() => "");
    await state.enqueueStorage(() =>
      manager.restoreLocalAfterProviderAssessment(),
    );
    const revision = NookProviderSyncRevision.untracked();
    try {
      state.stageSyncConflict(
        NookPendingSyncConflict.pendingStoreId(
          state.stagedProviderLabel(),
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
  if (!state.hasManager) {
    throw new Error(state.t("errors.manager_uninitialized"));
  }
  const manager = state.requireManager();
  const configuration = localFolderProviderConfiguration(provider);
  if (configuration.kind === LocalFolderProviderConfigurationKind.Missing) {
    throw new Error(state.t("errors.local_backup_folder_required"));
  }
  const handle = localFolderHandle(configuration.config);
  if (handle.kind === LocalFolderHandleKind.Unselected) {
    throw new Error(state.t("errors.local_backup_folder_required"));
  }
  const localYaml = (await state.enqueueStorage(() =>
    manager.syncLocalFolderProvider(handle.handleId),
  )) as string;
  if (localYaml.trim()) {
    await state.updateProviderSyncMetadata(
      provider.id,
      localYaml,
      NookProviderSyncRevision.untracked(),
    );
  }
}

export function startVaultSync(state: SyncActionsContext) {
  state.stopVaultSync();
  if (state.isAuthenticated && !state.deviceProtectionReady) {
    log.debug("vault sync timer skipped (device identity locked)");
    return;
  }
  const syncIntervalConfig = import.meta.env.VITE_VAULT_SYNC_INTERVAL_MS;
  const intervalMs =
    typeof syncIntervalConfig === "string"
      ? state.runtimeConfig.resolveVaultSyncIntervalMs(syncIntervalConfig)
      : state.runtimeConfig.resolveDefaultVaultSyncIntervalMs();
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
  state.scheduleSync(() => {
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
  if (state.stopScheduledSync()) {
    log.debug("vault sync timer stopped");
  }
}

export async function syncFromStorage(
  state: SyncActionsContext,
  options?: { force?: boolean },
) {
  if (!state.hasManager) return;
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
          state.requireManager().sync_vault_from_storage(mode, pat, repo),
        );
        state.applyVaultSyncResult(raw);
      }
      await state.refreshSecretsFromSession();
      state.markSynced(new SvelteDate());
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
      state
        .requireManager()
        .sync_vault_from_storage(...state.wasmStorageArgs()),
    );
    state.applyVaultSyncResult(raw);
    await state.refreshSecretsFromSession();
    state.markSynced(new SvelteDate());
  } catch (error) {
    syncError("background sync", error);
  } finally {
    state.isSyncing = false;
  }
}

export async function manualSync(state: SyncActionsContext) {
  if (!state.hasManager) return;
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
  if (!state.hasManager || !state.isAuthenticated) return;
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
  state.stageSyncConflict(conflict);
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
  state.reportLocalFolderMultipleVaults(issue);
  log.warn("local folder contains multiple vault logs", {
    provider: issue.providerLabel,
    storeIds: issue.storeIds,
  });
}

export async function syncProviderById(
  state: SyncActionsContext,
  providerId: string,
  options?: { quiet?: boolean; propagateError?: boolean },
): Promise<void> {
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
    state.manualProviderSync.kind === ManualProviderSyncKind.Running &&
    state.manualProviderSync.providerId !== providerId
  )
    return;

  state.beginManualProviderSync(providerId);
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
        state.requireManager().sync_vault_from_storage(mode, pat, repo),
        "Vault sync",
      ),
    );
    state.applyVaultSyncResult(raw);
    await state.refreshSecretsFromSession();
    await state.refreshReplacementConflicts();
    await state.updateProviderSyncMetadata(
      providerId,
      await readLocalVaultYaml(),
      NookProviderSyncRevision.untracked(),
    );
    log.debug("provider sync finished", { providerId, type: provider.type });
    return;
  } catch (e: unknown) {
    syncError(`provider sync (${provider.label})`, e);
    const eventLogIssueResult = state.requireManager().takeEventLogSyncIssue();
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
          stagedStoreMismatch = await stageProviderStoreMismatchConflict(
            state,
            provider,
            localStoreId,
            remoteStoreId,
          );
        } else if (eventLogIssue.isMultipleStores) {
          localFolderInspection = {
            kind: LocalFolderInspectionKind.MultipleVaults,
            issue: localFolderMultipleVaultsIssueFromTypedIssue(
              provider,
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
      stageLocalFolderMultipleVaultsIssue(state, localFolderInspection.issue);
    }
    if (!options?.quiet) {
      state.errorMsg = stagedStoreMismatch
        ? state.t("auth_storage.sync_conflict_store_id_banner", {
            provider: provider.label,
          })
        : localFolderInspection.kind ===
            LocalFolderInspectionKind.MultipleVaults
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
    if (
      state.manualProviderSync.kind === ManualProviderSyncKind.Running &&
      state.manualProviderSync.providerId === providerId
    ) {
      state.clearSyncingProvider();
    }
  }
}
