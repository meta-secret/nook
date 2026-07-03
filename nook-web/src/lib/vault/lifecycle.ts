import type { VaultState } from '$lib/vault.svelte'
import type { NookSecretRecord } from '$lib/nook'
import { prepareCreateNewVaultSlot } from '$lib/local-vault'
import * as localLoginActions from '$lib/vault/local-login'

export async function init(state: VaultState) {
  if (state.initPromise) {
    return state.initPromise
  }
  state.initPromise = state.initOnce()
  return state.initPromise
}

export function waitForStorageChain(state: VaultState): Promise<void> {
  return state.storageChain.then(() => undefined)
}

export function resetStorageChain(state: VaultState): void {
  state.storageChain = Promise.resolve()
}

export async function createFreshVault(state: VaultState) {
  if (!state.manager) return
  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true
  try {
    await state.initDeviceIdentity()
    const creatingAdditionalVault = state.localVaults.length > 0
    if (creatingAdditionalVault) {
      await prepareCreateNewVaultSlot()
      state.manager.resetVaultSession()
    }
    const rawRecords = await state.enqueueStorage(async () => {
      const connectPromise = state.manager!.connect_fresh(
        ...state.wasmStorageArgs(),
      )
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                'Connection timed out. Check your PAT, network, and try again.',
              ),
            ),
          30_000,
        )
      })
      return (await Promise.race([
        connectPromise,
        timeoutPromise,
      ])) as NookSecretRecord[]
    })
    state.secrets = rawRecords
    state.markVaultUnlocked()
    state.activeVaultStoreId = state.manager.vaultStoreId?.trim() || null
    await localLoginActions.refreshLocalVaultCatalog(state)
    await state.ensureProviderSaved()
    await state.syncActiveVaultStoreIdToAuth()
    await state.hydrateMultiDeviceState()
    state.joinEnrollmentPrompt = 'none'
    state.showSuccess(state.t('toasts.vault_created'))
  } catch (e: unknown) {
    state.isAuthenticated = false
    state.errorMsg =
      e instanceof Error ? e.message : 'Failed to create a new vault.'
  } finally {
    state.isVerifying = false
  }
}
