import type { NookVaultManager } from '$app-wasm'
import type { OAuthFailure } from '$lib/auth/oauth-failure'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk, type Result } from 'neverthrow'
import { VaultStorageFailure as StorageOperationFailure } from '$lib/runtime/storage-failure'
import { I18N_KEYS } from '../../../generated/i18n-keys'

/** Device-protection actions that snapshot reactive state for persistence. */
import {
  PasskeyCeremonyFailure,
  PasskeyFallback,
  isPasskeyCeremonyNotAllowedError,
  isPasskeyPrfUnavailableError,
  isPasskeyUnavailableError,
  recoverDeviceProtectionWithPasskey as recoverExistingPasskeyProtection,
  sanitizedPasskeyCeremonyData,
  setupDeviceProtection as createPasskeyProtection,
  unlockDeviceProtection as authorizePasskeyProtection,
} from '$lib/auth/passkey-device-protection'
import {
  activeVaultScope,
  LOCAL_PROVIDER_TYPE,
  unselectedVaultScope,
} from '$lib/auth/providers'
import { browserLogRuntime } from '$lib/runtime/log'
import { browserDataLifecycle } from '$lib/runtime/browser-data'
import type { DeviceMode } from '$lib/vault/architecture-model'
import type { VaultState } from '$lib/vault.svelte'
import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
import {
  DeviceProtectionStatus,
  providers_visible_while_device_locked,
  set_vault_session_locked,
} from '$app-wasm'

const log = browserLogRuntime.createLogger('vault-device-protection')

interface AuthorizedDeviceInitialization {
  readonly mode: DeviceProtectionStatus
  readonly initializeSession: boolean
}

interface FailedDeviceAuthorization {
  readonly deviceIdentityUnlocked: boolean
}

interface PasskeyCeremonyLogEntry {
  readonly message: string
  readonly data: ReturnType<typeof sanitizedPasskeyCeremonyData>
}

interface VaultDeviceProtectionSetupRequest {
  readonly passkeyLabel: string
  readonly deviceMode: DeviceMode
  readonly initializeSession: boolean
}

interface PinDeviceProtectionSetupRequest {
  readonly pin: string
  readonly confirmPin: string
  readonly initializeSession: boolean
}

interface PinDeviceProtectionUnlockRequest {
  readonly pin: string
  readonly initializeSession: boolean
}

interface DeviceProtectionUnlockRequest {
  readonly initializeSession: boolean
}

type DeviceProtectionRecoveryManager = Pick<
  NookVaultManager,
  | 'local_identity_recovery_app_id'
  | 'reset_device_protection_for_recovery'
  | 'device_protection_status'
>

type DeviceProtectionRecoveryState = Pick<
  VaultState,
  | 'hasManager'
  | 'isVerifying'
  | 'errorMsg'
  | 'deviceProtectionStatus'
  | 'deviceProtectionLockedStatus'
  | 'deviceId'
  | 'devicePublicKey'
  | 'providers'
  | 'providersLoaded'
  | 'githubPat'
  | 'storageMode'
  | 'enqueueExclusiveStorage'
  | 'adoptLocalDataStorageGeneration'
  | 'clearUnlockedSession'
  | 'clearOauthFile'
  | 'clearLocalFolder'
  | 'showSuccess'
  | 't'
> & {
  admitManager: () => Result<
    DeviceProtectionRecoveryManager,
    StorageOperationFailure
  >
}

export type DeviceProtectionRecoveryRequest = {
  expectedAppId: string
}

type PersistedProtectionStatusRequest = {
  readonly status: DeviceProtectionStatus
}

export class DeviceProtectionActions {
  constructor(private readonly state: VaultState) {}

  async lockDeviceProtection(): Promise<Result<void, StorageOperationFailure>> {
    const state = this.state
    state.deviceProtectionStatus = state.deviceProtectionLockedStatus
    state.deviceAuthorizationInProgress = false
    state.deviceId = ''
    state.devicePublicKey = ''
    state.githubPat = ''
    state.clearOauthFile()
    state.clearLocalFolder()
    if (state.localVaultPresent) state.storageMode = LOCAL_PROVIDER_TYPE

    // Dispose native authority synchronously, before any queued or asynchronous work.
    let locked: Result<void, StorageOperationFailure> = storageOk(undefined)
    if (state.hasManager) {
      const manager = state.admitManager()
      if (manager.isErr()) locked = storageErr(manager.error)
      else {
        try {
          manager.value.lock_device_identity()
        } catch (failure) {
          locked = storageErr(new NativeVaultStorageFailure(failure))
        }
      }
    }
    const snapshot = $state.snapshot({
      providers: state.providers,
      activeVaultStoreId:
        state.activeVault.kind === ActiveVaultKind.Open
          ? activeVaultScope(state.activeVault.storeId)
          : unselectedVaultScope(),
    })
    // Publication stays denied even if the native visibility projection fails.
    state.providers = []
    state.providersLoaded = false
    try {
      state.providers = providers_visible_while_device_locked(snapshot).providers
      state.providersLoaded = state.providers.length > 0
    } catch (failure) {
      return locked.isErr()
        ? locked
        : storageErr(new NativeVaultStorageFailure(failure))
    }
    return locked
  }

  private async finishAuthorizedInitialization({
    mode,
    initializeSession,
  }: AuthorizedDeviceInitialization): Promise<
    Result<void, StorageOperationFailure | OAuthFailure>
  > {
    const state = this.state
    state.deviceAuthorizationInProgress = true
    state.deviceProtectionLockedStatus = mode
    if (initializeSession) {
      const initialized = await state.continueInitializationAfterDeviceUnlock()
      if (initialized.isErr()) return storageErr(initialized.error)
    } else {
      const manager = state.admitManager()
      if (manager.isErr()) return storageErr(manager.error)
      try {
        state.deviceId = manager.value.device_id
        state.devicePublicKey = manager.value.device_public_key
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure))
      }
    }
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    return storageOk(undefined)
  }

  private lockFailedAuthorization({
    deviceIdentityUnlocked,
  }: FailedDeviceAuthorization): void {
    const state = this.state
    if (
      state.deviceProtectionStatus === DeviceProtectionStatus.Unlocked ||
      deviceIdentityUnlocked
    ) {
      void state.lockDeviceProtection().then((locked) => {
        if (locked.isErr()) state.errorMsg = state.t(locked.error.translationKey)
      })
    }
  }

  private logPasskeyCeremony({ message, data }: PasskeyCeremonyLogEntry): void {
    const context: Parameters<typeof log.warnWithContext>[0] = {
      message,
      serializedContext: JSON.stringify(data),
    }
    log.warnWithContext(context)
  }

  async setupDeviceProtection({
    passkeyLabel,
    deviceMode,
    initializeSession,
  }: VaultDeviceProtectionSetupRequest): Promise<void> {
    const state = this.state
    if (!state.hasManager || state.isVerifying) return
    state.isVerifying = true
    state.errorMsg = ''
    let deviceIdentityUnlocked = false
    try {
      const localizedPasskeyLabel =
        passkeyLabel.trim() || state.t(I18N_KEYS.DeviceProtectionPasskeyDefaultLabel)
      const ceremony = await state.enqueueStorage(
        async (): Promise<
          Result<void, PasskeyCeremonyFailure | StorageOperationFailure>
        > => {
          const manager = state.admitManager()
          if (manager.isErr()) return storageErr(manager.error)
          return createPasskeyProtection({
            manager: manager.value,
            passkeyLabel: localizedPasskeyLabel,
            deviceMode,
          })
        },
      )
      if (ceremony.isErr()) {
        this.presentCeremonyFailure(ceremony.error)
        return
      }
      deviceIdentityUnlocked = true
      const finishAuthorizedInitializationArgs: Parameters<
        DeviceProtectionActions['finishAuthorizedInitialization']
      >[0] = { mode: DeviceProtectionStatus.Passkey, initializeSession }
      const initialized = await this.finishAuthorizedInitialization(
        finishAuthorizedInitializationArgs,
      )
      if (initialized.isErr()) {
        this.lockFailedAuthorization({ deviceIdentityUnlocked })
        state.errorMsg = state.t(initialized.error.translationKey)
        return
      }
    } catch (error) {
      if (isPasskeyCeremonyNotAllowedError(error)) {
        const logPasskeyCeremonyArgs: Parameters<
          DeviceProtectionActions['logPasskeyCeremony']
        >[0] = {
          message: 'passkey creation did not finish',
          data: sanitizedPasskeyCeremonyData(error),
        }
        this.logPasskeyCeremony(logPasskeyCeremonyArgs)
        state.errorMsg = state.t(I18N_KEYS.DeviceProtectionPasskeyCreateNotAllowed)
        return
      }
      if (isPasskeyUnavailableError(error)) {
        const logPasskeyCeremonyArgs2: Parameters<
          DeviceProtectionActions['logPasskeyCeremony']
        >[0] = {
          message: 'passkey unavailable; offering PIN device protection fallback',
          data: sanitizedPasskeyCeremonyData(error),
        }
        this.logPasskeyCeremony(logPasskeyCeremonyArgs2)
        state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup
        state.errorMsg = state.t(
          I18N_KEYS.DeviceProtectionPasskeyUnavailablePinFallbackReady,
        )
        return
      }
      if (isPasskeyPrfUnavailableError(error)) {
        const logPasskeyCeremonyArgs3: Parameters<
          DeviceProtectionActions['logPasskeyCeremony']
        >[0] = {
          message:
            'passkey PRF unavailable; offering PIN device protection fallback',
          data: sanitizedPasskeyCeremonyData(error),
        }
        this.logPasskeyCeremony(logPasskeyCeremonyArgs3)
        state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup
        state.errorMsg = state.t(I18N_KEYS.DeviceProtectionPinFallbackReady)
        return
      }
      const logPasskeyCeremonyArgs4: Parameters<
        DeviceProtectionActions['logPasskeyCeremony']
      >[0] = {
        message: 'passkey device protection setup failed',
        data: sanitizedPasskeyCeremonyData(error),
      }
      this.logPasskeyCeremony(logPasskeyCeremonyArgs4)
      if (initializeSession) {
        const lockFailedAuthorizationArgs: Parameters<
          DeviceProtectionActions['lockFailedAuthorization']
        >[0] = { deviceIdentityUnlocked }
        this.lockFailedAuthorization(lockFailedAuthorizationArgs)
      }
      state.errorMsg =
        error instanceof Error ? error.message : 'Failed to create passkey.'
    } finally {
      state.deviceAuthorizationInProgress = false
      state.isVerifying = false
      state.isInitializing = false
    }
  }

  private presentCeremonyFailure(
    failure: PasskeyCeremonyFailure | StorageOperationFailure,
  ): void {
    if (failure instanceof PasskeyCeremonyFailure) {
      if (failure.fallback === PasskeyFallback.OfferPin) {
        this.state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup
      }
      this.logPasskeyCeremony({
        message: 'passkey ceremony did not complete',
        data: failure.diagnostic,
      })
    }
    this.state.errorMsg = this.state.t(failure.translationKey)
  }

  async recoverDeviceProtectionWithPasskey(): Promise<void> {
    const state = this.state
    if (!state.hasManager || state.isVerifying) return
    state.isVerifying = true
    state.errorMsg = ''
    let deviceIdentityUnlocked = false
    try {
      const ceremony = await state.enqueueStorage(
        async (): Promise<
          Result<void, PasskeyCeremonyFailure | StorageOperationFailure>
        > => {
          const manager = state.admitManager()
          if (manager.isErr()) return storageErr(manager.error)
          return recoverExistingPasskeyProtection(manager.value)
        },
      )
      if (ceremony.isErr()) {
        this.presentCeremonyFailure(ceremony.error)
        return
      }
      deviceIdentityUnlocked = true
      const finishAuthorizedInitializationArgs2: Parameters<
        DeviceProtectionActions['finishAuthorizedInitialization']
      >[0] = {
        mode: DeviceProtectionStatus.Passkey,
        initializeSession: true,
      }
      const initialized = await this.finishAuthorizedInitialization(
        finishAuthorizedInitializationArgs2,
      )
      if (initialized.isErr()) {
        this.lockFailedAuthorization({ deviceIdentityUnlocked })
        state.errorMsg = state.t(initialized.error.translationKey)
        return
      }
    } catch (error) {
      if (isPasskeyCeremonyNotAllowedError(error)) {
        const logPasskeyCeremonyArgs5: Parameters<
          DeviceProtectionActions['logPasskeyCeremony']
        >[0] = {
          message: 'passkey recovery did not finish',
          data: sanitizedPasskeyCeremonyData(error),
        }
        this.logPasskeyCeremony(logPasskeyCeremonyArgs5)
        state.errorMsg = state.t(I18N_KEYS.DeviceProtectionPasskeyRecoveryNotAllowed)
        return
      }
      if (isPasskeyUnavailableError(error)) {
        const logPasskeyCeremonyArgs6: Parameters<
          DeviceProtectionActions['logPasskeyCeremony']
        >[0] = {
          message:
            'passkey recovery unavailable; offering PIN device protection fallback',
          data: sanitizedPasskeyCeremonyData(error),
        }
        this.logPasskeyCeremony(logPasskeyCeremonyArgs6)
        state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup
        state.errorMsg = state.t(
          I18N_KEYS.DeviceProtectionRecoveryPasskeyUnavailablePinFallbackReady,
        )
        return
      }
      if (isPasskeyPrfUnavailableError(error)) {
        const logPasskeyCeremonyArgs7: Parameters<
          DeviceProtectionActions['logPasskeyCeremony']
        >[0] = {
          message:
            'passkey recovery PRF unavailable; offering PIN device protection fallback',
          data: sanitizedPasskeyCeremonyData(error),
        }
        this.logPasskeyCeremony(logPasskeyCeremonyArgs7)
        state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup
        state.errorMsg = state.t(I18N_KEYS.DeviceProtectionRecoveryPinFallbackReady)
        return
      }
      const logPasskeyCeremonyArgs8: Parameters<
        DeviceProtectionActions['logPasskeyCeremony']
      >[0] = {
        message: 'passkey device protection recovery failed',
        data: sanitizedPasskeyCeremonyData(error),
      }
      this.logPasskeyCeremony(logPasskeyCeremonyArgs8)
      const lockFailedAuthorizationArgs2: Parameters<
        DeviceProtectionActions['lockFailedAuthorization']
      >[0] = { deviceIdentityUnlocked }
      this.lockFailedAuthorization(lockFailedAuthorizationArgs2)
      state.errorMsg =
        error instanceof Error ? error.message : 'Failed to use existing passkey.'
    } finally {
      state.deviceAuthorizationInProgress = false
      state.isVerifying = false
      state.isInitializing = false
    }
  }

  async setupPinDeviceProtection({
    pin,
    confirmPin,
    initializeSession,
  }: PinDeviceProtectionSetupRequest): Promise<void> {
    const state = this.state
    if (!state.hasManager || state.isVerifying) return
    state.isVerifying = true
    state.errorMsg = ''
    let deviceIdentityUnlocked = false
    try {
      if (pin !== confirmPin) {
        state.errorMsg = state.t(I18N_KEYS.DeviceProtectionPinMismatch)
        return
      }
      const authorization = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.finish_pin_device_protection(pin),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (authorization.isErr()) {
        state.errorMsg = state.t(authorization.error.translationKey)
        return
      }
      deviceIdentityUnlocked = true
      const finishAuthorizedInitializationArgs3: Parameters<
        DeviceProtectionActions['finishAuthorizedInitialization']
      >[0] = { mode: DeviceProtectionStatus.Pin, initializeSession }
      const initialized = await this.finishAuthorizedInitialization(
        finishAuthorizedInitializationArgs3,
      )
      if (initialized.isErr()) {
        this.lockFailedAuthorization({ deviceIdentityUnlocked })
        state.errorMsg = state.t(initialized.error.translationKey)
        return
      }
    } catch (error) {
      log.warn('PIN device protection setup failed')
      if (initializeSession) {
        const lockFailedAuthorizationArgs3: Parameters<
          DeviceProtectionActions['lockFailedAuthorization']
        >[0] = { deviceIdentityUnlocked }
        this.lockFailedAuthorization(lockFailedAuthorizationArgs3)
      }
      state.errorMsg =
        error instanceof Error ? error.message : 'Failed to create PIN.'
    } finally {
      state.deviceAuthorizationInProgress = false
      state.isVerifying = false
      state.isInitializing = false
    }
  }

  async unlockDeviceProtection({
    initializeSession,
  }: DeviceProtectionUnlockRequest): Promise<void> {
    const state = this.state
    if (!state.hasManager || state.isVerifying) return
    state.isVerifying = true
    state.errorMsg = ''
    let deviceIdentityUnlocked = false
    try {
      const ceremony = await state.enqueueStorage(
        async (): Promise<
          Result<void, PasskeyCeremonyFailure | StorageOperationFailure>
        > => {
          const manager = state.admitManager()
          if (manager.isErr()) return storageErr(manager.error)
          return authorizePasskeyProtection(manager.value)
        },
      )
      if (ceremony.isErr()) {
        this.presentCeremonyFailure(ceremony.error)
        return
      }
      deviceIdentityUnlocked = true
      const finishAuthorizedInitializationArgs4: Parameters<
        DeviceProtectionActions['finishAuthorizedInitialization']
      >[0] = {
        mode: DeviceProtectionStatus.Passkey,
        initializeSession,
      }
      const initialized = await this.finishAuthorizedInitialization(
        finishAuthorizedInitializationArgs4,
      )
      if (initialized.isErr()) {
        this.lockFailedAuthorization({ deviceIdentityUnlocked })
        state.errorMsg = state.t(initialized.error.translationKey)
        return
      }
    } catch (error) {
      if (isPasskeyCeremonyNotAllowedError(error)) {
        const logPasskeyCeremonyArgs9: Parameters<
          DeviceProtectionActions['logPasskeyCeremony']
        >[0] = {
          message: 'passkey authorization did not finish',
          data: sanitizedPasskeyCeremonyData(error),
        }
        this.logPasskeyCeremony(logPasskeyCeremonyArgs9)
        state.errorMsg = state.t(I18N_KEYS.DeviceProtectionPasskeyUnlockNotAllowed)
        return
      }
      const logPasskeyCeremonyArgs10: Parameters<
        DeviceProtectionActions['logPasskeyCeremony']
      >[0] = {
        message: 'passkey device protection unlock failed',
        data: sanitizedPasskeyCeremonyData(error),
      }
      this.logPasskeyCeremony(logPasskeyCeremonyArgs10)
      const lockFailedAuthorizationArgs4: Parameters<
        DeviceProtectionActions['lockFailedAuthorization']
      >[0] = { deviceIdentityUnlocked }
      this.lockFailedAuthorization(lockFailedAuthorizationArgs4)
      state.errorMsg =
        error instanceof Error ? error.message : 'Passkey authorization failed.'
    } finally {
      state.deviceAuthorizationInProgress = false
      state.isVerifying = false
      state.isInitializing = false
    }
  }

  async unlockPinDeviceProtection({
    pin,
    initializeSession,
  }: PinDeviceProtectionUnlockRequest): Promise<void> {
    const state = this.state
    if (!state.hasManager || state.isVerifying) return
    state.isVerifying = true
    state.errorMsg = ''
    let deviceIdentityUnlocked = false
    try {
      const authorization = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.unlock_pin_device_identity(pin),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (authorization.isErr()) {
        state.errorMsg = state.t(authorization.error.translationKey)
        return
      }
      deviceIdentityUnlocked = true
      const finishAuthorizedInitializationArgs5: Parameters<
        DeviceProtectionActions['finishAuthorizedInitialization']
      >[0] = {
        mode: DeviceProtectionStatus.Pin,
        initializeSession,
      }
      const initialized = await this.finishAuthorizedInitialization(
        finishAuthorizedInitializationArgs5,
      )
      if (initialized.isErr()) {
        this.lockFailedAuthorization({ deviceIdentityUnlocked })
        state.errorMsg = state.t(initialized.error.translationKey)
        return
      }
    } catch (error) {
      log.warn('PIN device protection unlock failed')
      const lockFailedAuthorizationArgs5: Parameters<
        DeviceProtectionActions['lockFailedAuthorization']
      >[0] = { deviceIdentityUnlocked }
      this.lockFailedAuthorization(lockFailedAuthorizationArgs5)
      state.errorMsg =
        error instanceof Error ? error.message : 'PIN authorization failed.'
    } finally {
      state.deviceAuthorizationInProgress = false
      state.isVerifying = false
      state.isInitializing = false
    }
  }
}

export class DeviceProtectionRecoveryActions {
  constructor(private readonly state: DeviceProtectionRecoveryState) {}

  private clearQuiescedRecoverySession(): void {
    const state = this.state
    set_vault_session_locked(true)
    state.clearUnlockedSession(false)
    state.deviceId = ''
    state.devicePublicKey = ''
    state.providers = []
    state.providersLoaded = false
    state.githubPat = ''
    state.clearOauthFile()
    state.clearLocalFolder()
    state.storageMode = LOCAL_PROVIDER_TYPE
  }

  private applyPersistedProtectionStatus({
    status,
  }: PersistedProtectionStatusRequest): void {
    const state = this.state
    state.deviceProtectionStatus = status
    state.deviceProtectionLockedStatus =
      status === DeviceProtectionStatus.Pin
        ? DeviceProtectionStatus.Pin
        : DeviceProtectionStatus.Passkey
  }

  private async refreshPersistedProtectionStatus(): Promise<
    Result<void, StorageOperationFailure>
  > {
    const state = this.state
    try {
      const status = await state.enqueueExclusiveStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(await admittedManager.value.device_protection_status())
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (status.isErr()) {
        return storageErr(status.error)
      }
      const statusRequest: PersistedProtectionStatusRequest = {
        status: status.value,
      }
      this.applyPersistedProtectionStatus(statusRequest)
      return storageOk(undefined)
    } finally {
      state.adoptLocalDataStorageGeneration()
    }
  }

  async resetDeviceProtectionForRecovery({
    expectedAppId,
  }: DeviceProtectionRecoveryRequest): Promise<void> {
    const state = this.state
    if (!state.hasManager || state.isVerifying) return
    state.isVerifying = true
    state.errorMsg = ''
    let localRecoveryAttempted = false
    let peerTabsQuiesced = false
    try {
      const quiescence =
        await browserDataLifecycle.quiesceOtherTabsForLocalRecovery()
      if (quiescence.isErr()) {
        state.errorMsg = state.t(quiescence.error.translationKey)
        return
      }
      peerTabsQuiesced = true
      const reset = await (async () => {
        try {
          return await state.enqueueExclusiveStorage(async () => {
            const admitted = state.admitManager()
            if (admitted.isErr()) return storageErr(admitted.error)
            const manager = admitted.value
            let recoveryAppId = expectedAppId
            if (!recoveryAppId) {
              try {
                recoveryAppId = await manager.local_identity_recovery_app_id()
              } catch {
                // Rust admits full recovery when the identity directory cannot be
                // read; an intact keyring still rejects an empty target.
              }
            }
            localRecoveryAttempted = true
            try {
              await manager.reset_device_protection_for_recovery(recoveryAppId)
              return storageOk(await manager.device_protection_status())
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure))
            }
          })
        } finally {
          state.adoptLocalDataStorageGeneration()
        }
      })()
      if (reset.isErr()) {
        log.warn('device protection recovery reset failed')
        if (localRecoveryAttempted) {
          this.clearQuiescedRecoverySession()
          const refreshed = await this.refreshPersistedProtectionStatus()
          if (refreshed.isErr())
            log.warn('could not refresh device protection after recovery failure')
        }
        state.errorMsg = state.t(I18N_KEYS.DeviceProtectionRecoveryFailed)
        return
      }
      this.applyPersistedProtectionStatus({ status: reset.value })
      this.clearQuiescedRecoverySession()
      const recoveryCompleteKey =
        reset.value === DeviceProtectionStatus.Missing
          ? I18N_KEYS.DeviceProtectionRecoveryComplete
          : I18N_KEYS.DeviceProtectionRecoverySurvivorComplete
      state.showSuccess(state.t(recoveryCompleteKey))
    } finally {
      if (peerTabsQuiesced) {
        const reloaded =
          await browserDataLifecycle.reloadQuiescedTabsAfterLocalRecovery()
        if (reloaded.isErr()) {
          state.dismissSuccess()
          state.errorMsg = state.t(reloaded.error.translationKey)
          log.warn('could not reload tabs after device protection recovery')
        }
      }
      state.isVerifying = false
    }
  }
}
