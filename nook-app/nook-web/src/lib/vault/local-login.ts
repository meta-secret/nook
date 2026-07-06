import type { VaultState } from '$lib/vault.svelte'
import type { NookSecretRecord } from '$lib/nook'
import { createLogger } from '$lib/log'
import {
  getActiveVaultId,
  hasActiveLocalVault,
  isVaultPasswordRecommendedLength,
  listLocalVaults,
  prepareNewLocalVaultSlot,
  setActiveVault,
  setLocalVaultLabel,
  type NookVaultManager,
} from '$lib/nook-wasm/nook_wasm'
import { saveAuthProviders } from '$lib/auth-providers'

const log = createLogger('vault-local')

/** Every connected vault must have a non-empty `store_id` in its YAML session. */
export function requireManagerVaultStoreId(manager: NookVaultManager): string {
  const storeId = manager.vaultStoreId.trim()
  if (!storeId) {
    throw new Error('Vault is missing store_id after connect.')
  }
  return storeId
}

export async function refreshLocalVaultCatalog(
  state: VaultState,
): Promise<void> {
  state.localVaults = await listLocalVaults()
  state.localVaultPresent = await hasActiveLocalVault()
  const activeFromWasm = await getActiveVaultId()
  if (activeFromWasm) {
    state.activeVaultStoreId = activeFromWasm
  }
}

export async function prepareLocalLogin(state: VaultState): Promise<void> {
  if (!state.localVaultPresent || state.localLoginPrepared) return
  log.debug('preparing local login gate')
  state.storageMode = 'local'
  state.githubPat = ''
  state.oauthFile = undefined
  state.localFolder = undefined
  await state.refreshPasswordEntriesList()
  state.localLoginPrepared = true
}

export async function selectVaultForUnlock(
  state: VaultState,
  storeId: string,
): Promise<void> {
  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true
  try {
    await setActiveVault(storeId)
    state.activeVaultStoreId = storeId
    if (state.manager) {
      await state.enqueueStorage(() => state.manager!.resetVaultSession())
    }
    state.localVaultPresent = await hasActiveLocalVault()
    state.localLoginPrepared = false
    await state.syncActiveVaultStoreIdToAuth()
    await state.reloadProvidersForActiveVault()
    await state.refreshPasswordEntriesList()
    state.localLoginPrepared = true
  } catch (e: unknown) {
    state.errorMsg = e instanceof Error ? e.message : 'Failed to select vault.'
  } finally {
    state.isVerifying = false
  }
}

export async function createLocalVaultWithDeviceKeys(
  state: VaultState,
  label?: string,
): Promise<void> {
  if (!state.manager) {
    state.errorMsg = 'Vault engine is not available.'
    return
  }
  if (state.isVerifying) return

  const trimmedLabel = label?.trim() ?? ''
  if (!trimmedLabel) {
    state.errorMsg = state.t('login.vault_name_required')
    return
  }

  state.errorMsg = ''
  state.dismissSuccess()
  state.storageMode = 'local'
  state.githubPat = ''
  state.oauthFile = undefined
  state.localFolder = undefined
  state.isVerifying = true

  try {
    await state.initDeviceIdentity()
    const creatingAdditionalVault = state.localVaults.length > 0
    if (creatingAdditionalVault) {
      await prepareNewLocalVaultSlot()
    }
    const rawRecords = (await state.enqueueStorage(() => {
      if (creatingAdditionalVault) {
        state.manager!.resetVaultSession()
        return state.manager!.connect_fresh('local', '', '')
      }
      return state.manager!.connect('local', '', '')
    })) as NookSecretRecord[]
    state.secrets = rawRecords
    state.markVaultUnlocked()
    const storeId = requireManagerVaultStoreId(state.manager)
    state.activeVaultStoreId = storeId
    state.manager.setVaultName(trimmedLabel)
    await setLocalVaultLabel(storeId, trimmedLabel)
    await refreshLocalVaultCatalog(state)
    state.localLoginPrepared = true
    await state.ensureProviderSaved()
    await state.syncActiveVaultStoreIdToAuth()
    await state.hydrateMultiDeviceState()
    log.info('local vault created (device keys)', {
      secrets: rawRecords.length,
      deviceId: state.deviceId,
      storeId,
    })
    state.showSuccess(state.t('toasts.local_loaded'))
    state.startIdleSessionTracking()
    state.startVaultSync()
  } catch (e: unknown) {
    state.isAuthenticated = false
    const message =
      e instanceof Error ? e.message : 'Failed to create local vault.'
    log.warn('local vault create failed', { error: message })
    state.errorMsg = message
  } finally {
    state.isVerifying = false
  }
}

export async function renameLocalVaultLabel(
  state: VaultState,
  storeId: string,
  label: string,
): Promise<void> {
  const trimmedStoreId = storeId.trim()
  const trimmedLabel = label.trim()
  if (!trimmedStoreId) return
  if (!trimmedLabel) {
    state.errorMsg = state.t('login.vault_name_required')
    return
  }

  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true

  try {
    await setLocalVaultLabel(trimmedStoreId, trimmedLabel)
    if (trimmedStoreId === state.activeVaultStoreId?.trim()) {
      state.manager?.setVaultName(trimmedLabel)
    }
    await refreshLocalVaultCatalog(state)
    state.showSuccess(state.t('toasts.vault_renamed'))
  } catch (e: unknown) {
    state.errorMsg = e instanceof Error ? e.message : 'Failed to rename vault.'
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
  if (!isVaultPasswordRecommendedLength(password)) {
    state.errorMsg = state.t('login.password_too_short')
    return
  }

  state.errorMsg = ''
  state.dismissSuccess()
  state.storageMode = 'local'
  state.githubPat = ''
  state.oauthFile = undefined
  state.localFolder = undefined
  state.isVerifying = true

  try {
    await state.initDeviceIdentity()
    const creatingAdditionalVault = state.localVaults.length > 0
    if (creatingAdditionalVault) {
      await prepareNewLocalVaultSlot()
    }
    const rawRecords = (await state.enqueueStorage(() => {
      if (creatingAdditionalVault) {
        state.manager!.resetVaultSession()
        return state.manager!.connect_fresh('local', '', '')
      }
      return state.manager!.connect('local', '', '')
    })) as NookSecretRecord[]
    state.secrets = rawRecords
    state.markVaultUnlocked()
    await state.addVaultPassword(
      state.t('login.master_password_label'),
      password,
    )
    state.activeVaultStoreId = requireManagerVaultStoreId(state.manager)
    await refreshLocalVaultCatalog(state)
    state.localLoginPrepared = true
    await state.ensureProviderSaved()
    await state.syncActiveVaultStoreIdToAuth()
    await state.hydrateMultiDeviceState()
    log.info('local vault created (with backup password)', {
      secrets: rawRecords.length,
    })
    state.showSuccess(state.t('toasts.local_loaded'))
    state.startIdleSessionTracking()
    state.startVaultSync()
  } catch (e: unknown) {
    state.isAuthenticated = false
    const message =
      e instanceof Error ? e.message : 'Failed to create local vault.'
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

export async function syncActiveVaultStoreIdToAuth(
  state: VaultState,
): Promise<void> {
  const storeId = state.activeVaultStoreId?.trim()
  if (!storeId) return
  await state.enqueueStorage(() =>
    saveAuthProviders(state.manager!, {
      providers: state.providers,
      activeVaultStoreId: storeId,
    }),
  )
}
