import type { Result } from 'neverthrow'
import type { OAuthFailure } from '$lib/auth/oauth-failure'
export type PasswordOperationResult = Result<
  void,
  StorageOperationFailure | OAuthFailure
>
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk } from 'neverthrow'
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from '$lib/runtime/storage-failure'
import { VaultRecoveryErrorKind } from '$app-wasm'
import { I18N_KEYS } from '../../../generated/i18n-keys'
import { VaultState } from '$lib/vault.svelte'
import { EnrollmentEntryKind } from '$lib/vault/state/session.svelte'
import { browserLogRuntime } from '$lib/runtime/log'
import { SentinelUnlockActions } from '$lib/vault/sentinel-unlock'

export {
  findSharedGrantProvider,
  SharedStorageTargetKind,
  shouldFlushSharedDriveGrant,
  type SharedGrantProvider,
  type SharedStorageTarget,
} from '$lib/vault/password-enrollment'
import { JoinEnrollmentState } from '$app-wasm'

const log = browserLogRuntime.createLogger('vault-password')

type E2ePasswordManager = {
  // Generated wasm-bindgen methods are positional host bindings.
  // eslint-disable-next-line max-params
  add_vault_password_for_e2e?: (label: string, password: string) => Promise<void>
  // eslint-disable-next-line max-params
  update_vault_password_entry_for_e2e?: (
    entryId: string,
    password: string,
  ) => Promise<void>
}

type VaultPasswordCreation = {
  readonly label: string
  readonly password: string
}

type VaultPasswordUpdate = {
  readonly entryId: string
  readonly password: string
}

type VaultPasswordRemoval = {
  readonly entryId: string
}

type PasswordUnlockRequest = {
  readonly entryId: string
  readonly password: string
}

export {
  PasswordEnrollmentActions,
  PasswordEnrollmentIssue,
} from '$lib/vault/password-enrollment-flow'

/** Owns browser orchestration for one password unlock context. */
export class VaultPasswordActions {
  constructor(private readonly state: VaultState) {}

  async addVaultPassword({
    label,
    password,
  }: VaultPasswordCreation): Promise<PasswordOperationResult> {
    const state = this.state
    if (!state.hasManager) {
      return storageErr(
        new StorageOperationFailure(StorageOperationFailureKind.ManagerUnavailable),
      )
    }
    if (!state.isAuthenticated) {
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.DeviceAuthorizationRequired,
        ),
      )
    }
    const hadPasswords = state.passwordEntries.length > 0
    state.passwordError = ''
    state.isPasswordBusy = true
    try {
      const changed = await state.enqueueStorage(async () => {
        const admitted = state.admitManager()
        if (admitted.isErr()) return storageErr(admitted.error)
        const manager = admitted.value
        try {
          const trimmedLabel = label.trim()
          const e2eManager = manager as typeof manager & E2ePasswordManager
          if (
            state.runtimeConfig.e2eExposeVault &&
            e2eManager.add_vault_password_for_e2e
          ) {
            await e2eManager.add_vault_password_for_e2e(trimmedLabel, password)
            return storageOk(undefined)
          }
          await manager.add_vault_password(trimmedLabel, password)
          return storageOk(undefined)
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure))
        }
      })
      if (changed.isErr()) return storageErr(changed.error)
      const passwordRefresh1 = await state.refreshPasswordEntriesList()
      if (passwordRefresh1.isErr()) return storageErr(passwordRefresh1.error)
      log.info('vault password added')
      state.showSuccess(
        hadPasswords
          ? state.t(I18N_KEYS.ToastsPasswordAddedRotate)
          : state.t(I18N_KEYS.ToastsPasswordSet),
      )
      const rosterRefresh1 = await state.hydrateMultiDeviceState()
      if (rosterRefresh1.isErr()) {
        return storageErr(rosterRefresh1.error)
      }
      await state.runFanOutSyncAfterLocalSave()
      return storageOk(undefined)
    } finally {
      state.isPasswordBusy = false
    }
  }

  async updateVaultPasswordEntry({
    entryId,
    password,
  }: VaultPasswordUpdate): Promise<PasswordOperationResult> {
    const state = this.state
    if (!state.deviceProtectionReady) {
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.DeviceAuthorizationRequired,
        ),
      )
    }
    if (!state.hasManager) {
      return storageErr(
        new StorageOperationFailure(StorageOperationFailureKind.ManagerUnavailable),
      )
    }
    state.passwordError = ''
    state.isPasswordBusy = true
    try {
      const changed = await state.enqueueStorage(async () => {
        const admitted = state.admitManager()
        if (admitted.isErr()) return storageErr(admitted.error)
        const manager = admitted.value
        try {
          const e2eManager = manager as typeof manager & E2ePasswordManager
          if (
            state.runtimeConfig.e2eExposeVault &&
            e2eManager.update_vault_password_entry_for_e2e
          ) {
            await e2eManager.update_vault_password_entry_for_e2e(entryId, password)
            return storageOk(undefined)
          }
          await manager.update_vault_password_entry(entryId, password)
          return storageOk(undefined)
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure))
        }
      })
      if (changed.isErr()) return storageErr(changed.error)
      const passwordRefresh2 = await state.refreshPasswordEntriesList()
      if (passwordRefresh2.isErr()) return storageErr(passwordRefresh2.error)
      state.showSuccess(state.t(I18N_KEYS.ToastsPasswordUpdated))
      await state.runFanOutSyncAfterLocalSave()
      return storageOk(undefined)
    } finally {
      state.isPasswordBusy = false
    }
  }

  async removeVaultPasswordEntry({
    entryId,
  }: VaultPasswordRemoval): Promise<PasswordOperationResult> {
    const state = this.state
    if (!state.deviceProtectionReady) {
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.DeviceAuthorizationRequired,
        ),
      )
    }
    if (!state.hasManager)
      return storageErr(
        new StorageOperationFailure(StorageOperationFailureKind.ManagerUnavailable),
      )
    state.passwordError = ''
    state.isPasswordBusy = true
    try {
      const removal = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.remove_vault_password_entry(entryId),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (removal.isErr()) {
        return storageErr(removal.error)
      }
      const passwordRefresh3 = await state.refreshPasswordEntriesList()
      if (passwordRefresh3.isErr()) return storageErr(passwordRefresh3.error)
      if (
        state.activeEnrollmentEntry.kind === EnrollmentEntryKind.Active &&
        state.activeEnrollmentEntry.entryId === entryId
      ) {
        state.enrollmentCode = ''
        state.clearActiveEnrollmentEntry()
      }
      state.showSuccess(state.t(I18N_KEYS.ToastsPasswordRemoved))
      await state.runFanOutSyncAfterLocalSave()
      return storageOk(undefined)
    } finally {
      state.isPasswordBusy = false
    }
  }

  async unlockWithPassword({
    entryId,
    password,
  }: PasswordUnlockRequest): Promise<void> {
    const state = this.state
    if (!state.hasManager) {
      state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable)
      return
    }
    if (state.isVerifying) return
    if (new SentinelUnlockActions(state).isSentinelVault()) {
      state.errorMsg = state.t(I18N_KEYS.ArchitectureModesSentinelPasswordForbidden)
      state.sentinelCeremonyPrompt = true
      return
    }
    if (state.storageMode !== 'local' && !state.hasRemoteCredentials()) {
      state.errorMsg =
        state.storageMode === 'oauth-file'
          ? state.t(I18N_KEYS.ErrorsGoogleSignInRequired)
          : state.t(I18N_KEYS.ErrorsGithubCredentialsRequired)
      return
    }
    if (state.storageMode !== 'local') {
      const refreshedTokens = await state.ensureOAuthTokensFresh()
      if (refreshedTokens.isErr()) {
        state.errorMsg = state.t(refreshedTokens.error.translationKey)
        return
      }
    }
    if (!entryId.trim()) {
      state.errorMsg = state.t(I18N_KEYS.ErrorsVaultPasswordRequired)
      return
    }
    state.errorMsg = ''
    state.dismissSuccess()
    state.isVerifying = true
    try {
      const storageArgs = state.wasmStorageArgs()
      const page = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.connect_with_password(
              storageArgs.mode,
              storageArgs.pat,
              storageArgs.repo,
              entryId,
              password,
              state.secretPageSize,
            ),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (page.isErr()) {
        state.isAuthenticated = false
        if (
          page.error.recoveryKind ===
          VaultRecoveryErrorKind.SentinelPasswordUnlockForbidden
        ) {
          state.errorMsg = state.t(
            I18N_KEYS.ArchitectureModesSentinelPasswordForbidden,
          )
          state.sentinelCeremonyPrompt = true
        } else {
          state.errorMsg = state.t(page.error.translationKey)
        }
        return
      }
      const connectedPageArgs: Parameters<typeof state.applyConnectedSecretPage>[0] =
        { page: page.value, query: '' }
      state.applyConnectedSecretPage(connectedPageArgs)
      if (state.deviceProtectionReady) {
        const savedProvider1 = await state.ensureProviderSaved()
        if (savedProvider1.isErr()) {
          state.errorMsg = state.t(savedProvider1.error.translationKey)
          return
        }
        const providerLoadOptions: Parameters<typeof state.loadProviders>[0] = {
          ensureLocalRow: false,
        }
        const loadedProviders1 = await state.loadProviders(providerLoadOptions)
        if (loadedProviders1.isErr()) {
          state.errorMsg = state.t(loadedProviders1.error.translationKey)
          return
        }
      }
      const passwordRefresh4 = await state.refreshPasswordEntriesList()
      if (passwordRefresh4.isErr()) {
        state.errorMsg = state.t(passwordRefresh4.error.translationKey)
        return
      }
      if (state.deviceProtectionReady) {
        const rosterRefresh2 = await state.hydrateMultiDeviceState()
        if (rosterRefresh2.isErr()) {
          state.errorMsg = state.t(rosterRefresh2.error.translationKey)
          return
        }
      }
      const unlocked = state.markVaultUnlocked()
      if (unlocked.isErr()) {
        state.errorMsg = state.t(unlocked.error.translationKey)
        return
      }
      log.info('vault unlocked with password')
      state.joinEnrollmentPrompt = JoinEnrollmentState.None
      state.loginPasswordPrompt = false
      state.showSuccess(state.t(I18N_KEYS.ToastsVaultUnlocked))
      state.startIdleSessionTracking()
      if (state.deviceProtectionReady) {
        state.startVaultSync()
      }
    } catch (e) {
      state.isAuthenticated = false
      const message =
        e instanceof Error ? e.message : 'Failed to unlock with password.'
      log.warn('vault password unlock failed')
      if (
        browserLogRuntime.runtimeFailure(e).vaultRecoveryKind() ===
        VaultRecoveryErrorKind.SentinelPasswordUnlockForbidden
      ) {
        state.errorMsg = state.t(
          I18N_KEYS.ArchitectureModesSentinelPasswordForbidden,
        )
        state.sentinelCeremonyPrompt = true
        return
      }
      state.errorMsg = message
    } finally {
      state.isVerifying = false
    }
  }
}
