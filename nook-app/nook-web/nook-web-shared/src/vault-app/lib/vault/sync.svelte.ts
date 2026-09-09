import type { OAuthFailure } from '$lib/auth/oauth-failure'
import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk, type Result } from 'neverthrow'
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from '$lib/runtime/storage-failure'

/** Sync actions that snapshot reactive Svelte state at WASM boundaries. */
import type {
  ProviderSyncRequest,
  SyncActionsContext,
  SyncFromProvidersRequest,
  VaultStorageArguments,
} from '$lib/vault/action-contexts'
import { browserLogRuntime } from '$lib/runtime/log'
import { isoTimestamp, syncVaultFromStorage, type JoinRequest } from '$lib/nook'
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
} from '$app-wasm'
import {
  activeVaultScope,
  LOCAL_FOLDER_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  unselectedVaultScope,
} from '$lib/auth/providers'
import {
  ProviderEventOutbox,
  EventOutboxRequestKind,
  EventOutboxTargetKind,
  type EventOutboxRequest,
  type EventOutboxTarget,
} from '$lib/vault/sync-operation-state'
import { AdminAccordionSection } from '$lib/vault/state/ui.svelte'
import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
import { VaultSyncRuntimeActions } from '$lib/vault/sync-runtime'
import { ExtensionSyncPublication } from '$lib/vault/sync-extension-bridge'
import { ProviderSyncActions } from '$lib/vault/provider-sync.svelte'

export { VaultSyncRuntimeActions } from '$lib/vault/sync-runtime'

export { ExtensionSyncPublication }

export * from '$lib/vault/sync-resolution'

export { SyncConflictPresentation } from '$lib/vault/sync-conflict-label'

const log = browserLogRuntime.createLogger('vault-sync')

interface EventOutboxTargetSelection {
  readonly request: EventOutboxRequest
}

interface RemoteEventOutboxFlush {
  readonly request: EventOutboxRequest
}

interface ProviderSyncMetadataUpdate {
  readonly providerId: string
  readonly yaml: string
  readonly revision: NookProviderSyncRevision
}

interface StagedProviderConflictCompletion {
  readonly conflict: NookSyncConflictReview
}

interface ProviderConflictPersistence {
  readonly conflict: NookSyncConflictReview
}

interface StagedProviderSyncIssueAssessment {
  readonly args: VaultStorageArguments
}

interface SyncConflictStaging {
  readonly conflict: NookPendingSyncConflict
}

type SyncFromProvidersExecution = SyncFromProvidersRequest & {}

type FanOutSyncExecution = {
  readonly visibility: ProviderSyncVisibility
}

type StorageSyncExecution = {
  readonly freshness: ProviderSyncFreshness
}

export { ProviderSyncActions } from '$lib/vault/provider-sync.svelte'

export type RosterHydrationResult = Result<
  void,
  StorageOperationFailure | OAuthFailure
>

/** Owns browser orchestration for one sync.svelte context. */
export class VaultSyncActions {
  constructor(private readonly state: SyncActionsContext) {}

  async hydrateMultiDeviceState(): Promise<RosterHydrationResult> {
    const state = this.state
    if (!state.hasManager || !state.isAuthenticated) return storageOk(undefined)
    const mergedJoins: JoinRequest[] = []
    try {
      for (const provider of state.syncProviders) {
        if (provider.type === LOCAL_FOLDER_PROVIDER_TYPE) {
          const synced = await new ProviderSyncActions(
            state,
          ).syncLocalFolderProvider({ provider })
          if (synced.isErr()) {
            return storageErr(synced.error)
          }
          continue
        }
        const { mode, pat, repo } = state.providerWasmArgs(provider)
        const joins = await state.enqueueStorage(async () => {
          const admitted = state.admitManager()
          if (admitted.isErr()) return storageErr(admitted.error)
          try {
            return storageOk(
              await admitted.value.merge_remote_joins_from_provider(mode, pat, repo),
            )
          } catch (failure) {
            return storageErr(new NativeVaultStorageFailure(failure))
          }
        })
        if (joins.isErr()) {
          return storageErr(joins.error)
        }
        mergedJoins.push(...joins.value)
      }
      const snapshot = await state.enqueueStorage(async () => {
        const admitted = state.admitManager()
        if (admitted.isErr()) return storageErr(admitted.error)
        try {
          await admitted.value.ensure_vault_roster_hydrated_js()
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure))
        }
        let pendingJoins: JoinRequest[]
        try {
          pendingJoins = admitted.value.list_pending_joins()
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure))
        }
        try {
          return storageOk({
            pendingJoins,
            vaultMembers: admitted.value.list_vault_members(),
          })
        } catch (failure) {
          for (const join of pendingJoins) join.free()
          return storageErr(new NativeVaultStorageFailure(failure))
        }
      })
      if (snapshot.isErr()) {
        return storageErr(snapshot.error)
      }
      for (const join of state.pendingJoins) join.free()
      for (const member of state.vaultMembers) member.free()
      state.pendingJoins =
        snapshot.value.pendingJoins.length > 0
          ? snapshot.value.pendingJoins
          : mergedJoins.splice(0)
      state.vaultMembers = snapshot.value.vaultMembers
      const passwordRefresh1 = await state.refreshPasswordEntriesList()
      if (passwordRefresh1.isErr()) {
        return storageErr(passwordRefresh1.error)
      }
      return storageOk(undefined)
    } finally {
      for (const join of mergedJoins) join.free()
    }
  }

  async syncFromSyncProviders({
    visibility,
    freshness,
  }: SyncFromProvidersExecution): Promise<void> {
    const state = this.state
    if (!state.hasManager) return
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
      return
    }

    state.isSyncing = true
    let syncOutcome = ProviderSyncOutcome.Synced
    try {
      for (const provider of state.syncProviders) {
        if (state.syncBlocked) {
          syncOutcome = ProviderSyncOutcome.Skipped
          break
        }
        const syncProviderByIdArgs: ProviderSyncRequest = {
          providerId: provider.id,
          visibility,
          failureHandling: ProviderSyncFailureHandling.Capture,
        }
        const providerSync = await state.syncProviderById(syncProviderByIdArgs)
        if (providerSync.isErr()) {
          syncOutcome = ProviderSyncOutcome.FailureCaptured
          log.warn('provider sync admission failed')
        } else if (providerSync.value !== ProviderSyncOutcome.Synced) {
          syncOutcome = providerSync.value
        }
      }
      if (state.isAuthenticated) {
        const rosterRefresh1 = await this.hydrateMultiDeviceState()
        if (rosterRefresh1.isErr()) {
          state.errorMsg = state.t(rosterRefresh1.error.translationKey)
          return
        }
      }
      await new ExtensionSyncPublication(
        state,
      ).publishExtensionEventLogUpdateForVault()
      if (syncOutcome === ProviderSyncOutcome.Synced) state.markSynced(Date.now())
    } catch {
      // Background sync should not interrupt the UI.
    } finally {
      state.isSyncing = false
    }
  }

  async runFanOutSyncToProviders({
    visibility,
  }: FanOutSyncExecution): Promise<void> {
    const state = this.state
    if (state.isFanOutSyncing) return
    state.isFanOutSyncing = true
    try {
      for (const provider of state.syncProviders) {
        if (state.syncBlocked) break
        const syncProviderByIdArgs2: ProviderSyncRequest = {
          providerId: provider.id,
          visibility,
          failureHandling: ProviderSyncFailureHandling.Capture,
        }
        const providerSync = await state.syncProviderById(syncProviderByIdArgs2)
        if (
          providerSync.isErr() ||
          providerSync.value === ProviderSyncOutcome.FailureCaptured
        )
          log.warn('provider sync did not complete')
      }
    } finally {
      state.isFanOutSyncing = false
    }
  }

  async runFanOutSyncAfterLocalSave(): Promise<void> {
    const state = this.state
    await new ExtensionSyncPublication(
      state,
    ).publishExtensionEventLogUpdateForVault()
    if (!state.deviceProtectionReady) return
    if (state.syncProviders.length === 0) {
      const request: EventOutboxRequest = {
        kind: EventOutboxRequestKind.Default,
      }
      await state.flushRemoteEventOutboxNow(request)
      return
    }
    for (const provider of state.syncProviders) {
      if (state.syncBlocked) break
      const request = new ProviderEventOutbox(provider).request()
      await state.flushRemoteEventOutboxNow(request)
    }
  }

  eventOutboxTarget({ request }: EventOutboxTargetSelection): EventOutboxTarget {
    const state = this.state
    if (request.kind === EventOutboxRequestKind.LocalFolder) {
      return {
        kind: EventOutboxTargetKind.LocalFolder,
        provider: request.provider,
      }
    }
    if (request.kind === EventOutboxRequestKind.Remote) {
      return {
        kind: EventOutboxTargetKind.Remote,
        args: state.providerWasmArgs(request.provider),
      }
    }
    if (state.syncProviders[0]?.type === LOCAL_FOLDER_PROVIDER_TYPE) {
      return {
        kind: EventOutboxTargetKind.LocalFolder,
        provider: state.syncProviders[0],
      }
    }
    if (state.syncProviders.length > 0) {
      return {
        kind: EventOutboxTargetKind.Remote,
        args: state.providerWasmArgs(state.syncProviders[0]!),
      }
    }
    return state.hasRemoteCredentials()
      ? {
          kind: EventOutboxTargetKind.Remote,
          args: state.wasmStorageArgs(),
        }
      : { kind: EventOutboxTargetKind.Unavailable }
  }

  async flushRemoteEventOutboxNow({
    request,
  }: RemoteEventOutboxFlush): Promise<void> {
    const state = this.state
    if (!state.hasManager) return
    const target = this.eventOutboxTarget({ request })
    if (target.kind === EventOutboxTargetKind.LocalFolder) {
      const synced = await new ProviderSyncActions(state).syncLocalFolderProvider({
        provider: target.provider,
      })
      if (synced.isErr()) log.warn('local backup sync skipped')
      return
    }
    if (target.kind === EventOutboxTargetKind.Unavailable) return
    const flushed = await state.enqueueStorage(async () => {
      const admitted = state.admitManager()
      if (admitted.isErr()) return storageErr(admitted.error)
      try {
        await admitted.value.flush_event_outbox_for_provider(
          target.args.mode,
          target.args.pat,
          target.args.repo,
        )
        return storageOk(undefined)
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure))
      }
    })
    if (flushed.isErr()) log.warn('event outbox flush skipped')
  }

  async updateProviderSyncMetadata({
    providerId,
    yaml,
    revision,
  }: ProviderSyncMetadataUpdate): Promise<Result<void, StorageOperationFailure>> {
    const state = this.state
    try {
      const updated = await state.enqueueStorage(() => {
        const admitted = state.admitManager()
        if (admitted.isErr()) return storageErr(admitted.error)
        let managerStoreScope: NookManagerStoreScope
        try {
          const storeId = admitted.value.vaultStoreId
          managerStoreScope = storeId
            ? NookManagerStoreScope.scoped(storeId)
            : NookManagerStoreScope.unscoped()
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure))
        }
        try {
          const snapshot = $state.snapshot({
            providers: state.providers,
            activeVaultStoreId:
              state.activeVault.kind === ActiveVaultKind.Open
                ? activeVaultScope(state.activeVault.storeId)
                : unselectedVaultScope(),
          })
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
            )
          } catch (failure) {
            return storageErr(new NativeVaultStorageFailure(failure))
          }
        } finally {
          managerStoreScope.free()
        }
      })
      if (updated.isErr()) return storageErr(updated.error)
      const persisted = await state.persistProviders({
        replace: false,
        providers: updated.value.providers,
      })
      if (persisted.isErr()) return storageErr(persisted.error)
      return storageOk(undefined)
    } finally {
      revision.free()
    }
  }

  dismissLocalFolderMultipleVaultsIssue(): void {
    const state = this.state
    state.clearLocalFolderMultipleVaultsIssue()
  }

  async disconnectLocalFolderMultipleVaultsProvider(): Promise<void> {
    const state = this.state
    const health = state.localFolderHealth
    if (health.state !== NookLocalFolderHealthState.MultipleVaults) return
    const providerId = health.providerId
    state.clearLocalFolderMultipleVaultsIssue()
    await state.removeProvider(providerId)
  }

  async chooseReplacementLocalFolderForIssue(): Promise<void> {
    const state = this.state
    const health = state.localFolderHealth
    if (health.state !== NookLocalFolderHealthState.MultipleVaults) return
    const providerId = health.providerId
    state.clearLocalFolderMultipleVaultsIssue()
    if (state.providers.some((provider) => provider.id === providerId)) {
      await state.removeProvider(providerId)
    }
    state.errorMsg = ''
    state.openAdmin(AdminAccordionSection.Storage)
    state.beginAddProvider()
    const setupRequest: Parameters<typeof state.beginProviderSetup>[0] = {
      type: LOCAL_FOLDER_PROVIDER_TYPE,
    }
    state.beginProviderSetup(setupRequest)
  }

  finishStagedProviderConnectAfterConflict({
    conflict,
  }: StagedProviderConflictCompletion): void {
    const state = this.state
    if (!conflict.isPendingProvider) return
    state.clearLoginSetup()
    state.addProviderOpen = false
  }

  async ensureProviderSavedAfterConflict({
    conflict,
  }: ProviderConflictPersistence): Promise<Result<string, StorageOperationFailure>> {
    const state = this.state
    if (
      !conflict.isPendingProvider &&
      state.providers.some((provider) => provider.id === conflict.providerId)
    ) {
      return storageOk(conflict.providerId)
    }
    const saved = await state.ensureProviderSaved()
    if (saved.isErr()) return storageErr(saved.error)
    const [provider = state.providers[state.providers.length - 1]] = [
      state.syncProviders[state.syncProviders.length - 1],
    ]
    if (!provider || provider.type === LOCAL_PROVIDER_TYPE) {
      return storageErr(
        new StorageOperationFailure(StorageOperationFailureKind.OperationFailed),
      )
    }
    return storageOk(provider.id)
  }

  async stageStagedProviderSyncIssue({
    args,
  }: StagedProviderSyncIssueAssessment): Promise<boolean> {
    const state = this.state
    if (!state.hasManager) return false
    const manager = state.requireManager()
    const issueResult = manager.take_event_log_sync_issue()
    if (issueResult.state === NookEventLogSyncIssueState.Clear) {
      issueResult.free()
      return false
    }
    const issue = issueResult.issue()
    issueResult.free()
    try {
      if (!issue.isStoreMismatch) return false
      const localStoreId = issue.localStoreId
      const remoteStoreId = issue.remoteStoreId

      let localYaml: string
      try {
        localYaml = await read_local_vault_yaml()
      } catch (failure) {
        state.errorMsg = state.t(
          new NativeVaultStorageFailure(failure).translationKey,
        )
        return false
      }
      const restored = await state.enqueueStorage(async () => {
        try {
          await manager.restore_local_after_provider_assessment()
          return storageOk(undefined)
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure))
        }
      })
      if (restored.isErr()) {
        state.errorMsg = state.t(restored.error.translationKey)
        return false
      }
      const revision = NookProviderSyncRevision.untracked()
      try {
        state.stageSyncConflict(
          NookPendingSyncConflict.pending_store_id(
            state.stagedProviderLabel(),
            localYaml,
            '',
            args.mode,
            args.pat,
            args.repo,
            revision,
            localStoreId,
            remoteStoreId,
          ),
        )
      } finally {
        revision.free()
      }
      log.warn('staged provider store mismatch staged')
      return true
    } finally {
      issue.free()
    }
  }

  startVaultSync() {
    const state = this.state
    state.stopVaultSync()
    const startDecision = state.clientPolicy.vault_sync_timer_start_decision(
      state.isAuthenticated,
      state.deviceProtectionReady,
      state.joinEnrollmentPrompt,
      state.awaitingJoinApproval,
    )
    switch (startDecision) {
      case VaultSyncTimerStartDecision.SkipDeviceProtectionLocked:
        log.debug('vault sync timer skipped (device identity locked)')
        return
      case VaultSyncTimerStartDecision.SkipNoRemoteUpdates:
        log.debug('vault sync timer skipped (no remote updates needed)')
        return
      case VaultSyncTimerStartDecision.Start:
        break
    }
    const syncIntervalConfig = import.meta.env.VITE_VAULT_SYNC_INTERVAL_MS
    const intervalMs =
      typeof syncIntervalConfig === 'string'
        ? state.runtimeConfig.resolve_vault_sync_interval_ms(syncIntervalConfig)
        : state.runtimeConfig.resolve_default_vault_sync_interval_ms()
    log.info('vault sync timer started')
    if (state.isAuthenticated) {
      void state.syncFromStorage(ProviderSyncFreshness.Scheduled)
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
        )
        if (tickDecision !== VaultSyncTimerTickDecision.Sync) {
          return
        }
        void state.syncFromStorage(ProviderSyncFreshness.Scheduled)
      },
      intervalMs,
    }
    state.scheduleSync(scheduleSyncArgs)
  }

  stopVaultSync() {
    const state = this.state
    if (state.stopScheduledSync()) {
      log.debug('vault sync timer stopped')
    }
  }

  async syncFromStorage({ freshness }: StorageSyncExecution) {
    const state = this.state
    if (!state.hasManager) return
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
    )
    if (syncDecision === VaultStorageSyncDecision.Skip) return

    if (syncDecision === VaultStorageSyncDecision.SyncFirstProviderUnauthenticated) {
      state.isSyncing = true
      try {
        const provider = state.syncProviders[0]!
        if (provider.type === 'local-folder') {
          const syncLocalFolderProviderArgs3: Parameters<
            ProviderSyncActions['syncLocalFolderProvider']
          >[0] = { provider }
          const synced = await new ProviderSyncActions(
            state,
          ).syncLocalFolderProvider(syncLocalFolderProviderArgs3)
          if (synced.isErr()) {
            log.warn('local backup sync failed')
            return
          }
        } else {
          const { mode, pat, repo } = state.providerWasmArgs(provider)
          const raw = await state.enqueueStorage(async () => {
            const admitted = state.admitManager()
            if (admitted.isErr()) return storageErr(admitted.error)
            return syncVaultFromStorage({ manager: admitted.value, mode, pat, repo })
          })
          if (raw.isErr()) {
            log.warn('provider sync failed')
            return
          }
          state.applyVaultSyncResult(raw.value)
        }
        const secretRefresh1 = await state.refreshSecretsFromSession()
        if (secretRefresh1.isErr()) {
          state.errorMsg = state.t(secretRefresh1.error.translationKey)
          return
        }
        state.markSynced(Date.now())
      } catch (error) {
        const syncErrorArgs: Parameters<VaultSyncRuntimeActions['syncError']>[0] = {
          context: 'background sync (unauthenticated)',
          failure: browserLogRuntime.runtimeFailure(error),
        }
        new VaultSyncRuntimeActions(state).syncError(syncErrorArgs)
      } finally {
        state.isSyncing = false
      }
      return
    }

    if (syncDecision === VaultStorageSyncDecision.SyncProviders) {
      const syncFromSyncProvidersArgs: SyncFromProvidersRequest = {
        visibility: ProviderSyncVisibility.Quiet,
        freshness,
      }
      await state.syncFromSyncProviders(syncFromSyncProvidersArgs)
      return
    }

    const refreshedTokens = await state.ensureOAuthTokensFresh()
    if (refreshedTokens.isErr()) {
      state.errorMsg = state.t(refreshedTokens.error.translationKey)
      return
    }

    state.isSyncing = true
    try {
      const { mode, pat, repo } = state.wasmStorageArgs()
      const raw = await state.enqueueStorage(async () => {
        const admitted = state.admitManager()
        if (admitted.isErr()) return storageErr(admitted.error)
        return syncVaultFromStorage({ manager: admitted.value, mode, pat, repo })
      })
      if (raw.isErr()) {
        log.warn('storage sync failed')
        return
      }
      state.applyVaultSyncResult(raw.value)
      const secretRefresh2 = await state.refreshSecretsFromSession()
      if (secretRefresh2.isErr()) {
        state.errorMsg = state.t(secretRefresh2.error.translationKey)
        return
      }
      state.markSynced(Date.now())
    } catch (error) {
      const syncErrorArgs2: Parameters<VaultSyncRuntimeActions['syncError']>[0] = {
        context: 'background sync',
        failure: browserLogRuntime.runtimeFailure(error),
      }
      new VaultSyncRuntimeActions(state).syncError(syncErrorArgs2)
    } finally {
      state.isSyncing = false
    }
  }

  async manualSync() {
    const state = this.state
    if (!state.hasManager) return
    if (state.syncBlocked) return
    if (state.isSyncing) return

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
      state.pendingJoins = []
      state.vaultMembers = []
      return
    }
    log.info('manual sync started')
    state.isSyncing = true
    try {
      const identityInitialization = await state.initDeviceIdentity()
      if (identityInitialization.isErr()) {
        state.errorMsg = state.t(identityInitialization.error.translationKey)
        return
      }
      if (state.syncProviders.length === 0) {
        if (state.hasRemoteCredentials()) {
          await state.syncFromStorage(ProviderSyncFreshness.Forced)
        } else {
          state.pendingJoins = []
          state.vaultMembers = []
        }
        return
      }
      for (const provider of state.syncProviders) {
        const syncRequest: ProviderSyncRequest = {
          providerId: provider.id,
          visibility: ProviderSyncVisibility.Visible,
          failureHandling: ProviderSyncFailureHandling.Capture,
        }
        const providerSync = await state.syncProviderById(syncRequest)
        if (
          providerSync.isErr() ||
          providerSync.value === ProviderSyncOutcome.FailureCaptured
        )
          log.warn('provider sync did not complete')
      }
      if (state.isAuthenticated) {
        const rosterRefresh2 = await state.hydrateMultiDeviceState()
        if (rosterRefresh2.isErr()) {
          state.errorMsg = state.t(rosterRefresh2.error.translationKey)
          return
        }
      } else {
        state.pendingJoins = []
        state.vaultMembers = []
      }
    } catch (error) {
      const syncErrorArgs3: Parameters<VaultSyncRuntimeActions['syncError']>[0] = {
        context: 'manual sync',
        failure: browserLogRuntime.runtimeFailure(error),
      }
      new VaultSyncRuntimeActions(state).syncError(syncErrorArgs3)
    } finally {
      state.isSyncing = false
      log.debug('manual sync finished')
    }
  }

  async fanOutSyncToProviders({ visibility }: FanOutSyncExecution): Promise<void> {
    const state = this.state
    if (!state.hasManager || !state.isAuthenticated) return
    if (state.syncBlocked) return
    if (state.syncProviders.length === 0) return
    log.debug('fan-out sync queued')
    const run = state.fanOutSyncChain.then(() =>
      state.runFanOutSyncToProviders(visibility),
    )
    state.fanOutSyncChain = run.catch(() => {})
    return run
  }

  stageSyncConflict({ conflict }: SyncConflictStaging) {
    const state = this.state
    log.warn('sync conflict staged')
    state.stageSyncConflict(conflict)
    state.errorMsg = ''
  }
}
