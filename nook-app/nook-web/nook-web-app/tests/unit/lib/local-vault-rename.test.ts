import { ok } from 'neverthrow'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const wasmMocks = vi.hoisted(() => ({
  getActiveVaultSelection: vi.fn(),
  hasActiveLocalVault: vi.fn(),
  listLocalVaults: vi.fn(),
  prepareNewLocalVaultSlot: vi.fn(),
  setActiveVault: vi.fn(),
  setLocalVaultLabel: vi.fn(),
  setVaultSessionLocked: vi.fn(),
}))

vi.mock('$app-wasm', () => ({
  get_active_vault_selection: wasmMocks.getActiveVaultSelection,
  has_active_local_vault: wasmMocks.hasActiveLocalVault,
  list_local_vaults: wasmMocks.listLocalVaults,
  prepare_new_local_vault_slot: wasmMocks.prepareNewLocalVaultSlot,
  set_active_vault: wasmMocks.setActiveVault,
  set_local_vault_label: wasmMocks.setLocalVaultLabel,
  set_vault_session_locked: wasmMocks.setVaultSessionLocked,
  NookVaultSwitchState: { Switch: 'Switch' },
  VaultRecoveryErrorKind: { Other: 'Other' },
  classify_vault_recovery_error: () => 'Other',
}))

vi.mock('$lib/runtime/log', () => ({
  browserLogRuntime: {
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}))

vi.mock('$lib/vault/login-unlock-capabilities', () => ({
  LoginUnlockPresentation: class {
    async refresh() {
      return ok()
    }
  },
}))

vi.mock('$lib/auth/providers', () => ({
  saveAuthProviders: vi.fn(),
}))
import { VaultLoginActions } from '$lib/vault/local-login'
import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
import type { VaultState } from '$lib/vault.svelte'

describe('renameLocalVaultLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    wasmMocks.setLocalVaultLabel.mockImplementation(async () => {})
  })

  test('keeps a committed manager rename when catalog refresh fails', async () => {
    const setVaultName = vi.fn().mockImplementation(async () => {})
    wasmMocks.listLocalVaults.mockRejectedValue(
      new Error('catalog refresh failed'),
    )
    const state = {
      activeVault: {
        kind: ActiveVaultKind.Open,
        storeId: 'store-1',
      },
      localVaults: [{ storeId: 'store-1', label: 'Old name' }],
      admitManager: () => ok({ set_vault_name: setVaultName }),
      enqueueStorage: <T>(operation: () => T | Promise<T>) =>
        Promise.resolve(operation()),
      dismissSuccess: vi.fn(),
      showSuccess: vi.fn(),
      t: (key: string) => key,
      errorMsg: '',
      isVerifying: false,
    } as unknown as VaultState

    await new VaultLoginActions(state).renameLocalVaultLabel({
      storeId: 'store-1',
      label: 'New name',
    })

    expect(wasmMocks.setLocalVaultLabel).toHaveBeenCalledOnce()
    expect(wasmMocks.setLocalVaultLabel).toHaveBeenCalledWith(
      'store-1',
      'New name',
    )
    expect(setVaultName).toHaveBeenCalledOnce()
    expect(setVaultName).toHaveBeenCalledWith('New name')
    expect(state.errorMsg).toBe(I18N_KEYS.AuthStorageSyncFailed)
    expect(state.isVerifying).toBe(false)
  })
})

describe('selectVaultForUnlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    wasmMocks.setActiveVault.mockImplementation(async () => {})
    wasmMocks.hasActiveLocalVault.mockResolvedValue(true)
  })

  test('prepares the selected vault without protected provider persistence', async () => {
    const syncActiveVaultStoreIdToAuth = vi.fn(async () => ok())
    const reloadProvidersForActiveVault = vi.fn(async () => ok())
    const state = {
      hasManager: false,
      errorMsg: '',
      isVerifying: false,
      localLoginPreparation: 'idle',
      localVaultPresent: true,
      dismissSuccess: vi.fn(),
      openActiveVault: vi.fn(),
      refreshPasswordEntriesList: vi.fn(async () => ok()),
      syncActiveVaultStoreIdToAuth,
      reloadProvidersForActiveVault,
    } as unknown as VaultState

    const selected = await new VaultLoginActions(state).selectVaultForUnlock({
      storeId: 'store-2',
    })

    expect(selected.isOk()).toBe(true)
    expect(wasmMocks.setActiveVault).toHaveBeenCalledWith('store-2')
    expect(state.openActiveVault).toHaveBeenCalledWith('store-2')
    expect(syncActiveVaultStoreIdToAuth).not.toHaveBeenCalled()
    expect(reloadProvidersForActiveVault).not.toHaveBeenCalled()
  })
})
