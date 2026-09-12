import { ok, type Result } from 'neverthrow'
import { NookLocalVaultUnlockState } from '$app-wasm'
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
const unlockPresentationRefresh = vi.hoisted(() =>
  vi.fn<() => Promise<Result<void, never>>>(),
)

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
      return unlockPresentationRefresh()
    }
  },
}))

vi.mock('$lib/auth/providers', () => ({
  activeVaultScope: vi.fn(),
  AuthProviderPersistence: class {
    async save() {
      return ok()
    }
  },
}))
import { VaultLoginActions } from '$lib/vault/local-login'
import { NookVaultManager } from '$app-wasm'
import { LocalLoginPreparationState } from '$lib/vault/state/provider.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
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
    const state = VaultStateTestFixture.create()
    state.openActiveVault('store-1')
    state.localVaults = [
      {
        storeId: 'store-1',
        label: 'Old name',
        lastUnlockedAt: '',
        unlockState: NookLocalVaultUnlockState.NeverUnlocked,
        display_label: () => 'Old name',
        free: vi.fn(),
        [Symbol.dispose]: vi.fn(),
      },
    ]
    const manager = new NookVaultManager()
    manager.set_vault_name = setVaultName
    state.openManager(manager)
    state.dismissSuccess = vi.fn()
    state.showSuccess = vi.fn()
    state.t = (request: Parameters<VaultState['t']>[0]) =>
      typeof request === 'string' ? request : request.key
    state.errorMsg = ''
    state.isVerifying = false

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
    unlockPresentationRefresh.mockResolvedValue(ok())
  })

  test('prepares the selected vault without protected provider or identity access', async () => {
    const syncActiveVaultStoreIdToAuth = vi.fn(async () => ok())
    const reloadProvidersForActiveVault = vi.fn(async () => ok())
    const state = VaultStateTestFixture.create()
    state.clearManager()
    state.errorMsg = ''
    state.isVerifying = false
    state.localLoginPreparation = LocalLoginPreparationState.Idle
    state.localVaultPresent = true
    state.dismissSuccess = vi.fn()
    state.openActiveVault = vi.fn()
    state.refreshPasswordEntriesList = vi.fn(async () => ok())
    state.syncActiveVaultStoreIdToAuth = syncActiveVaultStoreIdToAuth
    state.reloadProvidersForActiveVault = reloadProvidersForActiveVault

    const selected = await new VaultLoginActions(state).selectVaultForUnlock({
      storeId: 'store-2',
    })

    expect(selected.isOk()).toBe(true)
    expect(wasmMocks.setActiveVault).toHaveBeenCalledWith('store-2')
    expect(state.openActiveVault).toHaveBeenCalledWith('store-2')
    expect(syncActiveVaultStoreIdToAuth).not.toHaveBeenCalled()
    expect(reloadProvidersForActiveVault).not.toHaveBeenCalled()
    expect(unlockPresentationRefresh).not.toHaveBeenCalled()
  })
})
