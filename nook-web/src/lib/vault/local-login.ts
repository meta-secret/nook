import type { VaultState } from '$lib/vault.svelte'
import type { NookSecretRecord } from '$lib/nook'
import {
  hasActiveLocalVault,
  listLocalVaultEntries,
  prepareCreateNewVaultSlot,
  readActiveVaultStoreId,
  switchActiveVault,
} from '$lib/local-vault'
import { saveAuthProviders } from '$lib/auth-providers'

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
    state.manager?.resetVaultSession()
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
    const creatingAdditionalVault = state.localVaults.length > 0
    if (creatingAdditionalVault) {
      await prepareCreateNewVaultSlot()
      state.manager.resetVaultSession()
    }
    const connect = creatingAdditionalVault
      ? state.manager.connect_fresh('local', '', '')
      : state.manager.connect('local', '', '')
    const rawRecords = (await state.enqueueStorage(
      () => connect,
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    state.markVaultUnlocked()
    state.activeVaultStoreId = state.manager.vaultStoreId?.trim() || null
    await refreshLocalVaultCatalog(state)
    state.localLoginPrepared = true
    await state.ensureProviderSaved()
    await state.syncActiveVaultStoreIdToAuth()
    await state.hydrateMultiDeviceState()
    state.showSuccess(state.t('toasts.local_loaded'))
    state.startVaultSync()
  } catch (e: unknown) {
    state.isAuthenticated = false
    state.errorMsg =
      e instanceof Error ? e.message : 'Failed to create local vault.'
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
      state.manager.resetVaultSession()
    }
    const connect = creatingAdditionalVault
      ? state.manager.connect_fresh('local', '', '')
      : state.manager.connect('local', '', '')
    const rawRecords = (await state.enqueueStorage(
      () => connect,
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    state.markVaultUnlocked()
    await state.addVaultPassword(
      state.t('login.master_password_label'),
      password,
    )
    state.activeVaultStoreId = state.manager.vaultStoreId?.trim() || null
    await refreshLocalVaultCatalog(state)
    state.localLoginPrepared = true
    await state.ensureProviderSaved()
    await state.syncActiveVaultStoreIdToAuth()
    await state.hydrateMultiDeviceState()
    state.showSuccess(state.t('toasts.local_loaded'))
    state.startVaultSync()
  } catch (e: unknown) {
    state.isAuthenticated = false
    state.errorMsg =
      e instanceof Error ? e.message : 'Failed to create local vault.'
  } finally {
    state.isVerifying = false
  }
}

export async function probeLoginUnlockMode(state: VaultState): Promise<void> {
  await state.refreshPasswordEntriesList()
}

export async function syncActiveVaultStoreIdToAuth(
  state: VaultState,
): Promise<void> {
  const storeId = state.activeVaultStoreId?.trim()
  if (!storeId) return
  await saveAuthProviders({
    providers: state.providers,
    activeVaultStoreId: storeId,
  })
}
