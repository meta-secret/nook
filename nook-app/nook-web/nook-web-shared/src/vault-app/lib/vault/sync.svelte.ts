import type { OAuthFailure } from "$lib/auth/oauth-failure";
import { ProviderSyncOutcome } from "$lib/vault/provider-sync.svelte";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";

/** Sync actions that snapshot reactive Svelte state at WASM boundaries. */
import type {
  SyncActionsContext,
  SyncFromProvidersRequest,
  NookStorageConnectArgs,
} from "$lib/vault/action-contexts";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  isoTimestamp,
  syncVaultFromStorage,
  type JoinRequest,
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
} from "$lib/auth/providers";
import {
  ProviderEventOutbox,
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

export type VaultSynchronizationResult = Result<
  ProviderSyncOutcome,
  StorageOperationFailure | OAuthFailure
>;

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

/** Whether the browser staged a conflict dialog for the attempted provider. */
export enum StagedProviderConflictOutcome {
  NotStaged = "not-staged",
  Staged = "staged",
}

interface StagedProviderSyncIssueAssessment {
  readonly args: NookStorageConnectArgs;
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

export type RosterHydrationResult = Result<
  void,
  StorageOperationFailure | OAuthFailure
>;

/** Owns browser orchestration for one sync.svelte context. */
export class VaultSyncActions {
  constructor(private readonly state: SyncActionsContext) {}

  async hydrateMultiDeviceState(): Promise<RosterHydrationResult> {
    const state = this.state;
    if (!state.hasManager || !state.isAuthenticated) return storageOk();
    const mergedJoins: JoinRequest[] = [];
    try {
      for (const provider of state.syncProviders) {
        if (provider.type === LOCAL_FOLDER_PROVIDER_TYPE) {
          const synced = await new ProviderSyncActions(
            state,
          ).syncLocalFolderProvider({ provider });
          if (synced.isErr()) {
            return storageErr(synced.error);
          }
          continue;
        }
        const { mode, pat, repo } = state.providerWasmArgs(provider);
        const joins = await state.enqueueStorage(async () => {
          const admitted = state.admitManager();
          if (admitted.isErr()) return storageErr(admitted.error);
          try {
            return storageOk(
              await admitted.value.merge_remote_joins_from_provider(
                mode,
                pat,
                repo,
              ),
            );
          } catch (failure) {
            return storageErr(new NativeVaultStorageFailure(failure));
          }
        });
        if (joins.isErr()) {
          return storageErr(joins.error);
        }
        mergedJoins.push(...joins.value);
      }
      const snapshot = await state.enqueueStorage(async () => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        try {
          await admitted.value.ensure_vault_roster_hydrated_js();
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
        let pendingJoins: JoinRequest[];
        try {
          pendingJoins = admitted.value.list_pending_joins();
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
        try {
          return storageOk({
            pendingJoins,
            vaultMembers: admitted.value.list_vault_members(),
          });
        } catch (failure) {
          for (const join of pendingJoins) join.free();
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (snapshot.isErr()) {
        return storageErr(snapshot.error);
      }
      for (const join of state.pendingJoins) join.free();
      for (const member of state.vaultMembers) member.free();
      state.pendingJoins =
        snapshot.value.pendingJoins.length > 0
          ? snapshot.value.pendingJoins
          : mergedJoins.splice(0);
      state.vaultMembers = snapshot.value.vaultMembers;
      const passwordRefresh1 = await state.refreshPasswordEntriesList();
      if (passwordRefresh1.isErr()) {
        return storageErr(passwordRefresh1.error);
      }
      return storageOk();
    } finally {
      for (const join of mergedJoins) join.free();
    }
  }

  async syncFromSyncProviders({
    visibility,
    freshness,
  }: SyncFromProvidersExecution): Promise<VaultSynchronizationResult> {
    const state = this.state;
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    let shouldSync: boolean;
    try {
      shouldSync = state.clientPolicy.should_sync_from_providers(
        state.syncBlocked,
        freshness === ProviderSyncFreshness.Forced,
        state.isVerifying,
        state.isSaving,
        state.isPasswordBusy,
        state.isSyncing,
        state.syncProviders.length,
      );
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
    if (!shouldSync) return storageOk(ProviderSyncOutcome.Skipped);
    state.isSyncing = true;
    try {
      const synchronized = await this.synchronizeProviders(visibility);
      if (synchronized.isErr()) return synchronized;
      if (state.isAuthenticated) {
        const roster = await this.hydrateMultiDeviceState();
        if (roster.isErr()) return storageErr(roster.error);
      }
      const publication = await new ExtensionSyncPublication(
        state,
      ).publishExtensionEventLogUpdateForVault();
      if (publication.isErr()) return storageErr(publication.error);
      if (synchronized.value === ProviderSyncOutcome.Synced)
        state.markSynced(Date.now());
      return synchronized;
    } finally {
      state.isSyncing = false;
    }
  }

  private async synchronizeProviders(
    visibility: ProviderSyncVisibility,
  ): Promise<VaultSynchronizationResult> {
    const state = this.state;
    let outcome = ProviderSyncOutcome.Synced;
    for (const provider of state.syncProviders) {
      if (state.syncBlocked) return storageOk(ProviderSyncOutcome.Skipped);
      const synchronized = await state.syncProviderById({
        providerId: provider.id,
        visibility,
        failureHandling: ProviderSyncFailureHandling.Capture,
      });
      if (synchronized.isErr()) return synchronized;
      if (synchronized.value !== ProviderSyncOutcome.Synced)
        outcome = synchronized.value;
    }
    return storageOk(outcome);
  }

  async runFanOutSyncToProviders({
    visibility,
  }: FanOutSyncExecution): Promise<VaultSynchronizationResult> {
    const state = this.state;
    if (state.isFanOutSyncing) return storageOk(ProviderSyncOutcome.Skipped);
    state.isFanOutSyncing = true;
    try {
      return await this.synchronizeProviders(visibility);
    } finally {
      state.isFanOutSyncing = false;
    }
  }

  async runFanOutSyncAfterLocalSave(): Promise<
    Result<void, StorageOperationFailure>
  > {
    const state = this.state;
    const publication = await new ExtensionSyncPublication(
      state,
    ).publishExtensionEventLogUpdateForVault();
    if (publication.isErr()) return storageErr(publication.error);
    if (!state.deviceProtectionReady) return storageOk();
    if (state.syncProviders.length === 0) {
      return state.flushRemoteEventOutboxNow({
        kind: EventOutboxRequestKind.Default,
      });
    }
    for (const provider of state.syncProviders) {
      if (state.syncBlocked) break;
      const flushed = await state.flushRemoteEventOutboxNow(
        new ProviderEventOutbox(provider).request(),
      );
      if (flushed.isErr()) return storageErr(flushed.error);
    }
    return storageOk();
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
  }: RemoteEventOutboxFlush): Promise<Result<void, StorageOperationFailure>> {
    const state = this.state;
    const admitted = state.admitManager();
    if (admitted.isErr()) return storageErr(admitted.error);
    const target = this.eventOutboxTarget({ request });
    if (target.kind === EventOutboxTargetKind.LocalFolder) {
      const synced = await new ProviderSyncActions(
        state,
      ).syncLocalFolderProvider({
        provider: target.provider,
      });
      return synced;
    }
    if (target.kind === EventOutboxTargetKind.Unavailable) return storageOk();
    const flushed = await state.enqueueStorage(async () => {
      const admitted = state.admitManager();
      if (admitted.isErr()) return storageErr(admitted.error);
      try {
        await admitted.value.flush_event_outbox_for_provider(
          target.args.mode,
          target.args.pat,
          target.args.repo,
        );
        return storageOk();
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    return flushed;
  }

  async updateProviderSyncMetadata({
    providerId,
    yaml,
    revision,
  }: ProviderSyncMetadataUpdate): Promise<
    Result<void, StorageOperationFailure>
  > {
    const state = this.state;
    try {
      const updated = await state.enqueueStorage(() => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        let managerStoreScope: NookManagerStoreScope;
        try {
          const storeId = admitted.value.vaultStoreId;
          managerStoreScope = storeId
            ? NookManagerStoreScope.scoped(storeId)
            : NookManagerStoreScope.unscoped();
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
        try {
          const snapshot = $state.snapshot({
            providers: state.providers,
            activeVaultStoreId:
              state.activeVault.kind === ActiveVaultKind.Open
                ? activeVaultScope(state.activeVault.storeId)
                : unselectedVaultScope(),
          });
          try {
            return storageOk(
              update_provider_sync_metadata(
                snapshot,
                providerId,
                yaml,
                revision,
                managerStoreScope,
                isoTimestamp(),
              ),
            );
          } catch (failure) {
            return storageErr(new NativeVaultStorageFailure(failure));
          }
        } finally {
          managerStoreScope.free();
        }
      });
      if (updated.isErr()) return storageErr(updated.error);
      const persisted = await state.persistProviders({
        replace: false,
        providers: updated.value.providers,
      });
      if (persisted.isErr()) return storageErr(persisted.error);
      return storageOk();
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
    const removed = await state.removeProvider(providerId);
    if (removed.isErr()) {
      state.errorMsg = state.t(removed.error.translationKey);
      return;
    }
    state.clearLocalFolderMultipleVaultsIssue();
  }

  async chooseReplacementLocalFolderForIssue(): Promise<void> {
    const state = this.state;
    const health = state.localFolderHealth;
    if (health.state !== NookLocalFolderHealthState.MultipleVaults) return;
    const providerId = health.providerId;
    if (state.providers.some((provider) => provider.id === providerId)) {
      const removed = await state.removeProvider(providerId);
      if (removed.isErr()) {
        state.errorMsg = state.t(removed.error.translationKey);
        return;
      }
    }
    state.clearLocalFolderMultipleVaultsIssue();
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
  }: ProviderConflictPersistence): Promise<
    Result<string, StorageOperationFailure>
  > {
    const state = this.state;
    if (
      !conflict.isPendingProvider &&
      state.providers.some((provider) => provider.id === conflict.providerId)
    ) {
      return storageOk(conflict.providerId);
    }
    const saved = await state.ensureProviderSaved();
    if (saved.isErr()) return storageErr(saved.error);
    const [provider = state.providers[state.providers.length - 1]] = [
      state.syncProviders[state.syncProviders.length - 1],
    ];
    if (!provider || provider.type === LOCAL_PROVIDER_TYPE) {
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    }
    return storageOk(provider.id);
  }

  async stageStagedProviderSyncIssue({
    args,
  }: StagedProviderSyncIssueAssessment): Promise<
    Result<StagedProviderConflictOutcome, StorageOperationFailure>
  > {
    const state = this.state;
    const activeVault = state.activeVault;
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    let issueResult: ReturnType<typeof manager.value.take_event_log_sync_issue>;
    try {
      issueResult = manager.value.take_event_log_sync_issue();
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
    let issue: ReturnType<typeof issueResult.issue>;
    try {
      if (issueResult.state === NookEventLogSyncIssueState.Clear)
        return storageOk(StagedProviderConflictOutcome.NotStaged);
      issue = issueResult.issue();
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    } finally {
      issueResult.free();
    }
    try {
      let localStoreId: string;
      let remoteStoreId: string;
      try {
        if (!issue.isStoreMismatch)
          return storageOk(StagedProviderConflictOutcome.NotStaged);
        localStoreId = issue.localStoreId;
        remoteStoreId = issue.remoteStoreId;
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      let localYaml: string;
      try {
        localYaml = await read_local_vault_yaml();
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      const restored = await state.enqueueStorage(async () => {
        const current = state.admitManager();
        if (current.isErr()) return storageErr(current.error);
        if (
          current.value !== manager.value ||
          state.activeVault !== activeVault
        )
          return storageErr(
            new StorageOperationFailure(
              StorageOperationFailureKind.GenerationChanged,
            ),
          );
        try {
          await current.value.restore_local_after_provider_assessment();
          return storageOk();
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (restored.isErr()) return storageErr(restored.error);
      const current = state.admitManager();
      if (current.isErr()) return storageErr(current.error);
      if (current.value !== manager.value || state.activeVault !== activeVault)
        return storageErr(
          new StorageOperationFailure(
            StorageOperationFailureKind.GenerationChanged,
          ),
        );
      let revision: NookProviderSyncRevision;
      try {
        revision = NookProviderSyncRevision.untracked();
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      let conflict: NookPendingSyncConflict;
      try {
        conflict = NookPendingSyncConflict.pending_store_id(
          state.stagedProviderLabel(),
          localYaml,
          "",
          args.mode,
          args.pat,
          args.repo,
          revision,
          localStoreId,
          remoteStoreId,
        );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      } finally {
        revision.free();
      }
      state.stageSyncConflict(conflict);
      log.warn("staged provider store mismatch staged");
      return storageOk(StagedProviderConflictOutcome.Staged);
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
      void state
        .syncFromStorage(ProviderSyncFreshness.Scheduled)
        .then((synchronized) => {
          if (synchronized.isErr())
            state.errorMsg = state.t(synchronized.error.translationKey);
        });
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
        void state
          .syncFromStorage(ProviderSyncFreshness.Scheduled)
          .then((synchronized) => {
            if (synchronized.isErr())
              state.errorMsg = state.t(synchronized.error.translationKey);
          });
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

  async syncFromStorage({
    freshness,
  }: StorageSyncExecution): Promise<VaultSynchronizationResult> {
    const state = this.state;
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    let decision: VaultStorageSyncDecision;
    const remoteCredentials = state.hasRemoteCredentials();
    try {
      decision = state.clientPolicy.vault_storage_sync_decision(
        state.syncBlocked,
        freshness,
        state.isVerifying,
        state.isSaving,
        state.isPasswordBusy,
        state.isSyncing,
        state.isAuthenticated,
        state.syncProviders.length,
        remoteCredentials,
        state.localVaultPresent,
      );
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
    if (decision === VaultStorageSyncDecision.Skip)
      return storageOk(ProviderSyncOutcome.Skipped);
    if (decision === VaultStorageSyncDecision.SyncProviders) {
      return state.syncFromSyncProviders({
        visibility: ProviderSyncVisibility.Quiet,
        freshness,
      });
    }
    if (
      decision !== VaultStorageSyncDecision.SyncFirstProviderUnauthenticated
    ) {
      const tokens = await state.ensureOAuthTokensFresh();
      if (tokens.isErr()) return storageErr(tokens.error);
    }
    state.isSyncing = true;
    try {
      if (
        decision === VaultStorageSyncDecision.SyncFirstProviderUnauthenticated
      ) {
        const provider = state.syncProviders[0];
        if (!provider)
          return storageErr(
            new StorageOperationFailure(
              StorageOperationFailureKind.GenerationChanged,
            ),
          );
        if (provider.type === "local-folder") {
          const synchronized = await new ProviderSyncActions(
            state,
          ).syncLocalFolderProvider({ provider });
          if (synchronized.isErr()) return storageErr(synchronized.error);
        } else {
          const applied = await this.synchronizeStorage(
            state.providerWasmArgs(provider),
          );
          if (applied.isErr()) return storageErr(applied.error);
        }
      } else {
        const applied = await this.synchronizeStorage(state.wasmStorageArgs());
        if (applied.isErr()) return storageErr(applied.error);
      }
      const refreshed = await state.refreshSecretsFromSession();
      if (refreshed.isErr()) return storageErr(refreshed.error);
      state.markSynced(Date.now());
      return storageOk(ProviderSyncOutcome.Synced);
    } finally {
      state.isSyncing = false;
    }
  }

  private async synchronizeStorage({
    mode,
    pat,
    repo,
  }: NookStorageConnectArgs): Promise<Result<void, StorageOperationFailure>> {
    const state = this.state;
    const synchronized = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      return syncVaultFromStorage({ manager: manager.value, mode, pat, repo });
    });
    if (synchronized.isErr()) return storageErr(synchronized.error);
    return state.applyVaultSyncResult(synchronized.value);
  }

  private clearDeviceRoster(): void {
    const state = this.state;
    for (const join of state.pendingJoins) join.free();
    for (const member of state.vaultMembers) member.free();
    state.pendingJoins = [];
    state.vaultMembers = [];
  }

  async manualSync(): Promise<VaultSynchronizationResult> {
    const state = this.state;
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    if (state.syncBlocked || state.isSyncing)
      return storageOk(ProviderSyncOutcome.Skipped);
    let hasTarget: boolean;
    try {
      hasTarget = state.clientPolicy.manual_sync_has_target(
        state.localVaultPresent,
        state.syncProviders.length,
      );
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
    if (!hasTarget) {
      this.clearDeviceRoster();
      return storageOk(ProviderSyncOutcome.Skipped);
    }
    state.isSyncing = true;
    try {
      const initialized = await state.initDeviceIdentity();
      if (initialized.isErr()) return storageErr(initialized.error);
      if (state.syncProviders.length === 0) {
        if (state.hasRemoteCredentials()) {
          // Hand the synchronization lease to the storage operation before awaiting it.
          state.isSyncing = false;
          return await state.syncFromStorage(ProviderSyncFreshness.Forced);
        }
        this.clearDeviceRoster();
        return storageOk(ProviderSyncOutcome.Skipped);
      }
      const synchronized = await this.synchronizeProviders(
        ProviderSyncVisibility.Visible,
      );
      if (synchronized.isErr()) return synchronized;
      if (state.isAuthenticated) {
        const roster = await state.hydrateMultiDeviceState();
        if (roster.isErr()) return storageErr(roster.error);
      } else {
        this.clearDeviceRoster();
      }
      return synchronized;
    } finally {
      state.isSyncing = false;
    }
  }

  async fanOutSyncToProviders({
    visibility,
  }: FanOutSyncExecution): Promise<VaultSynchronizationResult> {
    const state = this.state;
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    if (
      !state.isAuthenticated ||
      state.syncBlocked ||
      state.syncProviders.length === 0
    )
      return storageOk(ProviderSyncOutcome.Skipped);
    const run = state.fanOutSyncChain.then(() =>
      state.runFanOutSyncToProviders(visibility),
    );
    // The shared promise is only a completion barrier; each caller receives its own outcome.
    state.fanOutSyncChain = run.then(() => {});
    return run;
  }

  stageSyncConflict({ conflict }: SyncConflictStaging) {
    const state = this.state;
    log.warn("sync conflict staged");
    state.stageSyncConflict(conflict);
    state.errorMsg = "";
  }
}
