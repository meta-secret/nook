import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk } from 'neverthrow'

import { I18N_KEYS } from '../../../generated/i18n-keys'
import type { SyncActionsContext } from '$lib/vault/action-contexts'
import {
  import_named_local_vault_blob,
  DeviceProtectionStatus,
  NookSyncConflictReviewState,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
  RemoteVaultRecoveryState,
  set_active_vault,
  set_vault_session_locked,
  type NookReplacementConflict,
  type NookSecurityConflict,
  VaultSyncConflictKind,
} from '$app-wasm'
import { browserLogRuntime } from '$lib/runtime/log'
import { LoginSetupKind } from '$lib/vault/state/provider.svelte'
import {
  ConflictProviderSaveKind,
  type ConflictProviderSave,
} from '$lib/vault/sync-operation-state'
import { StagedRemoteStorageKind } from '$lib/vault/state/provider.svelte'
import {
  LocalFolderPresentation,
  LocalFolderHandleKind,
  StorageProviderPresentation,
  LocalFolderProviderConfigurationKind,
  scopedProviderVault,
} from '$lib/auth/providers'
import { LoginUnlockPresentation } from '$lib/vault/login-unlock-capabilities'
import {
  ProviderVaultIdentitySelectionKind,
  type ProviderVaultIdentitySelection,
} from '$lib/vault/provider-vault-decision'

const log = browserLogRuntime.createLogger('vault-sync-resolution')

export interface ReplacementConflictResolution {
  readonly oldSecretId: string
  readonly chosenSecretId: string
}

interface SyncConflictResumption {
  readonly providerId: string
  readonly pendingProvider: boolean
}

export interface ProviderVaultImportRequest {
  readonly identitySelection: ProviderVaultIdentitySelection
}

interface ImportedProviderVaultIdentityActivation {
  readonly identityId: string
  readonly importedStoreId: string
}

enum ProviderVaultImportOutcomeKind {
  NotImported = 'not-imported',
  Imported = 'imported',
}

type ProviderVaultImportOutcome =
  | { readonly kind: ProviderVaultImportOutcomeKind.NotImported }
  | {
      readonly kind: ProviderVaultImportOutcomeKind.Imported
      readonly storeId: string
    }

/** Owns browser orchestration for one sync resolution context. */
export class SyncConflictActions {
  constructor(private readonly state: SyncActionsContext) {}

  async activateImportedProviderVaultIdentity({
    identityId,
    importedStoreId,
  }: ImportedProviderVaultIdentityActivation): Promise<void> {
    const state = this.state
    try {
      const completed = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.activate_local_identity(identityId),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (completed.isErr()) {
        state.errorMsg = state.t(completed.error.translationKey)
        return
      }
    } catch {
      state.errorMsg = state.t(
        I18N_KEYS.AuthStorageProviderVaultIdentitySelectionFailed,
      )
      return
    }
    state.deviceProtectionStatus = DeviceProtectionStatus.Loading
    state.deviceId = ''
    state.devicePublicKey = ''
    state.clearIdentityProviderSession()
    state.selectLoginVault(importedStoreId)
    try {
      const protectionStatus = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(await admittedManager.value.device_protection_status())
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (protectionStatus.isErr()) {
        state.deviceProtectionStatus = DeviceProtectionStatus.Error
        state.errorMsg = state.t(protectionStatus.error.translationKey)
        return
      }
      state.deviceProtectionStatus = protectionStatus.value
      if (
        protectionStatus.value === DeviceProtectionStatus.Pin ||
        protectionStatus.value === DeviceProtectionStatus.Passkey
      ) {
        state.deviceProtectionLockedStatus = protectionStatus.value
      }
    } catch {
      state.deviceProtectionStatus = DeviceProtectionStatus.Error
      state.errorMsg = state.t(
        I18N_KEYS.AuthStorageProviderVaultIdentitySelectionFailed,
      )
    }
  }

  async resolveReplacementConflict({
    oldSecretId,
    chosenSecretId,
  }: ReplacementConflictResolution): Promise<void> {
    const state = this.state
    if (!state.hasManager || state.isSaving) return
    state.isSaving = true
    state.errorMsg = ''
    try {
      const raw = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.resolve_projection_conflict(
              oldSecretId,
              chosenSecretId,
            ),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (raw.isErr()) {
        state.errorMsg = state.t(raw.error.translationKey)
        return
      }
      for (const record of raw.value) record.free()
      const secretRefresh1 = await state.refreshSecretsFromSession()
      if (secretRefresh1.isErr()) {
        state.errorMsg = state.t(secretRefresh1.error.translationKey)
        return
      }
      const conflicts = await state.refreshReplacementConflicts()
      if (conflicts.isErr()) {
        state.errorMsg = state.t(conflicts.error.translationKey)
        return
      }
      void state.runFanOutSyncAfterLocalSave()
      state.showSuccess(state.t(I18N_KEYS.ToastsSecretConflictResolved))
    } catch (error) {
      state.errorMsg =
        error instanceof Error
          ? error.message
          : state.t(I18N_KEYS.ErrorsConflictResolutionFailed)
    } finally {
      state.isSaving = false
    }
  }

  async refreshReplacementConflicts() {
    const state = this.state
    if (!state.hasManager) {
      state.clearProjectionConflicts()
      return storageOk(undefined)
    }
    const snapshot = await state.enqueueStorage(async () => {
      const manager = state.admitManager()
      if (manager.isErr()) return storageErr(manager.error)
      let conflicts: NookReplacementConflict[] = []
      try {
        if (!manager.value.event_log_mode())
          return storageOk({
            replacementConflicts: conflicts,
            securityConflicts: [] as NookSecurityConflict[],
          })
        conflicts = await manager.value.list_projection_conflicts()
        const securityConflicts =
          await manager.value.list_projection_security_conflicts()
        return storageOk({ replacementConflicts: conflicts, securityConflicts })
      } catch (failure) {
        for (const conflict of conflicts) conflict.free()
        return storageErr(new NativeVaultStorageFailure(failure))
      }
    })
    if (snapshot.isErr()) return storageErr(snapshot.error)
    state.replaceProjectionConflicts(snapshot.value)
    return storageOk(undefined)
  }

  async resolveSyncConflictKeepLocal(): Promise<void> {
    const state = this.state
    const review = state.syncConflictReview
    if (
      review.state !== NookSyncConflictReviewState.RequiresDecision ||
      state.isVerifying
    )
      return
    state.isVerifying = true
    state.errorMsg = ''
    log.info('sync conflict resolved (keep local)')
    state.errorMsg = state.t(I18N_KEYS.ErrorsWholeVaultConflictResolutionRetired)
    state.isVerifying = false
  }

  async resolveSyncConflictKeepRemote(): Promise<void> {
    const state = this.state
    const review = state.syncConflictReview
    if (
      review.state !== NookSyncConflictReviewState.RequiresDecision ||
      state.isVerifying
    )
      return
    log.info('sync conflict resolved (keep remote)')
    state.errorMsg = state.t(I18N_KEYS.ErrorsWholeVaultConflictResolutionRetired)
    state.isVerifying = false
  }

  async confirmRecoverRemoteVault(): Promise<void> {
    const state = this.state
    if (!state.hasManager) return
    state.errorMsg = ''
    state.isVerifying = true
    try {
      const completed = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.prepare_connect_from_local_cache(),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (completed.isErr()) {
        state.errorMsg = state.t(completed.error.translationKey)
        return
      }
      state.remoteVaultRecoveryState = RemoteVaultRecoveryState.ConnectFromCache
      if (state.loginSetup.kind === LoginSetupKind.Active) {
        await state.loadDb()
        return
      }
      const passwordRefresh1 = await state.refreshPasswordEntriesList()
      if (passwordRefresh1.isErr()) {
        state.errorMsg = state.t(passwordRefresh1.error.translationKey)
        return
      }
    } catch (error) {
      state.errorMsg =
        error instanceof Error
          ? error.message
          : 'Could not load the local vault copy.'
    } finally {
      state.isVerifying = false
    }
  }

  async confirmCreateFreshRemoteVault(): Promise<void> {
    const state = this.state
    if (!state.hasManager) return
    state.errorMsg = ''
    state.remoteVaultRecoveryState = RemoteVaultRecoveryState.ConnectFresh
    if (state.loginSetup.kind === LoginSetupKind.Active) {
      state.isVerifying = true
      try {
        await state.loadDb()
      } catch (error) {
        state.errorMsg =
          error instanceof Error
            ? error.message
            : 'Could not create a new vault file.'
      } finally {
        state.isVerifying = false
      }
    }
  }

  clearRemoteVaultRecovery() {
    const state = this.state
    const manager = state.admitManager()
    if (manager.isErr()) return storageErr(manager.error)
    try {
      manager.value.clear_connect_recovery()
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure))
    }
    state.remoteVaultRecoveryState = RemoteVaultRecoveryState.None
    return storageOk(undefined)
  }

  private async resumeConnectAfterSyncConflict({
    providerId,
    pendingProvider,
  }: SyncConflictResumption): Promise<void> {
    const state = this.state
    if (state.isAuthenticated) {
      if (!pendingProvider) {
        const syncProviderByIdArgs: Parameters<typeof state.syncProviderById>[0] = {
          providerId,
          visibility: ProviderSyncVisibility.Quiet,
          failureHandling: ProviderSyncFailureHandling.Capture,
        }
        const providerSync = await state.syncProviderById(syncProviderByIdArgs)
        if (providerSync.isErr()) {
          state.errorMsg = state.t(providerSync.error.translationKey)
          return
        }
        if (providerSync.value !== ProviderSyncOutcome.Synced) return
      }
      const rosterRefresh1 = await state.hydrateMultiDeviceState()
      if (rosterRefresh1.isErr()) {
        state.errorMsg = state.t(rosterRefresh1.error.translationKey)
        return
      }
      return
    }
    if (!state.hasManager) return
    if (
      state.stagedRemoteStorageArgs().kind === StagedRemoteStorageKind.Unavailable &&
      state.syncProviders.length === 0
    ) {
      return
    }
    await state.loadDb()
  }

  async resolveSyncConflictImportRemote({
    identitySelection,
  }: ProviderVaultImportRequest): Promise<void> {
    const state = this.state
    const review = state.syncConflictReview
    if (
      review.state !== NookSyncConflictReviewState.RequiresDecision ||
      review.conflictKind !== VaultSyncConflictKind.StoreId ||
      state.isVerifying
    ) {
      return
    }
    const conflict = review
    const remoteStoreId = conflict.remote_store_id()
    if (!remoteStoreId) return
    const pendingProvider = conflict.isPendingProvider
    const providerLabel = conflict.providerLabel

    state.isVerifying = true
    state.errorMsg = ''
    let providerSave: ConflictProviderSave
    let importOutcome: ProviderVaultImportOutcome = {
      kind: ProviderVaultImportOutcomeKind.NotImported,
    }
    try {
      let importedStoreId: string
      if (conflict.remoteYaml.trim()) {
        importedStoreId = await import_named_local_vault_blob(
          conflict.remoteYaml,
          conflict.providerLabel,
        )
      } else {
        if (!state.hasManager) {
          state.errorMsg = state.t(I18N_KEYS.ErrorsManagerUninitialized)
          return
        }
        const provider = state.providers.find((p) => p.id === conflict.providerId)
        if (provider && provider.type === 'local-folder') {
          const configuration = new StorageProviderPresentation(
            provider,
          ).localFolderProviderConfiguration()
          if (configuration.kind === LocalFolderProviderConfigurationKind.Missing) {
            state.errorMsg = state.t(I18N_KEYS.AuthStorageLocalFolderChooseErr)
            return
          }
          const handle = new LocalFolderPresentation(
            configuration.config,
          ).localFolderHandle()
          if (handle.kind === LocalFolderHandleKind.Unselected) {
            state.errorMsg = state.t(I18N_KEYS.AuthStorageLocalFolderChooseErr)
            return
          }
          const imported = await state.enqueueStorage(async () => {
            const admittedManager = state.admitManager()
            if (admittedManager.isErr()) return storageErr(admittedManager.error)
            try {
              return storageOk(
                await admittedManager.value.import_local_folder_event_log_as_local_vault(
                  handle.handleId,
                ),
              )
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure))
            }
          })
          if (imported.isErr()) {
            state.errorMsg = state.t(imported.error.translationKey)
            return
          }
          importedStoreId = imported.value
        } else {
          const imported = await state.enqueueStorage(async () => {
            const admittedManager = state.admitManager()
            if (admittedManager.isErr()) return storageErr(admittedManager.error)
            try {
              return storageOk(
                await admittedManager.value.import_provider_event_log_as_local_vault(
                  conflict.mode,
                  conflict.pat,
                  conflict.repo,
                ),
              )
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure))
            }
          })
          if (imported.isErr()) {
            state.errorMsg = state.t(imported.error.translationKey)
            return
          }
          importedStoreId = imported.value
        }
      }
      await set_active_vault(importedStoreId)
      state.openActiveVault(importedStoreId)
      state.localVaultPresent = true
      const catalogRefresh1 = await state.refreshLocalVaultCatalog()
      if (catalogRefresh1.isErr()) {
        state.errorMsg = state.t(catalogRefresh1.error.translationKey)
        return
      }
      const saved = await state.ensureProviderSavedAfterConflict(conflict)
      if (saved.isErr()) {
        state.errorMsg = state.t(saved.error.translationKey)
        return
      }
      const providerId = saved.value
      providerSave = { kind: ConflictProviderSaveKind.Saved, providerId }
      if (conflict.remoteYaml.trim()) {
        const remoteRevision = conflict.remoteRevision
        const metadataRequest: Parameters<
          typeof state.updateProviderSyncMetadata
        >[0] = {
          providerId,
          yaml: conflict.remoteYaml,
          revision: remoteRevision,
        }
        const metadata = await state.updateProviderSyncMetadata(metadataRequest)
        if (metadata.isErr()) {
          state.errorMsg = state.t(metadata.error.translationKey)
          return
        }
      } else {
        state.providers = state.providers.map((provider) =>
          provider.id === providerId
            ? {
                ...provider,
                storeId: scopedProviderVault(importedStoreId),
              }
            : provider,
        )
        const persistenceOptions: Parameters<typeof state.persistProviders>[0] = {
          replace: false,
        }
        await state.persistProviders(persistenceOptions)
      }
      const activeVaultPersistence = await state.syncActiveVaultStoreIdToAuth()
      if (activeVaultPersistence.isErr()) {
        state.errorMsg = state.t(activeVaultPersistence.error.translationKey)
        return
      }
      if (identitySelection.kind === ProviderVaultIdentitySelectionKind.Selected) {
        state.selectLoginVault(importedStoreId)
      } else if (state.localVaults.length > 1) {
        // Without an identity choice, preserve the existing multi-vault picker.
        state.clearSelectedLoginVaultStore()
      } else {
        state.selectLoginVault(importedStoreId)
      }
      state.finishStagedProviderConnectAfterConflict(conflict)
      state.clearPendingSyncConflict()
      set_vault_session_locked(true)
      state.clearUnlockedSession()
      const passwordRefresh2 = await state.refreshPasswordEntriesList()
      if (passwordRefresh2.isErr()) {
        state.errorMsg = state.t(passwordRefresh2.error.translationKey)
        return
      }
      if (state.localVaults.length <= 1) {
        const presentation = await new LoginUnlockPresentation(state).refresh()
        if (presentation.isErr()) {
          state.errorMsg = state.t(presentation.error.translationKey)
          return
        }
      }
      const tArgs: Parameters<typeof state.t>[0] = {
        key: I18N_KEYS.AuthStorageSyncConflictImportedVault,
        replacements: {
          provider: providerLabel,
        },
      }
      state.showSuccess(state.t(tArgs))
      importOutcome = {
        kind: ProviderVaultImportOutcomeKind.Imported,
        storeId: importedStoreId,
      }
    } catch (error) {
      state.errorMsg =
        error instanceof Error
          ? error.message
          : state.t(I18N_KEYS.AuthStorageSyncFailed)
      providerSave = { kind: ConflictProviderSaveKind.NotSaved }
    }
    try {
      if (
        providerSave.kind === ConflictProviderSaveKind.Saved &&
        importOutcome.kind === ProviderVaultImportOutcomeKind.NotImported
      ) {
        const resumeConnectAfterSyncConflictArgs: Parameters<
          SyncConflictActions['resumeConnectAfterSyncConflict']
        >[0] = { providerId: providerSave.providerId, pendingProvider }
        await this.resumeConnectAfterSyncConflict(resumeConnectAfterSyncConflictArgs)
      }
      if (
        importOutcome.kind === ProviderVaultImportOutcomeKind.Imported &&
        identitySelection.kind === ProviderVaultIdentitySelectionKind.Selected
      ) {
        const activation: Parameters<
          SyncConflictActions['activateImportedProviderVaultIdentity']
        >[0] = {
          identityId: identitySelection.identityId,
          importedStoreId: importOutcome.storeId,
        }
        await this.activateImportedProviderVaultIdentity(activation)
      }
    } finally {
      state.isVerifying = false
    }
  }
}
