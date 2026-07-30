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
  ...wasmMocks,
  NookVaultSwitchState: { Switch: 'Switch' },
}))

vi.mock('$lib/log', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('$lib/auth-providers', () => ({
  saveAuthProviders: vi.fn(),
}))

import { renameLocalVaultLabel } from '$lib/vault/local-login'
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
      requireManager: () => ({ setVaultName }),
      enqueueStorage: <T>(operation: () => T | Promise<T>) =>
        Promise.resolve(operation()),
      dismissSuccess: vi.fn(),
      showSuccess: vi.fn(),
      t: (key: string) => key,
      errorMsg: '',
      isVerifying: false,
    } as unknown as VaultState

    await renameLocalVaultLabel(state, 'store-1', 'New name')

    expect(wasmMocks.setLocalVaultLabel).toHaveBeenCalledOnce()
    expect(wasmMocks.setLocalVaultLabel).toHaveBeenCalledWith(
      'store-1',
      'New name',
    )
    expect(setVaultName).toHaveBeenCalledOnce()
    expect(setVaultName).toHaveBeenCalledWith('New name')
    expect(state.errorMsg).toBe('catalog refresh failed')
    expect(state.isVerifying).toBe(false)
  })
})
