import type { VaultState } from '$lib/vault.svelte'
import type { NookSecretRecord } from '$lib/nook'
import { createLogger } from '$lib/log'

const log = createLogger('vault-local')

export async function prepareLocalLogin(state: VaultState): Promise<void> {
  if (!state.localVaultPresent || state.localLoginPrepared) return
  log.debug('preparing local login gate')
  state.storageMode = 'local'
  state.githubPat = ''
  state.oauthFile = null
  await state.refreshPasswordEntriesList()
  state.localLoginPrepared = true
}

export async function createLocalVaultWithDeviceKeys(
  state: VaultState,
): Promise<void> {
  if (!state.manager) {
    state.errorMsg = 'Vault engine is not available.'
    return
  }
  if (state.isVerifying) return

  state.errorMsg = ''
  state.dismissSuccess()
  state.storageMode = 'local'
  state.githubPat = ''
  state.oauthFile = null
  state.isVerifying = true

  try {
    await state.initDeviceIdentity()
    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.connect('local', '', ''),
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    state.markVaultUnlocked()
    state.localVaultPresent = true
    state.localLoginPrepared = true
    await state.ensureProviderSaved()
    await state.hydrateMultiDeviceState()
    log.info('local vault created (device keys)', {
      secrets: rawRecords.length,
      deviceId: state.deviceId,
    })
    state.showSuccess(state.t('toasts.local_loaded'))
    state.startVaultSync()
  } catch (e: unknown) {
    state.isAuthenticated = false
    const message = e instanceof Error ? e.message : 'Failed to create local vault.'
    log.warn('local vault create failed', { error: message })
    state.errorMsg = message
  } finally {
    state.isVerifying = false
  }
}

export async function createLocalVault(
  state: VaultState,
  password: string,
): Promise<void> {
  if (!state.manager) {
    state.errorMsg = 'Vault engine is not available.'
    return
  }
  if (state.isVerifying) return
  if (password.trim().length < 8) {
    state.errorMsg = state.t('login.password_too_short')
    return
  }

  state.errorMsg = ''
  state.dismissSuccess()
  state.storageMode = 'local'
  state.githubPat = ''
  state.oauthFile = null
  state.isVerifying = true

  try {
    await state.initDeviceIdentity()
    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.connect('local', '', ''),
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    state.markVaultUnlocked()
    await state.addVaultPassword(
      state.t('login.master_password_label'),
      password,
    )
    state.localVaultPresent = true
    state.localLoginPrepared = true
    await state.ensureProviderSaved()
    await state.hydrateMultiDeviceState()
    log.info('local vault created (with backup password)', {
      secrets: rawRecords.length,
    })
    state.showSuccess(state.t('toasts.local_loaded'))
    state.startVaultSync()
  } catch (e: unknown) {
    state.isAuthenticated = false
    const message = e instanceof Error ? e.message : 'Failed to create local vault.'
    log.warn('local vault create failed', { error: message })
    state.errorMsg = message
  } finally {
    state.isVerifying = false
  }
}

export async function probeLoginUnlockMode(state: VaultState): Promise<void> {
  log.debug('probing login unlock mode')
  await state.refreshPasswordEntriesList()
}
