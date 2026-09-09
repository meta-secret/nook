import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import type { OAuthFailure } from '$lib/auth/oauth-failure'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { err as storageErr, ok as storageOk, type Result } from 'neverthrow'
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from '$lib/runtime/storage-failure'
import { I18N_KEYS } from '../../../generated/i18n-keys'
import type { VaultState } from '$lib/vault.svelte'
import { isoTimestamp } from '$lib/nook'
import { browserLogRuntime } from '$lib/runtime/log'
import {
  JoinEnrollmentState,
  ProviderSyncFreshness,
  ProviderSyncVisibility,
} from '$app-wasm'
import {
  EventOutboxRequestKind,
  EventOutboxTargetKind,
  type EventOutboxRequest,
} from '$lib/vault/sync-operation-state'

const log = browserLogRuntime.createLogger('vault-devices')

type DeviceJoinApproval = {
  readonly joinDeviceId: string
}

type DeviceJoinDenial = {
  readonly joinDeviceId: string
}

type DeviceRename = {
  readonly authId: string
  readonly label: string
}

type DeviceRevocation = {
  readonly authId: string
}

export type DeviceMutationResult = Result<
  void,
  StorageOperationFailure | OAuthFailure
>

/** Owns browser orchestration for one multi device context. */
export class VaultDeviceActions {
  constructor(private readonly state: VaultState) {}

  async refreshDeviceState() {
    const state = this.state
    return state.manualSync()
  }

  async refreshPendingJoinsFromProviders() {
    const state = this.state
    const rosterRefresh1 = await state.hydrateMultiDeviceState()
    if (rosterRefresh1.isErr()) {
      state.errorMsg = state.t(rosterRefresh1.error.translationKey)
      return
    }
  }

  async approveJoin({ joinDeviceId }: DeviceJoinApproval) {
    const state = this.state
    if (!state.hasManager) return
    state.errorMsg = ''
    state.dismissSuccess()
    state.isSaving = true
    try {
      const rawRecords = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.approve_join_request(joinDeviceId),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (rawRecords.isErr()) {
        state.errorMsg = state.t(rawRecords.error.translationKey)
        return
      }
      for (const record of rawRecords.value) record.free()
      const secretRefresh1 = await state.refreshSecretsFromSession()
      if (secretRefresh1.isErr()) {
        state.errorMsg = state.t(secretRefresh1.error.translationKey)
        return
      }
      const request: EventOutboxRequest = {
        kind: EventOutboxRequestKind.Default,
      }
      const flushed = await state.flushRemoteEventOutboxNow(request)
      if (flushed.isErr()) {
        state.errorMsg = state.t(flushed.error.translationKey)
        return
      }
      const rosterRefresh2 = await state.hydrateMultiDeviceState()
      if (rosterRefresh2.isErr()) {
        state.errorMsg = state.t(rosterRefresh2.error.translationKey)
        return
      }
      state.pendingJoins = state.pendingJoins.filter(
        (entry) => entry.deviceId !== joinDeviceId,
      )
      const synchronized = await state.fanOutSyncToProviders(
        ProviderSyncVisibility.Quiet,
      )
      if (synchronized.isErr()) {
        state.errorMsg = state.t(synchronized.error.translationKey)
        return
      }
      if (synchronized.value !== ProviderSyncOutcome.Synced) return
      state.pendingJoins = state.pendingJoins.filter(
        (entry) => entry.deviceId !== joinDeviceId,
      )
      state.showSuccess(state.t(I18N_KEYS.ToastsDeviceApproved))
      log.info('join request approved')
    } catch (e) {
      state.errorMsg =
        e instanceof Error ? e.message : 'Failed to approve join request.'
    } finally {
      state.isSaving = false
    }
  }

  async denyJoin({ joinDeviceId }: DeviceJoinDenial) {
    const state = this.state
    if (!state.hasManager) return
    state.errorMsg = ''
    state.dismissSuccess()
    state.isSaving = true
    try {
      const rawRecords = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.deny_join_request(joinDeviceId),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (rawRecords.isErr()) {
        state.errorMsg = state.t(rawRecords.error.translationKey)
        return
      }
      for (const record of rawRecords.value) record.free()
      const secretRefresh2 = await state.refreshSecretsFromSession()
      if (secretRefresh2.isErr()) {
        state.errorMsg = state.t(secretRefresh2.error.translationKey)
        return
      }
      const rosterRefresh3 = await state.hydrateMultiDeviceState()
      if (rosterRefresh3.isErr()) {
        state.errorMsg = state.t(rosterRefresh3.error.translationKey)
        return
      }
      state.scheduleFanOutSyncAfterLocalSave()
      state.showSuccess(state.t(I18N_KEYS.ToastsJoinDenied))
    } catch (e) {
      state.errorMsg =
        e instanceof Error ? e.message : 'Failed to deny join request.'
    } finally {
      state.isSaving = false
    }
  }

  async renameDevice({
    authId,
    label,
  }: DeviceRename): Promise<DeviceMutationResult> {
    const state = this.state
    if (!state.hasManager)
      return storageErr(
        new StorageOperationFailure(StorageOperationFailureKind.ManagerUnavailable),
      )
    state.errorMsg = ''
    state.dismissSuccess()
    state.isSaving = true
    try {
      const storageOutcome = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.rename_vault_member(authId, label),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (storageOutcome.isErr()) {
        state.errorMsg = state.t(storageOutcome.error.translationKey)
        return storageErr(storageOutcome.error)
      }
      const rosterRefresh4 = await state.hydrateMultiDeviceState()
      if (rosterRefresh4.isErr()) {
        return storageErr(rosterRefresh4.error)
      }
      state.scheduleFanOutSyncAfterLocalSave()
      state.showSuccess(
        label.trim()
          ? state.t(I18N_KEYS.ToastsDeviceRenamed)
          : state.t(I18N_KEYS.ToastsDeviceNameReset),
      )
      return storageOk(undefined)
    } finally {
      state.isSaving = false
    }
  }

  async revokeDevice({ authId }: DeviceRevocation): Promise<DeviceMutationResult> {
    const state = this.state
    if (!state.hasManager)
      return storageErr(
        new StorageOperationFailure(StorageOperationFailureKind.ManagerUnavailable),
      )
    const isSelf = state.vaultMembers.some(
      (member) => member.authId === authId && member.deviceId === state.deviceId,
    )
    state.errorMsg = ''
    state.dismissSuccess()
    state.isSaving = true
    try {
      const rawRecords = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(await admittedManager.value.revoke_vault_member(authId))
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (rawRecords.isErr()) {
        state.errorMsg = state.t(rawRecords.error.translationKey)
        return storageErr(rawRecords.error)
      }
      for (const record of rawRecords.value) record.free()
      if (isSelf) {
        state.clearUnlockedSession()
        state.showSuccess(state.t(I18N_KEYS.ToastsDeviceRemoved))
        return storageOk(undefined)
      }
      const secretRefresh3 = await state.refreshSecretsFromSession()
      if (secretRefresh3.isErr()) {
        state.errorMsg = state.t(secretRefresh3.error.translationKey)
        return storageErr(secretRefresh3.error)
      }
      const rosterRefresh5 = await state.hydrateMultiDeviceState()
      if (rosterRefresh5.isErr()) {
        return storageErr(rosterRefresh5.error)
      }
      state.scheduleFanOutSyncAfterLocalSave()
      state.showSuccess(state.t(I18N_KEYS.ToastsDeviceRevoked))
      return storageOk(undefined)
    } finally {
      state.isSaving = false
    }
  }

  async confirmJoinRequest() {
    const state = this.state
    if (!state.hasManager) return
    state.errorMsg = ''
    state.dismissSuccess()
    state.isVerifying = true
    try {
      const request: EventOutboxRequest = {
        kind: EventOutboxRequestKind.Default,
      }
      const target = state.eventOutboxTarget(request)
      const storageArgs =
        target.kind === EventOutboxTargetKind.Remote
          ? target.args
          : state.wasmStorageArgs()
      const storageOutcome = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.request_vault_access(
              storageArgs.mode,
              storageArgs.pat,
              storageArgs.repo,
              isoTimestamp(),
            ),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (storageOutcome.isErr()) {
        state.errorMsg = state.t(storageOutcome.error.translationKey)
        return
      }
      const savedProvider1 = await state.ensureProviderSaved()
      if (savedProvider1.isErr()) {
        state.errorMsg = state.t(savedProvider1.error.translationKey)
        return
      }
      state.joinEnrollmentPrompt = JoinEnrollmentState.Pending
      state.awaitingJoinApproval = true
    } catch (e) {
      state.errorMsg =
        e instanceof Error ? e.message : 'Failed to request vault access.'
    } finally {
      state.isVerifying = false
    }
  }

  dismissJoinEnrollment() {
    const state = this.state
    state.joinEnrollmentPrompt = JoinEnrollmentState.None
  }

  async enrollAndConnect() {
    const state = this.state
    if (!state.hasManager) return
    const secretsKey = state.enrollSecretsKey.trim()
    const membersKey = state.enrollMembersKey.trim()
    if (!secretsKey || !membersKey) return

    state.errorMsg = ''
    state.dismissSuccess()
    state.isVerifying = true
    try {
      const storageArgs = state.wasmStorageArgs()
      const rawRecords = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager()
        if (admittedManager.isErr()) return storageErr(admittedManager.error)
        try {
          return storageOk(
            await admittedManager.value.enroll_and_connect(
              storageArgs.mode,
              storageArgs.pat,
              storageArgs.repo,
              secretsKey,
              membersKey,
            ),
          )
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure))
        }
      })
      if (rawRecords.isErr()) {
        state.errorMsg = state.t(rawRecords.error.translationKey)
        return
      }
      for (const record of rawRecords.value) record.free()
      const loadPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
        query: '',
        requestedOffset: 0,
      }
      const secretRefresh4 = await state.loadSecretPage(loadPageArgs)
      if (secretRefresh4.isErr()) {
        state.errorMsg = state.t(secretRefresh4.error.translationKey)
        return
      }
      const unlocked = state.markVaultUnlocked()
      if (unlocked.isErr()) {
        state.errorMsg = state.t(unlocked.error.translationKey)
        return
      }
      state.enrollSecretsKey = ''
      state.enrollMembersKey = ''
      const savedProvider2 = await state.ensureProviderSaved()
      if (savedProvider2.isErr()) {
        state.errorMsg = state.t(savedProvider2.error.translationKey)
        return
      }
      const rosterRefresh6 = await state.hydrateMultiDeviceState()
      if (rosterRefresh6.isErr()) {
        state.errorMsg = state.t(rosterRefresh6.error.translationKey)
        return
      }
      const synchronized = await state.syncFromStorage(
        ProviderSyncFreshness.Scheduled,
      )
      if (synchronized.isErr()) {
        state.errorMsg = state.t(synchronized.error.translationKey)
        return
      }
      if (synchronized.value !== ProviderSyncOutcome.Synced) return
      state.showSuccess(state.t(I18N_KEYS.ToastsEnrolledConnected))
      log.info('enrolled and connected')
      state.joinEnrollmentPrompt = JoinEnrollmentState.None
      state.closeSettings()
      state.startIdleSessionTracking()
    } catch (e) {
      state.errorMsg =
        e instanceof Error ? e.message : 'Failed to enroll with vault keys.'
    } finally {
      state.isVerifying = false
    }
  }
}
