import type { VaultState } from '$lib/vault.svelte'
import type { NookSecretRecord } from '$lib/nook'
import { createLogger } from '$lib/log'
import {
  hasActiveLocalVault,
  listLocalVaultEntries,
  prepareCreateNewVaultSlot,
  readActiveVaultStoreId,
  renameLocalVault,
  switchActiveVault,
} from '$lib/local-vault'
import { saveAuthProviders } from '$lib/auth-providers'
import { requireManagerVaultStoreId } from '$lib/vault-store-id'

const log = createLogger('vault-local')

export async function refreshLocalVaultCatalog(
  state: VaultState,
): Promise<void> {
  state.localVaults = await listLocalVaultEntries()
  state.localVaultPresent = await hasActiveLocalVault()
  const activeFromWasm = await readActiveVaultStoreId()
  if (activeFromWasm) {
    state.activeVaultStoreId = activeFromWasm
  }
}

export async function prepareLocalLogin(state: VaultState): Promise<void> {
  if (!state.localVaultPresent || state.localLoginPrepared) return
  log.debug('preparing local login gate')
  state.storageMode = 'local'
  state.githubPat = ''
  state.oauthFile = null
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
    await switchActiveVault(storeId)
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
  state.oauthFile = null
  state.isVerifying = true

  try {
    await state.initDeviceIdentity()
    const creatingAdditionalVault = state.localVaults.length > 0
    if (creatingAdditionalVault) {
      await prepareCreateNewVaultSlot()
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
    await renameLocalVault(storeId, trimmedLabel)
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
    const creatingAdditionalVault = state.localVaults.length > 0
    if (creatingAdditionalVault) {
      await prepareCreateNewVaultSlot()
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
