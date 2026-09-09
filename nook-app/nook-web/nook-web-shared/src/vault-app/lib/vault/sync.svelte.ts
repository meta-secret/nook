import { I18N_KEYS } from "../../../generated/i18n-keys";

/** Sync actions that snapshot reactive Svelte state at WASM boundaries. */
import type {
  ProviderSyncRequest,
  SyncActionsContext,
  SyncFromProvidersRequest,
  VaultStorageArguments,
} from "$lib/vault/action-contexts";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  isoTimestamp,
  syncVaultFromStorage,
  type JoinRequest,
  type VaultMember,
} from "$lib/nook";
import {
  NookManagerStoreScope,
  NookEventLogSyncIssueState,
  NookLocalFolderHealthState,
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  NookSyncConflictReview,
  ProviderSyncFailureHandling,
  ProviderSyncFreshness,
  ProviderSyncVisibility,
  read_local_vault_yaml,
  update_provider_sync_metadata,
  VaultStorageSyncDecision,
  VaultSyncTimerStartDecision,
  VaultSyncTimerTickDecision,
} from "$app-wasm";
import {
  activeVaultScope,
  LOCAL_FOLDER_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  unselectedVaultScope,
  type StorageProvider,
} from "$lib/auth/providers";
import {
  EventOutboxRequestKind,
  EventOutboxTargetKind,
  type EventOutboxRequest,
  type EventOutboxTarget,
} from "$lib/vault/sync-operation-state";
import { AdminAccordionSection } from "$lib/vault/state/ui.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import { VaultSyncRuntimeActions } from "$lib/vault/sync-runtime";
import { ExtensionSyncPublication } from "$lib/vault/sync-extension-bridge";
import { ProviderSyncActions } from "$lib/vault/provider-sync.svelte";

export { VaultSyncRuntimeActions } from "$lib/vault/sync-runtime";

export { ExtensionSyncPublication };

export * from "$lib/vault/sync-resolution";

export { SyncConflictPresentation } from "$lib/vault/sync-conflict-label";

const log = browserLogRuntime.createLogger("vault-sync");

interface EventOutboxTargetSelection {
  readonly request: EventOutboxRequest;
}

interface RemoteEventOutboxFlush {
  readonly request: EventOutboxRequest;
}

interface ProviderSyncMetadataUpdate {
  readonly providerId: string;
  readonly yaml: string;
  readonly revision: NookProviderSyncRevision;
}

interface StagedProviderConflictCompletion {
  readonly conflict: NookSyncConflictReview;
}

interface ProviderConflictPersistence {
  readonly conflict: NookSyncConflictReview;
}

interface StagedProviderSyncIssueAssessment {
  readonly args: VaultStorageArguments;
}

interface SyncConflictStaging {
  readonly conflict: NookPendingSyncConflict;
}

type SyncFromProvidersExecution = SyncFromProvidersRequest & {};

type FanOutSyncExecution = {
  readonly visibility: ProviderSyncVisibility;
};

type StorageSyncExecution = {
  readonly freshness: ProviderSyncFreshness;
};

export { ProviderSyncActions } from "$lib/vault/provider-sync.svelte";

/** Owns browser orchestration for one sync.svelte context. */
export class VaultSyncActions {
  constructor(private readonly state: SyncActionsContext) {}

  async hydrateMultiDeviceState(): Promise<void> {
    const state = this.state;
    if (!state.hasManager || !state.isAuthenticated) return;
    const mergedJoins: JoinRequest[] = [];
    try {
      for (const provider of state.syncProviders) {
        if (provider.type === LOCAL_FOLDER_PROVIDER_TYPE) {
          const syncLocalFolderProviderArgs: Parameters<
            ProviderSyncActions["syncLocalFolderProvider"]
          >[0] = { provider };
          await new ProviderSyncActions(state).syncLocalFolderProvider(
            syncLocalFolderProviderArgs,
          );
          continue;
        }
        const { mode, pat, repo } = state.providerWasmArgs(provider);
        const joins = await state.enqueueStorage(() =>
          state
            .requireManager()
            .merge_remote_joins_from_provider(mode, pat, repo),
        );
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
          await state.requireManager().ensure_vault_roster_hydrated_js();
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

  async syncFromSyncProviders({
    visibility,
    freshness,
  }: SyncFromProvidersExecution): Promise<void> {
    const state = this.state;
    if (!state.hasManager) return;
    if (
      !state.clientPolicy.should_sync_from_providers(
        state.syncBlocked,
        freshness === ProviderSyncFreshness.Forced,
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
        const syncProviderByIdArgs: ProviderSyncRequest = {
          providerId: provider.id,
          visibility,
          failureHandling: ProviderSyncFailureHandling.Capture,
        };
        await state.syncProviderById(syncProviderByIdArgs);
      }
      if (state.isAuthenticated) {
        await this.hydrateMultiDeviceState();
      }
      await new ExtensionSyncPublication(
        state,
      ).publishExtensionEventLogUpdateForVault();
      state.markSynced(Date.now());
    } catch {
      // Background sync should not interrupt the UI.
    } finally {
      state.isSyncing = false;
    }
  }

  async runFanOutSyncToProviders({
    visibility,
  }: FanOutSyncExecution): Promise<void> {
    const state = this.state;
    if (state.isFanOutSyncing) return;
    state.isFanOutSyncing = true;
    try {
      for (const provider of state.syncProviders) {
        if (state.syncBlocked) break;
        const syncProviderByIdArgs2: ProviderSyncRequest = {
          providerId: provider.id,
          visibility,
          failureHandling: ProviderSyncFailureHandling.Capture,
        };
        await state.syncProviderById(syncProviderByIdArgs2);
      }
    } finally {
      state.isFanOutSyncing = false;
    }
  }

  async runFanOutSyncAfterLocalSave(): Promise<void> {
    const state = this.state;
    await new ExtensionSyncPublication(
      state,
    ).publishExtensionEventLogUpdateForVault();
    if (!state.deviceProtectionReady) return;
    if (state.syncProviders.length === 0) {
      const request: EventOutboxRequest = {
        kind: EventOutboxRequestKind.Default,
      };
      await state.flushRemoteEventOutboxNow(request);
      return;
    }
    for (const provider of state.syncProviders) {
      if (state.syncBlocked) break;
      const request = VaultSyncActions.eventOutboxRequestForProvider(provider);
      await state.flushRemoteEventOutboxNow(request);
    }
  }

  static eventOutboxRequestForProvider(
    provider: StorageProvider,
  ): EventOutboxRequest {
    return provider.type === LOCAL_FOLDER_PROVIDER_TYPE
      ? { kind: EventOutboxRequestKind.LocalFolder, provider }
      : { kind: EventOutboxRequestKind.Remote, provider };
  }

  eventOutboxTarget({
    request,
  }: EventOutboxTargetSelection): EventOutboxTarget {
    const state = this.state;
    if (request.kind === EventOutboxRequestKind.LocalFolder) {
      return {
        kind: EventOutboxTargetKind.LocalFolder,
        provider: request.provider,
      };
    }
    if (request.kind === EventOutboxRequestKind.Remote) {
      return {
        kind: EventOutboxTargetKind.Remote,
        args: state.providerWasmArgs(request.provider),
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

  async flushRemoteEventOutboxNow({
    request,
  }: RemoteEventOutboxFlush): Promise<void> {
    const state = this.state;
    if (!state.hasManager) return;
    const eventOutboxTargetArgs: Parameters<
      VaultSyncActions["eventOutboxTarget"]
    >[0] = {
      request,
    };
    const target = this.eventOutboxTarget(eventOutboxTargetArgs);
    if (target.kind === EventOutboxTargetKind.LocalFolder) {
      try {
        const syncLocalFolderProviderArgs2: Parameters<
          ProviderSyncActions["syncLocalFolderProvider"]
        >[0] = { provider: target.provider };
        await new ProviderSyncActions(state).syncLocalFolderProvider(
          syncLocalFolderProviderArgs2,
        );
      } catch {
        log.warn("local backup sync skipped");
      }
      return;
    }
    if (target.kind === EventOutboxTargetKind.Unavailable) return;
    try {
      await state.enqueueStorage(() =>
        state.requireManager().flush_event_outbox_for_provider(...target.args),
      );
    } catch {
      log.warn("event outbox flush skipped");
    }
  }

  async updateProviderSyncMetadata({
    providerId,
    yaml,
    revision,
  }: ProviderSyncMetadataUpdate): Promise<void> {
    const state = this.state;
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
        state.providers = update_provider_sync_metadata(
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
      const persistenceOptions: Parameters<typeof state.persistProviders>[0] = {
        replace: false,
      };
      await state.persistProviders(persistenceOptions);
      state.markSynced(Date.now());
    } finally {
      revision.free();
    }
  }

  dismissLocalFolderMultipleVaultsIssue(): void {
    const state = this.state;
    state.clearLocalFolderMultipleVaultsIssue();
  }

  async disconnectLocalFolderMultipleVaultsProvider(): Promise<void> {
    const state = this.state;
    const health = state.localFolderHealth;
    if (health.state !== NookLocalFolderHealthState.MultipleVaults) return;
    const providerId = health.providerId;
    state.clearLocalFolderMultipleVaultsIssue();
    await state.removeProvider(providerId);
  }

  async chooseReplacementLocalFolderForIssue(): Promise<void> {
    const state = this.state;
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

  finishStagedProviderConnectAfterConflict({
    conflict,
  }: StagedProviderConflictCompletion): void {
    const state = this.state;
    if (!conflict.isPendingProvider) return;
    state.clearLoginSetup();
    state.addProviderOpen = false;
  }

  async ensureProviderSavedAfterConflict({
    conflict,
  }: ProviderConflictPersistence): Promise<string> {
    const state = this.state;
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
    const [provider = state.providers[state.providers.length - 1]] = [
      state.syncProviders[state.syncProviders.length - 1],
    ];
    if (!provider || provider.type === LOCAL_PROVIDER_TYPE) {
      throw new Error(state.t(I18N_KEYS.ErrorsCloudSyncProviderRequired));
    }
    return provider.id;
  }

  async stageStagedProviderSyncIssue({
    args,
  }: StagedProviderSyncIssueAssessment): Promise<boolean> {
    const state = this.state;
    if (!state.hasManager) return false;
    const manager = state.requireManager();
    const issueResult = manager.take_event_log_sync_issue();
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

      const localYaml = await read_local_vault_yaml().catch(() => "");
      await state.enqueueStorage(() =>
        manager.restore_local_after_provider_assessment(),
      );
      const revision = NookProviderSyncRevision.untracked();
      try {
        state.stageSyncConflict(
          NookPendingSyncConflict.pending_store_id(
            state.stagedProviderLabel(),
            localYaml,
            "",
            args.mode,
            args.pat,
            args.repo,
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

  startVaultSync() {
    const state = this.state;
    state.stopVaultSync();
    const startDecision = state.clientPolicy.vault_sync_timer_start_decision(
      state.isAuthenticated,
      state.deviceProtectionReady,
      state.joinEnrollmentPrompt,
      state.awaitingJoinApproval,
    );
    switch (startDecision) {
      case VaultSyncTimerStartDecision.SkipDeviceProtectionLocked:
        log.debug("vault sync timer skipped (device identity locked)");
        return;
      case VaultSyncTimerStartDecision.SkipNoRemoteUpdates:
        log.debug("vault sync timer skipped (no remote updates needed)");
        return;
      case VaultSyncTimerStartDecision.Start:
        break;
    }
    const syncIntervalConfig = import.meta.env.VITE_VAULT_SYNC_INTERVAL_MS;
    const intervalMs =
      typeof syncIntervalConfig === "string"
        ? state.runtimeConfig.resolve_vault_sync_interval_ms(syncIntervalConfig)
        : state.runtimeConfig.resolve_default_vault_sync_interval_ms();
    log.info("vault sync timer started");
    if (state.isAuthenticated) {
      void state.syncFromStorage(ProviderSyncFreshness.Scheduled);
    }
    const scheduleSyncArgs: Parameters<typeof state.scheduleSync>[0] = {
      callback: () => {
        const tickDecision = state.clientPolicy.vault_sync_timer_tick_decision(
          state.isVerifying,
          state.isSaving,
          state.isSyncing,
          state.isPasswordBusy,
          state.isAuthenticated,
          state.joinEnrollmentPrompt,
          state.awaitingJoinApproval,
          state.syncProviders.length,
        );
        if (tickDecision !== VaultSyncTimerTickDecision.Sync) {
          return;
        }
        void state.syncFromStorage(ProviderSyncFreshness.Scheduled);
      },
      intervalMs,
    };
    state.scheduleSync(scheduleSyncArgs);
  }

  stopVaultSync() {
    const state = this.state;
    if (state.stopScheduledSync()) {
      log.debug("vault sync timer stopped");
    }
  }

  async syncFromStorage({ freshness }: StorageSyncExecution) {
    const state = this.state;
    if (!state.hasManager) return;
    const syncDecision = state.clientPolicy.vault_storage_sync_decision(
      state.syncBlocked,
      freshness,
      state.isVerifying,
      state.isSaving,
      state.isPasswordBusy,
      state.isSyncing,
      state.isAuthenticated,
      state.syncProviders.length,
      state.hasRemoteCredentials(),
      state.localVaultPresent,
    );
    if (syncDecision === VaultStorageSyncDecision.Skip) return;

    if (
      syncDecision === VaultStorageSyncDecision.SyncFirstProviderUnauthenticated
    ) {
      state.isSyncing = true;
      try {
        const provider = state.syncProviders[0]!;
        if (provider.type === "local-folder") {
          const syncLocalFolderProviderArgs3: Parameters<
            ProviderSyncActions["syncLocalFolderProvider"]
          >[0] = { provider };
          await new ProviderSyncActions(state).syncLocalFolderProvider(
            syncLocalFolderProviderArgs3,
          );
        } else {
          const { mode, pat, repo } = state.providerWasmArgs(provider);
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
        const syncErrorArgs: Parameters<
          typeof VaultSyncRuntimeActions.syncError
        >[0] = {
          context: "background sync (unauthenticated)",
          failure: browserLogRuntime.runtimeFailure(error),
        };
        VaultSyncRuntimeActions.syncError(syncErrorArgs);
      } finally {
        state.isSyncing = false;
      }
      return;
    }

    if (syncDecision === VaultStorageSyncDecision.SyncProviders) {
      const syncFromSyncProvidersArgs: SyncFromProvidersRequest = {
        visibility: ProviderSyncVisibility.Quiet,
        freshness,
      };
      await state.syncFromSyncProviders(syncFromSyncProvidersArgs);
      return;
    }

    await state.ensureOAuthTokensFresh();

    state.isSyncing = true;
    try {
      const { mode, pat, repo } = state.wasmStorageArgs();
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
      const syncErrorArgs2: Parameters<
        typeof VaultSyncRuntimeActions.syncError
      >[0] = {
        context: "background sync",
        failure: browserLogRuntime.runtimeFailure(error),
      };
      VaultSyncRuntimeActions.syncError(syncErrorArgs2);
    } finally {
      state.isSyncing = false;
    }
  }

  async manualSync() {
    const state = this.state;
    if (!state.hasManager) return;
    if (state.syncBlocked) return;
    if (state.isSyncing) return;

    // A fresh browser may retain provider credentials before it has a vault, but
    // credentials alone do not establish a sync target. Initializing
    // device-dependent sync in that state asks the WASM manager to encrypt before
    // vault crypto exists. Keep the device roster projection empty until a vault
    // or a connected sync provider exists.
    if (
      !state.clientPolicy.manual_sync_has_target(
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
          await state.syncFromStorage(ProviderSyncFreshness.Forced);
        } else {
          state.pendingJoins = [];
          state.vaultMembers = [];
        }
        return;
      }
      for (const provider of state.syncProviders) {
        const syncRequest: ProviderSyncRequest = {
          providerId: provider.id,
          visibility: ProviderSyncVisibility.Visible,
          failureHandling: ProviderSyncFailureHandling.Capture,
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
      const syncErrorArgs3: Parameters<
        typeof VaultSyncRuntimeActions.syncError
      >[0] = {
        context: "manual sync",
        failure: browserLogRuntime.runtimeFailure(error),
      };
      VaultSyncRuntimeActions.syncError(syncErrorArgs3);
    } finally {
      state.isSyncing = false;
      log.debug("manual sync finished");
    }
  }

  async fanOutSyncToProviders({
    visibility,
  }: FanOutSyncExecution): Promise<void> {
    const state = this.state;
    if (!state.hasManager || !state.isAuthenticated) return;
    if (state.syncBlocked) return;
    if (state.syncProviders.length === 0) return;
    log.debug("fan-out sync queued");
    const run = state.fanOutSyncChain.then(() =>
      state.runFanOutSyncToProviders(visibility),
    );
    state.fanOutSyncChain = run.catch(() => {});
    return run;
  }

  stageSyncConflict({ conflict }: SyncConflictStaging) {
    const state = this.state;
    log.warn("sync conflict staged");
    state.stageSyncConflict(conflict);
    state.errorMsg = "";
  }
}
