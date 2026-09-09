import type { OAuthFailure } from '$lib/auth/oauth-failure'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk, type Result } from 'neverthrow'
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from '$lib/runtime/storage-failure'
import { BrowserIdentityHandoffKind } from '$lib/vault/identity-handoff'
import { I18N_KEYS } from '../../../generated/i18n-keys'
import type { VaultState } from '$lib/vault.svelte'
import { browserLogRuntime } from '$lib/runtime/log'
import {
  get_active_vault_selection,
  has_active_local_vault,
  list_local_vaults,
  prepare_new_local_vault_slot,
  set_active_vault,
  set_local_vault_label,
  set_vault_session_locked,
  NookVaultSwitchState,
  NookActiveVaultSelectionState,
} from '$app-wasm'
import { activeVaultScope, saveAuthProviders } from '$lib/auth/providers'
import {
  ActiveVaultKind,
  LocalLoginPreparationState,
} from '$lib/vault/state/provider.svelte'
import { LoginUnlockPresentation } from '$lib/vault/login-unlock-capabilities'

const log = browserLogRuntime.createLogger('vault-local')

interface LoginVaultActionRequest {
  readonly storeId: string
}

interface LocalVaultCreationRequest {
  readonly label: string
}

interface LocalVaultRenameRequest {
  readonly storeId: string
  readonly label: string
}

enum PreviousVaultLabelKind {
  Missing = 'missing',
  Present = 'present',
}

type PreviousVaultLabel =
  | { kind: PreviousVaultLabelKind.Missing }
  | { kind: PreviousVaultLabelKind.Present; label: string }

enum LocalVaultCreationState {
  Pending = 'pending',
  Committed = 'committed',
}

/** Owns browser orchestration for one local login context. */
export class VaultLoginActions {
  constructor(private readonly state: VaultState) {}

  async reloadProvidersForActiveVault(): Promise<
    Result<void, StorageOperationFailure>
  > {
    const state = this.state
    const snapshot = await state.enqueueStorage(async () => {
      const admittedManager = state.admitManager()
      if (admittedManager.isErr()) return storageErr(admittedManager.error)
      try {
        return storageOk(await admittedManager.value.load_auth_providers_snapshot())
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure))
      }
    })
    if (snapshot.isErr()) return storageErr(snapshot.error)
    state.providers = snapshot.value.providers
    if (snapshot.value.activeVaultStoreId.state === 'storeId') {
      state.openActiveVault(snapshot.value.activeVaultStoreId.value)
    }
    state.applyActiveProviderCredentials()
    return storageOk(undefined)
  }

  beginLoginVaultPicker(): void {
    const state = this.state
    state.clearSelectedLoginVaultStore()
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    state.resetVaultSessionState()
  }

  async chooseLoginVault({ storeId }: LoginVaultActionRequest): Promise<void> {
    const state = this.state
    const selected = await state.selectVaultForUnlock(storeId)
    if (selected.isErr()) {
      state.errorMsg = state.t(selected.error.translationKey)
      return
    }
    state.selectLoginVault(storeId)
  }

  async switchToVault({ storeId }: LoginVaultActionRequest): Promise<void> {
    const state = this.state
    const switchDecision = state.clientPolicy.vault_switch_target(
      storeId,
      state.hasActiveVaultStore,
      state.activeVault.kind === ActiveVaultKind.Open
        ? state.activeVault.storeId
        : '',
      state.isVerifying,
    )
    if (switchDecision.state !== NookVaultSwitchState.Switch) {
      switchDecision.free()
      return
    }
    const target = switchDecision.target()
    switchDecision.free()
    state.helpOpen = false
    state.cancelProviderSetup()
    state.cancelAddProvider()
    state.isVerifying = true
    try {
      await state.waitForStorageChain()
      set_vault_session_locked(true)
      state.clearUnlockedSession()
      await state.waitForStorageChain()
      const chooseLoginVaultArgs: Parameters<
        VaultLoginActions['chooseLoginVault']
      >[0] = {
        storeId: target,
      }
      await this.chooseLoginVault(chooseLoginVaultArgs)
      state.isVerifying = true
      await state.lockDeviceProtection()
      log.info('vault switch completed')
    } catch (error) {
      state.errorMsg =
        error instanceof Error ? error.message : 'Failed to switch vaults.'
    } finally {
      state.isVerifying = false
    }
  }

  connectedVaultStoreId(): Result<string, StorageOperationFailure> {
    const manager = this.state.admitManager()
    if (manager.isErr()) return storageErr(manager.error)
    try {
      const storeId = manager.value.vaultStoreId.trim()
      return storeId
        ? storageOk(storeId)
        : storageErr(
            new StorageOperationFailure(
              StorageOperationFailureKind.VaultSelectionFailed,
            ),
          )
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure))
    }
  }

  async refreshLocalVaultCatalog(): Promise<Result<void, StorageOperationFailure>> {
    const state = this.state
    let vaults: Awaited<ReturnType<typeof list_local_vaults>>
    let present: boolean
    let selection: Awaited<ReturnType<typeof get_active_vault_selection>>
    try {
      vaults = await list_local_vaults()
      present = await has_active_local_vault()
      selection = await get_active_vault_selection()
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure))
    }
    try {
      state.localVaults = vaults
      state.localVaultPresent = present
      if (selection.state === NookActiveVaultSelectionState.Selected)
        state.openActiveVault(selection.storeId)
      return storageOk(undefined)
    } finally {
      selection.free()
    }
  }

  async prepareLocalLogin(): Promise<void> {
    const state = this.state
    if (
      !state.localVaultPresent ||
      state.localLoginPreparation !== LocalLoginPreparationState.Idle
    )
      return
    state.localLoginPreparation = LocalLoginPreparationState.Preparing
    log.debug('preparing local login gate')
    try {
      state.storageMode = 'local'
      state.githubPat = ''
      state.clearOauthFile()
      state.clearLocalFolder()
      const passwordRefresh1 = await state.refreshPasswordEntriesList()
      if (passwordRefresh1.isErr()) {
        state.errorMsg = state.t(passwordRefresh1.error.translationKey)
        return
      }
      const presentation = await new LoginUnlockPresentation(state).refresh()
      if (presentation.isErr()) {
        state.errorMsg = state.t(presentation.error.translationKey)
        return
      }
      state.localLoginPreparation = LocalLoginPreparationState.Ready
    } finally {
      if (state.localLoginPreparation === LocalLoginPreparationState.Preparing)
        state.localLoginPreparation = LocalLoginPreparationState.Idle
    }
  }

  async selectVaultForUnlock({
    storeId,
  }: LoginVaultActionRequest): Promise<
    Result<void, StorageOperationFailure | OAuthFailure>
  > {
    const state = this.state
    state.errorMsg = ''
    state.dismissSuccess()
    state.isVerifying = true
    try {
      try {
        await set_active_vault(storeId)
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure))
      }
      state.openActiveVault(storeId)
      if (state.hasManager) {
        const reset = await state.enqueueStorage(async () => {
          const manager = state.admitManager()
          if (manager.isErr()) return storageErr(manager.error)
          try {
            await manager.value.reset_vault_session()
            return storageOk(undefined)
          } catch (failure) {
            return storageErr(new NativeVaultStorageFailure(failure))
          }
        })
        if (reset.isErr()) return storageErr(reset.error)
      }
      try {
        state.localVaultPresent = await has_active_local_vault()
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure))
      }
      state.localLoginPreparation = LocalLoginPreparationState.Idle
      const persisted = await state.syncActiveVaultStoreIdToAuth()
      if (persisted.isErr()) return storageErr(persisted.error)
      const loaded = await state.reloadProvidersForActiveVault()
      if (loaded.isErr()) return storageErr(loaded.error)
      const passwordRefresh2 = await state.refreshPasswordEntriesList()
      if (passwordRefresh2.isErr()) return storageErr(passwordRefresh2.error)
      const presentation = await new LoginUnlockPresentation(state).refresh()
      if (presentation.isErr()) return storageErr(presentation.error)
      state.localLoginPreparation = LocalLoginPreparationState.Ready
      return storageOk(undefined)
    } finally {
      state.isVerifying = false
    }
  }

  async prepareExistingVaultImportSlot(): Promise<
    Result<void, StorageOperationFailure>
  > {
    const state = this.state
    try {
      await prepare_new_local_vault_slot()
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure))
    }
    if (state.hasManager) {
      const reset = await state.enqueueStorage(async () => {
        const manager = state.admitManager()
        if (manager.isErr()) return storageErr(manager.error)
        try {
          await manager.value.reset_vault_session()
          return storageOk(undefined)
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure))
        }
      })
      if (reset.isErr()) return storageErr(reset.error)
    }
    state.clearActiveVaultStore()
    try {
      state.localVaultPresent = await has_active_local_vault()
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure))
    }
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    return storageOk(undefined)
  }

  async createLocalVaultWithDeviceKeys({
    label,
  }: LocalVaultCreationRequest): Promise<void> {
    const state = this.state
    if (!state.hasManager) {
      state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable)
      return
    }
    if (state.isVerifying) return

    const trimmedLabel = label.trim()
    if (!trimmedLabel) {
      state.errorMsg = state.t(I18N_KEYS.LoginVaultNameRequired)
      return
    }

    state.errorMsg = ''
    state.dismissSuccess()
    state.storageMode = 'local'
    state.githubPat = ''
    state.clearOauthFile()
    state.clearLocalFolder()
    state.isVerifying = true
    let handoffAwaitingVaultCreation = false
    let creationState = LocalVaultCreationState.Pending

    try {
      const identityInitialization = await state.initDeviceIdentity()
      if (identityInitialization.isErr()) {
        state.errorMsg = state.t(identityInitialization.error.translationKey)
        return
      }
      if (
        state.externalIdentityHandoff.kind === BrowserIdentityHandoffKind.Adopted
      ) {
        const manager = state.admitManager()
        if (manager.isErr()) {
          state.errorMsg = state.t(manager.error.translationKey)
          return
        }
        const required = state.externalIdentityHandoff.adoption.requiresConnect(
          manager.value,
        )
        if (required.isErr()) {
          state.errorMsg = state.t(required.error.translationKey)
          return
        }
        handoffAwaitingVaultCreation = required.value
      }
      const creatingAdditionalVault = state.localVaults.length > 0
      if (creatingAdditionalVault) {
        await prepare_new_local_vault_slot()
        const persistence = await state.enqueueStorage(async () => {
          const admittedManager = state.admitManager()
          if (admittedManager.isErr()) return storageErr(admittedManager.error)
          try {
            return storageOk(await admittedManager.value.reset_vault_session())
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure))
          }
        })
        if (persistence.isErr()) {
          state.errorMsg = state.t(persistence.error.translationKey)
          return
        }
      }
      state.applyDraftVaultArchitecture()
      const rawRecords = await state.enqueueStorage(async () => {
        const manager = state.admitManager()
        if (manager.isErr()) return storageErr(manager.error)
        try {
          const records = creatingAdditionalVault
            ? await manager.value.connect_fresh('local', '', '')
            : await manager.value.connect('local', '', '')
          return storageOk(records)
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (rawRecords.isErr()) {
        state.errorMsg = state.t(rawRecords.error.translationKey)
        return
      }
      for (const record of rawRecords.value) record.free()
      if (handoffAwaitingVaultCreation) {
        const manager = state.admitManager()
        if (manager.isErr()) {
          state.errorMsg = state.t(manager.error.translationKey)
          return
        }
        const handoff = state.externalIdentityHandoff
        state.externalIdentityHandoff = {
          kind: BrowserIdentityHandoffKind.Inactive,
        }
        if (handoff.kind === BrowserIdentityHandoffKind.Adopted) {
          const confirmed = handoff.adoption.afterVerifiedConnect(manager.value)
          if (confirmed.isErr()) {
            state.errorMsg = state.t(confirmed.error.translationKey)
            return
          }
        }
        handoffAwaitingVaultCreation = false
      }
      const loadPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
        query: '',
        requestedOffset: 0,
      }
      const secretRefresh1 = await state.loadSecretPage(loadPageArgs)
      if (secretRefresh1.isErr()) {
        state.errorMsg = state.t(secretRefresh1.error.translationKey)
        return
      }
      const unlocked = state.markVaultUnlocked()
      if (unlocked.isErr()) {
        state.errorMsg = state.t(unlocked.error.translationKey)
        return
      }
      const connectedStore = this.connectedVaultStoreId()
      if (connectedStore.isErr()) {
        state.errorMsg = state.t(connectedStore.error.translationKey)
        return
      }
      const storeId = connectedStore.value
      state.openActiveVault(storeId)
      const persistence = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(await admittedManager.value.set_vault_name(trimmedLabel))
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (persistence.isErr()) {
        state.errorMsg = state.t(persistence.error.translationKey)
        return
      }
      await set_local_vault_label(storeId, trimmedLabel)
      const catalogRefresh1 = await this.refreshLocalVaultCatalog()
      if (catalogRefresh1.isErr()) {
        state.errorMsg = state.t(catalogRefresh1.error.translationKey)
        return
      }
      state.localLoginPreparation = LocalLoginPreparationState.Ready
      const savedProvider1 = await state.ensureProviderSaved()
      if (savedProvider1.isErr()) {
        state.errorMsg = state.t(savedProvider1.error.translationKey)
        return
      }
      const activeVaultPersistence = await state.syncActiveVaultStoreIdToAuth()
      if (activeVaultPersistence.isErr()) {
        state.errorMsg = state.t(activeVaultPersistence.error.translationKey)
        return
      }
      const rosterRefresh1 = await state.hydrateMultiDeviceState()
      if (rosterRefresh1.isErr()) {
        state.errorMsg = state.t(rosterRefresh1.error.translationKey)
        return
      }
      log.info('local vault created (device keys)')
      state.showSuccess(state.t(I18N_KEYS.ToastsLocalLoaded))
      state.startIdleSessionTracking()
      state.startVaultSync()
      creationState = LocalVaultCreationState.Committed
    } catch (e) {
      const message =
        e instanceof Error ? e.message : state.t(I18N_KEYS.ErrorsVaultCreationFailed)
      log.warn('local vault create failed')
      state.errorMsg = message
    } finally {
      if (creationState === LocalVaultCreationState.Pending) {
        const failureMessage = state.errorMsg
        if (handoffAwaitingVaultCreation) {
          const handoff = state.externalIdentityHandoff
          state.externalIdentityHandoff = {
            kind: BrowserIdentityHandoffKind.Inactive,
          }
          if (handoff.kind === BrowserIdentityHandoffKind.Adopted) {
            const manager = state.admitManager()
            const rollback = manager.isOk()
              ? handoff.adoption.rollback(manager.value)
              : handoff.adoption.discard()
            if (manager.isErr() || rollback.isErr())
              log.warn('failed vault creation handoff rollback failed')
          }
          state.deviceId = ''
          state.devicePublicKey = ''
          state.deviceProtectionStatus = state.deviceProtectionLockedStatus
        }
        set_vault_session_locked(true)
        state.clearUnlockedSession(false)
        state.errorMsg = failureMessage
      }
      state.isVerifying = false
    }
  }

  async renameLocalVaultLabel({
    storeId,
    label,
  }: LocalVaultRenameRequest): Promise<void> {
    const state = this.state
    const trimmedStoreId = storeId.trim()
    const trimmedLabel = label.trim()
    if (!trimmedStoreId) return
    if (!trimmedLabel) {
      state.errorMsg = state.t(I18N_KEYS.LoginVaultNameRequired)
      return
    }

    state.errorMsg = ''
    state.dismissSuccess()
    state.isVerifying = true
    const previousLabelInitial: PreviousVaultLabel = {
      kind: PreviousVaultLabelKind.Missing,
    }
    const previousLabel = state.localVaults.reduce<PreviousVaultLabel>(
      // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
      (current, vault) =>
        vault.storeId.trim() === trimmedStoreId
          ? { kind: PreviousVaultLabelKind.Present, label: vault.label }
          : current,
      previousLabelInitial,
    )
    let renameCommitted = false

    try {
      await set_local_vault_label(trimmedStoreId, trimmedLabel)
      if (
        state.activeVault.kind === ActiveVaultKind.Open &&
        trimmedStoreId === state.activeVault.storeId.trim()
      ) {
        const renamed = await state.enqueueStorage(async () => {
          const admittedManager = state.admitManager()
          if (admittedManager.isErr()) return storageErr(admittedManager.error)
          try {
            return storageOk(
              await admittedManager.value.set_vault_name(trimmedLabel),
            )
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure))
          }
        })
        if (renamed.isErr()) {
          state.errorMsg = state.t(renamed.error.translationKey)
          return
        }
      }
      renameCommitted = true
      const catalogRefresh2 = await this.refreshLocalVaultCatalog()
      if (catalogRefresh2.isErr()) {
        state.errorMsg = state.t(catalogRefresh2.error.translationKey)
        return
      }
      state.showSuccess(state.t(I18N_KEYS.ToastsVaultRenamed))
    } catch (e) {
      state.errorMsg =
        e instanceof Error ? e.message : state.t(I18N_KEYS.ErrorsVaultRenameFailed)
    } finally {
      if (
        !renameCommitted &&
        previousLabel.kind === PreviousVaultLabelKind.Present
      ) {
        try {
          await set_local_vault_label(trimmedStoreId, previousLabel.label)
          const catalogRefresh3 = await this.refreshLocalVaultCatalog()
          if (catalogRefresh3.isErr()) {
            state.errorMsg = state.t(catalogRefresh3.error.translationKey)
            log.warn('local vault rename rollback refresh failed')
          }
        } catch {
          log.warn('local vault rename rollback failed')
        }
      }
      state.isVerifying = false
    }
  }

  async syncActiveVaultStoreIdToAuth(): Promise<
    Result<void, StorageOperationFailure>
  > {
    const state = this.state
    if (state.activeVault.kind === ActiveVaultKind.Closed)
      return storageOk(undefined)
    const storeId = state.activeVault.storeId.trim()
    if (!storeId) return storageOk(undefined)
    return state.enqueueStorage(async () => {
      const manager = state.admitManager()
      if (manager.isErr()) return storageErr(manager.error)
      return saveAuthProviders({
        manager: manager.value,
        snapshot: {
          providers: state.providers,
          activeVaultStoreId: activeVaultScope(storeId),
        },
      })
    })
  }

  async activateConnectedExistingVault({
    storeId,
  }: LoginVaultActionRequest): Promise<Result<void, StorageOperationFailure>> {
    const state = this.state
    if (!state.isAuthenticated)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.DeviceAuthorizationRequired,
        ),
      )
    const connectedStore = this.connectedVaultStoreId()
    if (connectedStore.isErr()) return storageErr(connectedStore.error)
    if (connectedStore.value !== storeId)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.VaultSelectionFailed,
        ),
      )
    try {
      await set_active_vault(storeId)
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure))
    }
    state.openActiveVault(storeId)
    const catalog = await this.refreshLocalVaultCatalog()
    if (catalog.isErr()) return storageErr(catalog.error)
    return this.syncActiveVaultStoreIdToAuth()
  }
}
