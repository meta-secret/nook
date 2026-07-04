import type { VaultState } from '$lib/vault.svelte'
import { isoTimestamp, type NookSecretRecord } from '$lib/nook'
import { createLogger } from '$lib/log'

const log = createLogger('vault-devices')

export async function refreshDeviceState(state: VaultState) {
  await state.manualSync()
}

export async function refreshPendingJoinsFromProviders(state: VaultState) {
  await state.hydrateMultiDeviceState()
}

export async function requestVaultAccess(state: VaultState) {
  if (!state.manager) return
  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true
  try {
    await state.enqueueStorage(() =>
      state.manager!.request_vault_access(
        ...state.wasmStorageArgs(),
        isoTimestamp(),
      ),
    )
    await state.ensureProviderSaved()
    await state.refreshDeviceState()
    if (state.localVaultPresent && state.syncProviders.length > 0) {
      state.scheduleFanOutSyncAfterLocalSave()
    } else {
      state.scheduleRemoteEventOutboxFlush()
    }
    state.showSuccess(state.t('login.join_request_sent'))
    log.info('join request sent', { deviceId: state.deviceId })
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : 'Failed to request vault access.'
  } finally {
    state.isVerifying = false
  }
}

export async function approveJoin(state: VaultState, joinDeviceId: string) {
  if (!state.manager) return
  state.errorMsg = ''
  state.dismissSuccess()
  state.isSaving = true
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.approve_join_request(joinDeviceId),
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    await state.flushRemoteEventOutboxNow()
    await state.hydrateMultiDeviceState()
    state.pendingJoins = state.pendingJoins.filter(
      (entry) => entry.deviceId !== joinDeviceId,
    )
    await state.fanOutSyncToProviders({ quiet: true })
    state.pendingJoins = state.pendingJoins.filter(
      (entry) => entry.deviceId !== joinDeviceId,
    )
    state.showSuccess(state.t('toasts.device_approved_success'))
    log.info('join request approved', { joinDeviceId })
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : 'Failed to approve join request.'
  } finally {
    state.isSaving = false
  }
}

export async function denyJoin(state: VaultState, joinDeviceId: string) {
  if (!state.manager) return
  state.errorMsg = ''
  state.dismissSuccess()
  state.isSaving = true
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.deny_join_request(joinDeviceId),
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    await state.hydrateMultiDeviceState()
    state.scheduleFanOutSyncAfterLocalSave()
    state.showSuccess(state.t('toasts.join_denied'))
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : 'Failed to deny join request.'
  } finally {
    state.isSaving = false
  }
}

export async function renameDevice(
  state: VaultState,
  authId: string,
  label: string,
) {
  if (!state.manager) return
  state.errorMsg = ''
  state.dismissSuccess()
  state.isSaving = true
  try {
    await state.enqueueStorage(() =>
      state.manager!.rename_vault_member(authId, label),
    )
    await state.hydrateMultiDeviceState()
    state.scheduleFanOutSyncAfterLocalSave()
    state.showSuccess(
      label.trim()
        ? state.t('toasts.device_renamed')
        : state.t('toasts.device_name_reset'),
    )
  } catch (e: unknown) {
    state.errorMsg = e instanceof Error ? e.message : 'Failed to rename device.'
    throw e
  } finally {
    state.isSaving = false
  }
}

export async function revokeDevice(state: VaultState, authId: string) {
  if (!state.manager) return
  const isSelf = state.vaultMembers.some(
    (member) => member.authId === authId && member.deviceId === state.deviceId,
  )
  state.errorMsg = ''
  state.dismissSuccess()
  state.isSaving = true
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.revoke_vault_member(authId),
    )) as NookSecretRecord[]
    if (isSelf) {
      state.clearUnlockedSession()
      state.showSuccess(state.t('toasts.device_removed'))
      return
    }
    state.secrets = rawRecords
    await state.hydrateMultiDeviceState()
    state.scheduleFanOutSyncAfterLocalSave()
    state.showSuccess(state.t('toasts.device_revoked'))
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : 'Failed to revoke device access.'
    throw e
  } finally {
    state.isSaving = false
  }
}

export async function confirmJoinRequest(state: VaultState) {
  if (!state.manager) return
  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true
  try {
    const storageArgs =
      state.remoteEventProviderArgs() ?? state.wasmStorageArgs()
    await state.enqueueStorage(() =>
      state.manager!.request_vault_access(...storageArgs, isoTimestamp()),
    )
    await state.ensureProviderSaved()
    state.joinEnrollmentPrompt = 'pending'
    state.awaitingJoinApproval = true
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : 'Failed to request vault access.'
  } finally {
    state.isVerifying = false
  }
}

export function dismissJoinEnrollment(state: VaultState) {
  state.joinEnrollmentPrompt = 'none'
}

export async function enrollAndConnect(state: VaultState) {
  if (!state.manager) return
  const secretsKey = state.enrollSecretsKey.trim()
  const membersKey = state.enrollMembersKey.trim()
  if (!secretsKey || !membersKey) return

  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.enroll_and_connect(
        ...state.wasmStorageArgs(),
        secretsKey,
        membersKey,
      ),
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    state.markVaultUnlocked()
    state.enrollSecretsKey = ''
    state.enrollMembersKey = ''
    await state.ensureProviderSaved()
    void state.hydrateMultiDeviceState()
    await state.syncFromStorage()
    state.showSuccess(state.t('toasts.enrolled_connected'))
    log.info('enrolled and connected', {
      secrets: rawRecords.length,
      mode: state.storageMode,
    })
    state.joinEnrollmentPrompt = 'none'
    state.closeSettings()
    state.startIdleSessionTracking()
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : 'Failed to enroll with vault keys.'
  } finally {
    state.isVerifying = false
  }
}
