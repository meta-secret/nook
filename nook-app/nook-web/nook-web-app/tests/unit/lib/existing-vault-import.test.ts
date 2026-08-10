import { describe, expect, test, vi } from 'vitest'
import { JoinEnrollmentState } from '$app-wasm'
import { LOCAL_PROVIDER_TYPE } from '$lib/auth/providers'
import { ExistingVaultImportQueueKind } from '$lib/vault/creation-queue'
import { ExistingVaultImportLifecycle } from '$lib/vault/existing-vault-import.svelte'
import {
  ActiveVaultKind,
  LocalFolderDraftKind,
  LoginSetupKind,
  OAuthFileDraftKind,
  RecoveryDiscoveryKind,
} from '$lib/vault/state/provider.svelte'
import type { VaultState } from '$lib/vault.svelte'

function lifecycleHarness(authenticated = false) {
  const state = {
    loginSetup: {
      kind: LoginSetupKind.Active,
      providerType: LOCAL_PROVIDER_TYPE,
    },
    oauthFileDraft: { kind: OAuthFileDraftKind.NotConfigured },
    localFolderDraft: { kind: LocalFolderDraftKind.NotConfigured },
    githubPat: '',
    githubRepo: '',
    activeVault: { kind: ActiveVaultKind.Open, storeId: 'current-vault' },
    localVaults: [{ storeId: 'incoming-vault' }],
    isAuthenticated: authenticated,
    errorMsg: '',
    loginRequiresExistingVault: false,
    storageMode: LOCAL_PROVIDER_TYPE,
    recoveryDiscovery: { kind: RecoveryDiscoveryKind.NotFound },
    loginPasswordPrompt: true,
    joinEnrollmentPrompt: JoinEnrollmentState.None,
    sentinelCeremonyPrompt: false,
    t: (key: string) => key,
    requireOauthFileConfig: vi.fn(),
    requireLocalFolderConfig: vi.fn(),
    clearUnlockedSession: vi.fn(),
    selectVaultForUnlock: vi.fn(),
    prepareExistingVaultImportSlot: vi.fn(),
    activateLoginSetup: vi.fn(),
    configureOauthFile: vi.fn(),
    clearOauthFile: vi.fn(),
    configureLocalFolder: vi.fn(),
    clearLocalFolder: vi.fn(),
    connectStagedProvider: vi.fn(),
    selectPasswordEntry: vi.fn(),
    clearSelectedPasswordEntry: vi.fn(),
    unlockWithPassword: vi.fn(),
    activateConnectedExistingVault: vi.fn(),
    clearExistingVaultRecoverySummary: vi.fn(),
    beginLoginVaultPicker: vi.fn(),
  }

  state.clearUnlockedSession.mockImplementation(() => {
    state.isAuthenticated = false
  })
  state.selectVaultForUnlock.mockImplementation(async (storeId: string) => {
    state.activeVault = { kind: ActiveVaultKind.Open, storeId }
  })
  state.activateLoginSetup.mockImplementation((providerType) => {
    state.loginSetup = { kind: LoginSetupKind.Active, providerType }
  })
  state.unlockWithPassword.mockImplementation(async () => {
    state.isAuthenticated = true
  })

  return {
    state,
    lifecycle: new ExistingVaultImportLifecycle(state as unknown as VaultState),
  }
}

describe('ExistingVaultImportLifecycle', () => {
  test('resumes a protected import and activates it after password unlock', async () => {
    const { state, lifecycle } = lifecycleHarness(true)

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
    expect(state.clearOauthFile).toHaveBeenCalledOnce()
    expect(state.clearLocalFolder).toHaveBeenCalledOnce()
    expect(state.connectStagedProvider).toHaveBeenCalledOnce()
    expect(lifecycle.waitingForDevice).toBe(true)

    await lifecycle.unlockWithPassword({
      entryId: 'password-entry',
      password: 'vault-password',
    })

    expect(state.unlockWithPassword).toHaveBeenCalledWith({
      entryId: 'password-entry',
      password: 'vault-password',
    })
    expect(state.activateConnectedExistingVault).toHaveBeenCalledWith(
      'incoming-vault',
    )
    expect(state.clearExistingVaultRecoverySummary).toHaveBeenCalledOnce()
    expect(lifecycle.queue.kind).toBe(ExistingVaultImportQueueKind.Idle)
  })

  test.each(['passkey', 'extension', 'Sentinel'])(
    'activates the pending vault after %s unlock completes',
    async () => {
      const { state, lifecycle } = lifecycleHarness()
      lifecycle.remember('incoming-vault')
      await lifecycle.resume()

      state.isAuthenticated = true
      await lifecycle.finish()

      expect(state.activateConnectedExistingVault).toHaveBeenCalledWith(
        'incoming-vault',
      )
      expect(lifecycle.queue.kind).toBe(ExistingVaultImportQueueKind.Idle)
    },
  )

  test('cancels the import, restores the previous vault, and opens the picker', async () => {
    const { state, lifecycle } = lifecycleHarness()
    lifecycle.remember('incoming-vault')

    await lifecycle.leave()

    expect(state.clearExistingVaultRecoverySummary).toHaveBeenCalledOnce()
    expect(state.selectVaultForUnlock).toHaveBeenCalledWith('current-vault')
    expect(state.beginLoginVaultPicker).toHaveBeenCalledOnce()
    expect(lifecycle.queue.kind).toBe(ExistingVaultImportQueueKind.Idle)
  })
})
