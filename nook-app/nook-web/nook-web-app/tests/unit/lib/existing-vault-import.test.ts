import { ok } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import { JoinEnrollmentState, NookLocalVaultUnlockState } from '$app-wasm'
import { LOCAL_PROVIDER_TYPE } from '$lib/auth/providers'
import { ExistingVaultImportQueueKind } from '$lib/vault/creation-queue'
import { ExistingVaultImportLifecycle } from '$lib/vault/existing-vault-import.svelte'
import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import type { VaultState } from '$lib/vault.svelte'

function lifecycleHarness(authenticated = false) {
  const state = VaultStateTestFixture.create()
  state.activateLoginSetup(LOCAL_PROVIDER_TYPE)
  state.clearOauthFile()
  state.clearLocalFolder()
  state.githubPat = ''
  state.githubRepo = ''
  state.openActiveVault('current-vault')
  state.localVaults = [
    {
      storeId: 'incoming-vault',
      label: 'Incoming vault',
      lastUnlockedAt: '',
      unlockState: NookLocalVaultUnlockState.NeverUnlocked,
      display_label: () => 'Incoming vault',
      free: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    },
  ]
  state.isAuthenticated = authenticated
  state.errorMsg = ''
  state.loginRequiresExistingVault = false
  state.storageMode = LOCAL_PROVIDER_TYPE
  state.clearExistingVaultRecoverySummary()
  state.loginPasswordPrompt = true
  state.joinEnrollmentPrompt = JoinEnrollmentState.None
  state.sentinelCeremonyPrompt = false
  state.t = (request: Parameters<VaultState['t']>[0]) =>
    typeof request === 'string' ? request : request.key
  const activateLoginSetupImplementation = state.activateLoginSetup.bind(state)
  const clearUnlockedSession = vi.spyOn(state, 'clearUnlockedSession')
  const selectVaultForUnlock = vi.spyOn(state, 'selectVaultForUnlock')
  const activateLoginSetup = vi.spyOn(state, 'activateLoginSetup')
  const unlockWithPassword = vi.spyOn(state, 'unlockWithPassword')
  const clearOauthFile = vi.spyOn(state, 'clearOauthFile')
  const clearLocalFolder = vi.spyOn(state, 'clearLocalFolder')
  const connectStagedProvider = vi
    .spyOn(state, 'connectStagedProvider')
    .mockResolvedValue()
  const activateConnectedExistingVault = vi
    .spyOn(state, 'activateConnectedExistingVault')
    .mockResolvedValue(ok())
  const clearExistingVaultRecoverySummary = vi.spyOn(
    state,
    'clearExistingVaultRecoverySummary',
  )
  const beginLoginVaultPicker = vi.spyOn(state, 'beginLoginVaultPicker')

  clearUnlockedSession.mockImplementation(() => {
    state.isAuthenticated = false
  })
  selectVaultForUnlock.mockImplementation(async (storeId: string) => {
    state.openActiveVault(storeId)
    return ok()
  })
  activateLoginSetup.mockImplementation((providerType) => {
    activateLoginSetupImplementation(providerType)
  })
  unlockWithPassword.mockImplementation(async () => {
    state.isAuthenticated = true
  })

  return {
    state,
    lifecycle: new ExistingVaultImportLifecycle(state),
    clearOauthFile,
    clearLocalFolder,
    connectStagedProvider,
    activateConnectedExistingVault,
    clearExistingVaultRecoverySummary,
    beginLoginVaultPicker,
  }
}

describe('ExistingVaultImportLifecycle', () => {
  test('resumes a protected import and activates it after password unlock', async () => {
    const {
      state,
      lifecycle,
      clearOauthFile,
      clearLocalFolder,
      connectStagedProvider,
      activateConnectedExistingVault,
      clearExistingVaultRecoverySummary,
    } = lifecycleHarness(true)

    lifecycle.remember('incoming-vault')
    expect(lifecycle.queue).toMatchObject({
      kind: ExistingVaultImportQueueKind.WaitingForDevice,
      request: {
        storeId: 'incoming-vault',
        previousActiveVault: {
          kind: ActiveVaultKind.Open,
          storeId: 'current-vault',
        },
        provider: { setupType: LOCAL_PROVIDER_TYPE },
      },
    })

    await lifecycle.resume()

    expect(state.clearUnlockedSession).toHaveBeenCalledOnce()
    expect(state.selectVaultForUnlock).toHaveBeenCalledWith('incoming-vault')
    expect(state.activateLoginSetup).toHaveBeenCalledWith(LOCAL_PROVIDER_TYPE)
    expect(clearOauthFile).toHaveBeenCalledOnce()
    expect(clearLocalFolder).toHaveBeenCalledOnce()
    expect(connectStagedProvider).toHaveBeenCalledOnce()
    expect(lifecycle.waitingForDevice).toBe(true)

    await lifecycle.unlockWithPassword({
      entryId: 'password-entry',
      password: 'vault-password',
    })

    expect(state.unlockWithPassword).toHaveBeenCalledWith({
      entryId: 'password-entry',
      password: 'vault-password',
    })
    expect(activateConnectedExistingVault).toHaveBeenCalledWith(
      'incoming-vault',
    )
    expect(clearExistingVaultRecoverySummary).toHaveBeenCalledOnce()
    expect(lifecycle.queue.kind).toBe(ExistingVaultImportQueueKind.Idle)
  })

  test.each(['passkey', 'extension', 'Sentinel'])(
    'activates the pending vault after %s unlock completes',
    async () => {
      const { state, lifecycle, activateConnectedExistingVault } =
        lifecycleHarness()
      lifecycle.remember('incoming-vault')
      await lifecycle.resume()

      state.isAuthenticated = true
      await lifecycle.finish()

      expect(activateConnectedExistingVault).toHaveBeenCalledWith(
        'incoming-vault',
      )
      expect(lifecycle.queue.kind).toBe(ExistingVaultImportQueueKind.Idle)
    },
  )

  test('cancels the import, restores the previous vault, and opens the picker', async () => {
    const {
      state,
      lifecycle,
      clearExistingVaultRecoverySummary,
      beginLoginVaultPicker,
    } = lifecycleHarness()
    lifecycle.remember('incoming-vault')

    await lifecycle.leave()

    expect(clearExistingVaultRecoverySummary).toHaveBeenCalledOnce()
    expect(state.selectVaultForUnlock).toHaveBeenCalledWith('current-vault')
    expect(beginLoginVaultPicker).toHaveBeenCalledOnce()
    expect(lifecycle.queue.kind).toBe(ExistingVaultImportQueueKind.Idle)
  })
})
