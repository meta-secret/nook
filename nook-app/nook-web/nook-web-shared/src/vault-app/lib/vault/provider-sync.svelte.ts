import type { OAuthFailure } from '$lib/auth/oauth-failure'
import { err, ok, type Result } from 'neverthrow'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
  NativeVaultStorageFailure,
} from '$lib/runtime/storage-failure'
import { I18N_KEYS } from '../../../generated/i18n-keys'

/** Sync actions that snapshot reactive Svelte state at WASM boundaries. */
import type {
  ProviderSyncRequest,
  SyncActionsContext,
} from '$lib/vault/action-contexts'
import { browserLogRuntime } from '$lib/runtime/log'
import { syncVaultFromStorage } from '$lib/nook'
import {
  NookEventLogSyncIssueState,
  NookLocalFolderHealth,
  NookManualProviderSyncState,
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
  read_local_vault_yaml,
} from '$app-wasm'
import {
  LocalFolderPresentation,
  LocalFolderHandleKind,
  StorageProviderPresentation,
  LocalFolderProviderConfigurationKind,
  type StorageProvider,
} from '$lib/auth/providers'

const log = browserLogRuntime.createLogger('vault-sync')

interface ProviderStoreMismatchConflict {
  readonly provider: StorageProvider
  readonly localStoreId: string
  readonly remoteStoreId: string
}

interface LocalFolderProviderSync {
  readonly provider: StorageProvider
}

interface StagedLocalFolderMultipleVaultsIssue {
  readonly issue: NookLocalFolderHealth
}

type ProviderSyncExecution = ProviderSyncRequest & {}

export enum ProviderSyncOutcome {
  Synced = 'synced',
  Skipped = 'skipped',
  ConflictStaged = 'conflict-staged',
  FailureCaptured = 'failure-captured',
}

type ProviderFailurePresentation = {
  readonly provider: StorageProvider
  readonly visibility: ProviderSyncVisibility
  readonly failureHandling: ProviderSyncFailureHandling
  readonly failure: VaultStorageFailure
}

/** Owns provider synchronization and its visible or captured outcome. */
export class ProviderSyncActions {
  constructor(private readonly state: SyncActionsContext) {}

  private async stageProviderStoreMismatchConflict({
    provider,
    localStoreId,
    remoteStoreId,
  }: ProviderStoreMismatchConflict): Promise<Result<void, VaultStorageFailure>> {
    let localYaml: string
    try {
      localYaml = await read_local_vault_yaml()
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure))
    }
    const args =
      provider.type === 'local-folder'
        ? { mode: 'local-folder', pat: '', repo: '' }
        : this.state.providerWasmArgs(provider)
    const revision = NookProviderSyncRevision.untracked()
    try {
      let conflict: NookPendingSyncConflict
      try {
        conflict = NookPendingSyncConflict.store_id(
          provider.id,
          provider.label,
          localYaml,
          '',
          args.mode,
          args.pat,
          args.repo,
          revision,
          localStoreId,
          remoteStoreId,
        )
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure))
      }
      this.state.stageSyncConflict(conflict)
      return ok(undefined)
    } finally {
      revision.free()
    }
  }

  async syncLocalFolderProvider({
    provider,
  }: LocalFolderProviderSync): Promise<Result<void, VaultStorageFailure>> {
    const state = this.state
    const configuration = new StorageProviderPresentation(
      provider,
    ).localFolderProviderConfiguration()
    if (configuration.kind === LocalFolderProviderConfigurationKind.Missing)
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.LocalFolderUnavailable),
      )
    const handle = new LocalFolderPresentation(
      configuration.config,
    ).localFolderHandle()
    if (handle.kind === LocalFolderHandleKind.Unselected)
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.LocalFolderUnavailable),
      )
    const localYaml = await state.enqueueStorage(async () => {
      const admitted = state.admitManager()
      if (admitted.isErr()) return err(admitted.error)
      try {
        return ok(
          await admitted.value.sync_local_folder_provider_js(handle.handleId),
        )
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure))
      }
    })
    if (localYaml.isErr()) return err(localYaml.error)
    if (localYaml.value.trim()) {
      const revision = NookProviderSyncRevision.untracked()
      const metadata = await state.updateProviderSyncMetadata({
        providerId: provider.id,
        yaml: localYaml.value,
        revision,
      })
      if (metadata.isErr()) return err(metadata.error)
    }
    return ok(undefined)
  }

  private async presentFailure({
    provider,
    visibility,
    failureHandling,
    failure,
  }: ProviderFailurePresentation): Promise<
    Result<ProviderSyncOutcome, VaultStorageFailure>
  > {
    const state = this.state
    log.warn('provider synchronization failed')
    const admitted = state.admitManager()
    if (admitted.isErr()) return err(admitted.error)
    let issueResult: ReturnType<typeof admitted.value.take_event_log_sync_issue>
    try {
      issueResult = admitted.value.take_event_log_sync_issue()
    } catch (nativeFailure) {
      return err(new NativeVaultStorageFailure(nativeFailure))
    }
    let disposition = ProviderSyncOutcome.FailureCaptured
    try {
      if (issueResult.state === NookEventLogSyncIssueState.Pending) {
        const issue = issueResult.issue()
        try {
          if (issue.isStoreMismatch) {
            const staged = await this.stageProviderStoreMismatchConflict({
              provider,
              localStoreId: issue.localStoreId,
              remoteStoreId: issue.remoteStoreId,
            })
            if (staged.isErr()) return err(staged.error)
            disposition = ProviderSyncOutcome.ConflictStaged
            if (visibility === ProviderSyncVisibility.Visible)
              state.errorMsg = state.t({
                key: I18N_KEYS.AuthStorageSyncConflictStoreIdBanner,
                replacements: { provider: provider.label },
              })
          } else if (issue.isMultipleStores && provider.type === 'local-folder') {
            let health: NookLocalFolderHealth
            const message = state.t(failure.translationKey)
            try {
              health = NookLocalFolderHealth.multiple_vaults(
                provider.id,
                provider.label,
                issue.storeIds,
                message,
              )
            } catch (nativeFailure) {
              return err(new NativeVaultStorageFailure(nativeFailure))
            }
            state.reportLocalFolderMultipleVaults(health)
            if (visibility === ProviderSyncVisibility.Visible)
              state.errorMsg = state.t(
                I18N_KEYS.AuthStorageLocalFolderMultipleVaultsShort,
              )
          }
        } finally {
          issue.free()
        }
      }
    } finally {
      issueResult.free()
    }
    if (disposition === ProviderSyncOutcome.ConflictStaged) return ok(disposition)
    if (visibility === ProviderSyncVisibility.Visible && !state.errorMsg)
      state.errorMsg = state.t(failure.translationKey)
    return failureHandling === ProviderSyncFailureHandling.Propagate
      ? err(failure)
      : ok(ProviderSyncOutcome.FailureCaptured)
  }

  async syncProviderById({
    providerId,
    visibility,
    failureHandling,
  }: ProviderSyncExecution): Promise<
    Result<ProviderSyncOutcome, VaultStorageFailure | OAuthFailure>
  > {
    const state = this.state
    if (!state.hasManager)
      return err(new VaultStorageFailure(VaultStorageFailureKind.ManagerUnavailable))
    if (state.syncBlocked || state.isPasswordBusy || state.isSaving)
      return ok(ProviderSyncOutcome.Skipped)
    const provider = state.providers.find((entry) => entry.id === providerId)
    if (!provider || provider.type === 'local')
      return ok(ProviderSyncOutcome.Skipped)
    if (
      state.manualProviderSync.state === NookManualProviderSyncState.Running &&
      state.manualProviderSync.providerId !== providerId
    )
      return ok(ProviderSyncOutcome.Skipped)
    state.beginManualProviderSync(providerId)
    if (visibility === ProviderSyncVisibility.Visible) state.errorMsg = ''
    try {
      if (provider.type === 'local-folder') {
        const synced = await this.syncLocalFolderProvider({ provider })
        if (synced.isErr())
          return await this.presentFailure({
            provider,
            visibility,
            failureHandling,
            failure: synced.error,
          })
      } else {
        const { mode, pat, repo } = state.providerWasmArgs(provider)
        const synced = await state.enqueueStorage(async () => {
          const admitted = state.admitManager()
          if (admitted.isErr()) return err(admitted.error)
          return state.raceStorageTimeout({
            promise: syncVaultFromStorage({
              manager: admitted.value,
              mode,
              pat,
              repo,
            }),
            releaseLateValue: (result) => result.free(),
          })
        })
        if (synced.isErr())
          return await this.presentFailure({
            provider,
            visibility,
            failureHandling,
            failure: synced.error,
          })
        const applied = state.applyVaultSyncResult(synced.value)
        if (applied.isErr())
          return this.presentFailure({
            provider,
            visibility,
            failureHandling,
            failure: applied.error,
          })
        let yaml: string
        try {
          yaml = await read_local_vault_yaml()
        } catch (failure) {
          return await this.presentFailure({
            provider,
            visibility,
            failureHandling,
            failure: new NativeVaultStorageFailure(failure),
          })
        }
        const metadata = await state.updateProviderSyncMetadata({
          providerId,
          yaml,
          revision: NookProviderSyncRevision.untracked(),
        })
        if (metadata.isErr())
          return await this.presentFailure({
            provider,
            visibility,
            failureHandling,
            failure: metadata.error,
          })
      }
      const secretRefresh1 = await state.refreshSecretsFromSession()
      if (secretRefresh1.isErr()) {
        return err(secretRefresh1.error)
      }
      const conflicts = await state.refreshReplacementConflicts()
      if (conflicts.isErr()) {
        return err(conflicts.error)
      }
      if (state.isAuthenticated) {
        const roster = await state.hydrateMultiDeviceState()
        if (roster.isErr()) return err(roster.error)
      }
      log.debug('provider sync finished')
      return ok(ProviderSyncOutcome.Synced)
    } finally {
      if (
        state.manualProviderSync.state === NookManualProviderSyncState.Running &&
        state.manualProviderSync.providerId === providerId
      )
        state.clearSyncingProvider()
    }
  }
}
