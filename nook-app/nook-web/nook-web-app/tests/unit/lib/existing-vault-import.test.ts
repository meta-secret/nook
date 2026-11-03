import { ok } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import { JoinEnrollmentState, NookLocalVaultUnlockState } from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { ExistingVaultImportQueueKind } from '$lib/vault/creation-queue'
import { ExistingVaultImportLifecycle } from '$lib/vault/existing-vault-import.svelte'
import { ConnectedExistingVaultActivationOutcome } from '$lib/vault/local-login'
import { ProviderSetupKinds } from '$lib/vault/provider-setup-kinds'
import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { ProviderDraftFixture } from '../provider-fixtures'
import type { VaultState } from '$lib/vault.svelte'

function lifecycleHarness(authenticated = false) {
  const state = VaultStateTestFixture.create()
  state.activateLoginSetup(ProviderSetupKinds.THIS_BROWSER)
  state.useThisBrowser()
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
  const stageProviderDraft = vi.spyOn(state, 'stageProviderDraft')
  const connectStagedProvider = vi
    .spyOn(state, 'connectStagedProvider')
    .mockResolvedValue()
  const activateConnectedExistingVault = vi
    .spyOn(state, 'activateConnectedExistingVault')
    .mockResolvedValue(ok(ConnectedExistingVaultActivationOutcome.Activated))
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
    return ok(storeId)
  })
  activateLoginSetup.mockImplementation((kind) => {
    activateLoginSetupImplementation(kind)
  })
  unlockWithPassword.mockImplementation(async () => {
    state.isAuthenticated = true
  })

  return {
    state,
    lifecycle: new ExistingVaultImportLifecycle(state),
    stageProviderDraft,
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
      stageProviderDraft,
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
        kind: ProviderSetupKinds.THIS_BROWSER,
        draft: ProviderDraftFixture.thisBrowser(),
      },
    })

    await lifecycle.resume()

    expect(state.clearUnlockedSession).toHaveBeenCalledOnce()
    expect(state.selectVaultForUnlock).toHaveBeenCalledWith('incoming-vault')
    expect(state.activateLoginSetup).toHaveBeenCalledWith(
      ProviderSetupKinds.THIS_BROWSER,
    )
    expect(stageProviderDraft).toHaveBeenCalledWith(
      ProviderDraftFixture.thisBrowser(),
    )
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

  test('a local folder not chosen yet is not queued and says to choose one', () => {
    const { state, lifecycle } = lifecycleHarness()
    state.activateLoginSetup(ProviderSetupKinds.LOCAL_FOLDER)
    state.stageProviderDraft(ProviderDraftFixture.localFolderAwaiting())

    lifecycle.remember('incoming-vault')

    expect(lifecycle.queue.kind).toBe(ExistingVaultImportQueueKind.Idle)
    expect(state.errorMsg).toBe(I18N_KEYS.AuthStorageLocalFolderChooseErr)
  })

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
