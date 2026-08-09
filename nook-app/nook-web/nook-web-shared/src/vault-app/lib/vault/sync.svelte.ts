import { I18N_KEYS } from "../../../generated/i18n-keys";
/** Sync actions that snapshot reactive Svelte state at WASM boundaries. */
import type { SyncActionsContext } from "$lib/vault/action-contexts";
import { createLogger, runtimeFailure } from "$lib/runtime/log";
import {
  isoTimestamp,
  syncVaultFromStorage,
  VaultAccessStatus,
  type JoinRequest,
  type NookVaultSyncResult,
  type VaultMember,
} from "$lib/nook";
import {
  JoinEnrollmentState,
  NookManagerStoreScope,
  NookEventLogSyncIssueState,
  NookLocalFolderHealthState,
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  NookSyncConflictReview,
  NookVaultSyncAccessState,
  readLocalVaultYaml,
  UnauthenticatedSyncDecision,
  updateProviderSyncMetadata as updateProviderSyncMetadataWasm,
} from "$app-wasm";
import {
  activeVaultScope,
  LOCAL_FOLDER_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  unselectedVaultScope,
  type StorageProvider,
} from "$lib/auth/providers";
import {
  EventOutboxTargetKind,
  type EventOutboxTarget,
} from "$lib/vault/sync-operation-state";
import { AdminAccordionSection } from "$lib/vault/state/ui.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import {
  scheduleAutoConnectAfterApproval,
  syncError,
} from "$lib/vault/sync-runtime";
import { publishExtensionEventLogUpdateForVault } from "$lib/vault/sync-extension-bridge";
import { syncLocalFolderProvider } from "$lib/vault/provider-sync.svelte";
export { publishExtensionEventLogUpdateForVault };

export * from "$lib/vault/sync-resolution";
export { syncConflictLabel } from "$lib/vault/sync-conflict-label";

const log = createLogger("vault-sync");

export function applyVaultSyncResult({
  state,
  result,
}: {
  readonly state: SyncActionsContext;
  readonly result: NookVaultSyncResult;
}): void {
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
  log.debug("sync result (unauthenticated)");

  if (accessAssessed) {
    log.info("sync state changed (login gate)");
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
      state.showSuccess(state.t(I18N_KEYS.ToastsDeviceApproved));
      scheduleAutoConnectAfterApproval(state);
      break;
    case UnauthenticatedSyncDecision.AutoConnect:
      scheduleAutoConnectAfterApproval(state);
      break;
    case UnauthenticatedSyncDecision.MarkJoinPending:
      state.joinEnrollmentPrompt = JoinEnrollmentState.Pending;
      state.awaitingJoinApproval = true;
      break;
    case UnauthenticatedSyncDecision.Ignore:
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
        const syncLocalFolderProviderArgs: Parameters<
          typeof syncLocalFolderProvider
        >[0] = { state, provider };
        await syncLocalFolderProvider(syncLocalFolderProviderArgs);
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

export async function syncFromSyncProviders({
  state,
  options,
}: {
  readonly state: SyncActionsContext;
  readonly options?: { quiet?: boolean; force?: boolean };
}): Promise<void> {
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
      const syncProviderByIdArgs: Parameters<typeof state.syncProviderById>[0] =
        {
          providerId: provider.id,
          options: { quiet: options?.quiet ?? true },
        };
      await state.syncProviderById(syncProviderByIdArgs);
    }
    if (state.isAuthenticated) {
      await hydrateMultiDeviceState(state);
    }
    await publishExtensionEventLogUpdateForVault(state);
    state.markSynced(Date.now());
  } catch {
    // Background sync should not interrupt the UI.
  } finally {
    state.isSyncing = false;
  }
}

export async function runFanOutSyncToProviders({
  state,
  options,
}: {
  readonly state: SyncActionsContext;
  readonly options?: { quiet?: boolean };
}): Promise<void> {
  if (state.isFanOutSyncing) return;
  state.isFanOutSyncing = true;
  try {
    for (const provider of state.syncProviders) {
      if (state.syncBlocked) break;
      const syncProviderByIdArgs2: Parameters<
        typeof state.syncProviderById
      >[0] = {
        providerId: provider.id,
        options: { quiet: options?.quiet ?? true },
      };
      await state.syncProviderById(syncProviderByIdArgs2);
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

export function eventOutboxTarget({
  state,
  provider,
}: {
  readonly state: SyncActionsContext;
  readonly provider?: StorageProvider;
}): EventOutboxTarget {
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

export async function flushRemoteEventOutboxNow({
  state,
  provider,
}: {
  readonly state: SyncActionsContext;
  readonly provider?: StorageProvider;
}): Promise<void> {
  if (!state.hasManager) return;
  const eventOutboxTargetArgs: Parameters<typeof eventOutboxTarget>[0] = {
    state,
    provider,
  };
  const target = eventOutboxTarget(eventOutboxTargetArgs);
  if (target.kind === EventOutboxTargetKind.LocalFolder) {
    try {
      const syncLocalFolderProviderArgs2: Parameters<
        typeof syncLocalFolderProvider
      >[0] = { state, provider: target.provider };
      await syncLocalFolderProvider(syncLocalFolderProviderArgs2);
    } catch (error) {
      log.warn("local backup sync skipped");
    }
    return;
  }
  if (target.kind === EventOutboxTargetKind.Unavailable) return;
  try {
    await state.enqueueStorage(() =>
      state.requireManager().flushEventOutboxForProvider(...target.args),
    );
  } catch (error) {
    log.warn("event outbox flush skipped");
  }
}

/** Persist sync metadata and consume the JS-owned WASM revision wrapper. */
export async function updateProviderSyncMetadata({
  state,
  providerId,
  yaml,
  revision,
}: {
  readonly state: SyncActionsContext;
  readonly providerId: string;
  readonly yaml: string;
  readonly revision: NookProviderSyncRevision;
}): Promise<void> {
  try {
    const managerStoreId = state.hasManager
      ? await state.enqueueStorage(() => state.requireManager().vaultStoreId)
      : "";
    const managerStoreScope = managerStoreId
      ? NookManagerStoreScope.scoped(managerStoreId)
      : NookManagerStoreScope.unscoped();
    try {
      const snapshotArgs: Parameters<typeof $state.snapshot>[0] = {
        providers: state.providers,
        activeVaultStoreId:
          state.activeVault.kind === ActiveVaultKind.Open
            ? activeVaultScope(state.activeVault.storeId)
            : unselectedVaultScope(),
      };
      state.providers = updateProviderSyncMetadataWasm(
        $state.snapshot(snapshotArgs),
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
    state.markSynced(Date.now());
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
  if (health.state !== NookLocalFolderHealthState.MultipleVaults) return;
  const providerId = health.providerId;
  state.clearLocalFolderMultipleVaultsIssue();
  await state.removeProvider(providerId);
}

export async function chooseReplacementLocalFolderForIssue(
  state: SyncActionsContext,
): Promise<void> {
  const health = state.localFolderHealth;
  if (health.state !== NookLocalFolderHealthState.MultipleVaults) return;
  const providerId = health.providerId;
  state.clearLocalFolderMultipleVaultsIssue();
  if (state.providers.some((provider) => provider.id === providerId)) {
    await state.removeProvider(providerId);
  }
  state.errorMsg = "";
  state.openAdmin(AdminAccordionSection.Storage);
  state.beginAddProvider();
  const setupRequest: Parameters<typeof state.beginProviderSetup>[0] = {
    type: LOCAL_FOLDER_PROVIDER_TYPE,
  };
  state.beginProviderSetup(setupRequest);
}

export function finishStagedProviderConnectAfterConflict({
  state,
  conflict,
}: {
  readonly state: SyncActionsContext;
  readonly conflict: NookSyncConflictReview;
}): void {
  if (!conflict.isPendingProvider) return;
  state.clearLoginSetup();
  state.addProviderOpen = false;
}

export async function ensureProviderSavedAfterConflict({
  state,
  conflict,
}: {
  readonly state: SyncActionsContext;
  readonly conflict: NookSyncConflictReview;
}): Promise<string> {
  if (
    !conflict.isPendingProvider &&
    state.providers.some((provider) => provider.id === conflict.providerId)
  ) {
    return conflict.providerId;
  }
  const saved = await state.ensureProviderSaved();
  if (!saved) {
    throw new Error(state.t(I18N_KEYS.AuthStorageDuplicateSyncProvider));
  }
  const provider =
    state.syncProviders[state.syncProviders.length - 1] ??
    state.providers[state.providers.length - 1];
  if (!provider || provider.type === LOCAL_PROVIDER_TYPE) {
    throw new Error(state.t(I18N_KEYS.ErrorsCloudSyncProviderRequired));
  }
  return provider.id;
}

/** Map a typed mismatch found during provider assessment into the global dialog. */
export async function stageStagedProviderSyncIssue({
  state,
  args,
}: {
  readonly state: SyncActionsContext;
  readonly args: [string, string, string];
}): Promise<boolean> {
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
    log.warn("staged provider store mismatch staged");
    return true;
  } finally {
    issue.free();
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
  log.info("vault sync timer started");
  if (state.isAuthenticated) {
    void state.syncFromStorage();
  }
  const scheduleSyncArgs: Parameters<typeof state.scheduleSync>[0] = {
    callback: () => {
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
    },
    intervalMs,
  };
  state.scheduleSync(scheduleSyncArgs);
}

export function stopVaultSync(state: SyncActionsContext) {
  if (state.stopScheduledSync()) {
    log.debug("vault sync timer stopped");
  }
}

export async function syncFromStorage({
  state,
  options,
}: {
  readonly state: SyncActionsContext;
  readonly options?: { force?: boolean };
}) {
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
        const syncLocalFolderProviderArgs3: Parameters<
          typeof syncLocalFolderProvider
        >[0] = { state, provider };
        await syncLocalFolderProvider(syncLocalFolderProviderArgs3);
      } else {
        const [mode, pat, repo] = state.providerWasmArgs(provider);
        const syncRequest: Parameters<typeof syncVaultFromStorage>[0] = {
          manager: state.requireManager(),
          mode,
          pat,
          repo,
        };
        const raw = await state.enqueueStorage(() =>
          syncVaultFromStorage(syncRequest),
        );
        state.applyVaultSyncResult(raw);
      }
      await state.refreshSecretsFromSession();
      state.markSynced(Date.now());
    } catch (error) {
      const syncErrorArgs: Parameters<typeof syncError>[0] = {
        context: "background sync (unauthenticated)",
        failure: runtimeFailure(error),
      };
      syncError(syncErrorArgs);
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
    const syncFromSyncProvidersArgs: Parameters<
      typeof state.syncFromSyncProviders
    >[0] = { quiet: true, force: options?.force };
    await state.syncFromSyncProviders(syncFromSyncProvidersArgs);
    return;
  }

  await state.ensureOAuthTokensFresh();

  state.isSyncing = true;
  try {
    const [mode, pat, repo] = state.wasmStorageArgs();
    const syncRequest: Parameters<typeof syncVaultFromStorage>[0] = {
      manager: state.requireManager(),
      mode,
      pat,
      repo,
    };
    const raw = await state.enqueueStorage(() =>
      syncVaultFromStorage(syncRequest),
    );
    state.applyVaultSyncResult(raw);
    await state.refreshSecretsFromSession();
    state.markSynced(Date.now());
  } catch (error) {
    const syncErrorArgs2: Parameters<typeof syncError>[0] = {
      context: "background sync",
      failure: runtimeFailure(error),
    };
    syncError(syncErrorArgs2);
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
  log.info("manual sync started");
  state.isSyncing = true;
  try {
    await state.initDeviceIdentity();
    if (state.syncProviders.length === 0) {
      if (state.hasRemoteCredentials()) {
        const syncFromStorageArgs: Parameters<typeof state.syncFromStorage>[0] =
          { force: true };
        await state.syncFromStorage(syncFromStorageArgs);
      } else {
        state.pendingJoins = [];
        state.vaultMembers = [];
      }
      return;
    }
    for (const provider of state.syncProviders) {
      const syncRequest: Parameters<typeof state.syncProviderById>[0] = {
        providerId: provider.id,
      };
      await state.syncProviderById(syncRequest);
    }
    if (state.isAuthenticated) {
      await state.hydrateMultiDeviceState();
    } else {
      state.pendingJoins = [];
      state.vaultMembers = [];
    }
  } catch (error) {
    const syncErrorArgs3: Parameters<typeof syncError>[0] = {
      context: "manual sync",
      failure: runtimeFailure(error),
    };
    syncError(syncErrorArgs3);
  } finally {
    state.isSyncing = false;
    log.debug("manual sync finished");
  }
}

export async function fanOutSyncToProviders({
  state,
  options,
}: {
  readonly state: SyncActionsContext;
  readonly options?: { quiet?: boolean };
}): Promise<void> {
  if (!state.hasManager || !state.isAuthenticated) return;
  if (state.syncBlocked) return;
  if (state.syncProviders.length === 0) return;
  log.debug("fan-out sync queued");
  const run = state.fanOutSyncChain.then(() =>
    state.runFanOutSyncToProviders(options),
  );
  state.fanOutSyncChain = run.catch(() => {});
  return run;
}

export function stageSyncConflict({
  state,
  conflict,
}: {
  readonly state: SyncActionsContext;
  readonly conflict: NookPendingSyncConflict;
}) {
  log.warn("sync conflict staged");
  state.stageSyncConflict(conflict);
  state.errorMsg = "";
}

export {
  syncLocalFolderProvider,
  syncProviderById,
} from "$lib/vault/provider-sync.svelte";
