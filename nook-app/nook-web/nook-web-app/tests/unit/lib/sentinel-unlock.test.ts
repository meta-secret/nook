import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import {
  NookSentinelUnlockSessionStatus,
  SentinelVaultUnlockState,
  SentinelGenesisPhase,
  VaultApplication,
} from '$app-wasm'
import LoginGate from '$lib/components/LoginGate.svelte'
import LoginUnlockStep from '$lib/components/login/LoginUnlockStep.svelte'
import { LoginVaultEntryKind } from '$lib/components/login/login-unlock-state'
import { VaultType } from '$lib/vault/architecture-model'
import { PasswordEntrySelectionKind } from '$lib/vault/state/session.svelte'
import {
  ActiveVaultKind,
  LoginSetupKind,
  LoginVaultSelectionKind,
  OAuthFileDraftKind,
  OAuthSetupPresetKind,
  RecoveryDiscoveryKind,
} from '$lib/vault/state/provider.svelte'
import type { NookSecretRecord } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import { finalizeSentinelUnlock } from '$lib/vault/sentinel-unlock'

enum LoginSurface {
  Gate = 'gate',
  Step = 'step',
}

class SentinelFinalizationFixture {
  readonly previous = NookSentinelUnlockSessionStatus.inactive()
  readonly current = NookSentinelUnlockSessionStatus.inactive()
  readonly previousFree = vi.spyOn(this.previous, 'free')
  readonly currentFree = vi.spyOn(this.current, 'free')
  readonly openVault = vi.fn()
  readonly manager = {
    vaultStoreId: '',
    finalize_sentinel_unlock: vi.fn(
      async (): Promise<NookSecretRecord[]> => [],
    ),
    sentinel_unlock_session_status: vi.fn(() => this.current),
    sentinel_unlock_status: vi.fn(
      () => SentinelVaultUnlockState.AwaitingShares,
    ),
    list_sentinel_genesis_share_deliveries: vi.fn(async () => []),
    start_sentinel_unlock: vi.fn(),
    connect: vi.fn(),
  }
  readonly state = {
    hasManager: true,
    isVerifying: false,
    isAuthenticated: false,
    errorMsg: '',
    sentinelUnlockSession: this.previous,
    sentinelUnlockRequest: 'current ceremony request',
    sentinelUnlockStatus: SentinelVaultUnlockState.AwaitingShares,
    sentinelCeremonyPrompt: true,
    loginPasswordPrompt: false,
    loginDeviceKeysCapable: true,
    vaultArchitecture: { vault_type: VaultType.Sentinel },
    localVaultPresent: true,
    localVaults: [],
    syncProviders: [],
    passwordEntries: [],
    sentinelStoredDeliveries: [],
    sentinelGenesisPhase: SentinelGenesisPhase.Inactive,
    selectedLoginVault: { kind: LoginVaultSelectionKind.NotSelected },
    activeVault: { kind: ActiveVaultKind.Closed },
    selectedPasswordEntry: { kind: PasswordEntrySelectionKind.NotSelected },
    recoveryDiscovery: { kind: RecoveryDiscoveryKind.NotFound },
    oauthFileDraft: { kind: OAuthFileDraftKind.NotConfigured },
    oauthSetupSelection: { kind: OAuthSetupPresetKind.NotSelected },
    prepareLocalLogin: vi.fn(),
    refreshSentinelUnlockStatus: vi.fn(),
    requireManager: () =>
      this.manager as unknown as ReturnType<VaultState['requireManager']>,
    enqueueStorage: async <Value>(operation: () => Value | Promise<Value>) =>
      operation(),
    dismissSuccess: vi.fn(),
    loadSecretPage: vi.fn(async () => {}),
    ensureProviderSaved: vi.fn(async () => {}),
    loadProviders: vi.fn(async () => {}),
    refreshPasswordEntriesList: vi.fn(async () => {}),
    hydrateMultiDeviceState: vi.fn(async () => {}),
    markVaultUnlocked: vi.fn(),
    showSuccess: vi.fn(),
    startIdleSessionTracking: vi.fn(),
    startVaultSync: vi.fn(),
    initDeviceIdentity: vi.fn(),
    syncFromStorage: vi.fn(),
    connectStorageArgs: vi.fn(),
    refreshVaultArchitectureFromManager: vi.fn(),
    resolveErrorMessage: (message: string) => message,
    t: (key: string) => key,
  }

  constructor() {
    vi.spyOn(this.previous, 'active', 'get').mockReturnValue(true)
    vi.spyOn(this.previous, 'ready', 'get').mockReturnValue(true)
  }

  async finalize(): Promise<void> {
    await finalizeSentinelUnlock(this.state as unknown as VaultState)
  }

  renderLogin(surface: LoginSurface) {
    const props = {
      vault: this.state as unknown as VaultState,
      isVerifying: false,
      isInitializing: false,
      onUnlock: this.openVault,
      onUnlockWithPassword: vi.fn(),
      onSwitchVault: vi.fn(),
    }
    return surface === LoginSurface.Gate
      ? render(LoginGate, {
          ...props,
          appKind: VaultApplication.UnifiedDevelopment,
          providers: [],
          loginSetup: { kind: LoginSetupKind.Inactive },
          githubPat: '',
          githubRepo: '',
          onBeginSetup: vi.fn(),
          onCancelSetup: vi.fn(),
          onCreateDeviceVault: vi.fn(),
          onStartSentinelGenesis: vi.fn(async () => false),
        })
      : render(LoginUnlockStep, {
          ...props,
          vaultEntry: { kind: LoginVaultEntryKind.Unavailable },
          selectedPasswordEntry: {
            kind: PasswordEntrySelectionKind.NotSelected,
          },
          onSelectPasswordEntry: vi.fn(),
          onOpenDevicesAccess: vi.fn(),
          onCreateAnotherVault: vi.fn(),
          onImportFromSync: vi.fn(),
        })
  }

  expectNoAutomaticCeremony(): void {
    expect(this.state.initDeviceIdentity).not.toHaveBeenCalled()
    expect(this.state.syncFromStorage).not.toHaveBeenCalled()
    expect(this.state.connectStorageArgs).not.toHaveBeenCalled()
    expect(this.manager.connect).not.toHaveBeenCalled()
    expect(this.manager.start_sentinel_unlock).not.toHaveBeenCalled()
  }

  dispose(): void {
    this.state.sentinelUnlockSession.free()
    if (this.state.sentinelUnlockSession !== this.current) this.current.free()
  }
}

describe('Sentinel quorum completion presentation', () => {
  test('clears stale readiness and request after terminal rejection without restarting', async () => {
    const fixture = new SentinelFinalizationFixture()
    fixture.manager.finalize_sentinel_unlock.mockRejectedValue(
      new Error('terminal reconstruction failed'),
    )

    await fixture.finalize()

    expect(
      fixture.manager.sentinel_unlock_session_status,
    ).toHaveBeenCalledOnce()
    expect(fixture.previousFree).toHaveBeenCalledOnce()
    expect(fixture.currentFree).not.toHaveBeenCalled()
    expect(fixture.state.sentinelUnlockSession).toBe(fixture.current)
    expect(fixture.state.sentinelUnlockSession.active).toBe(false)
    expect(fixture.state.sentinelUnlockSession.ready).toBe(false)
    expect(fixture.state.sentinelUnlockRequest).toBe('')
    expect(fixture.state.errorMsg).toBe('terminal reconstruction failed')
    expect(fixture.state.sentinelUnlockStatus).toBe(
      SentinelVaultUnlockState.AwaitingShares,
    )
    expect(fixture.manager.sentinel_unlock_status).toHaveBeenCalledOnce()
    expect(fixture.state.isVerifying).toBe(false)
    expect(fixture.state.loadSecretPage).not.toHaveBeenCalled()
    fixture.expectNoAutomaticCeremony()

    for (const surface of [LoginSurface.Gate, LoginSurface.Step]) {
      fixture.openVault.mockClear()
      const view = fixture.renderLogin(surface)
      expect(view.queryAllByTestId('sentinel-ceremony-panel')).toHaveLength(0)
      expect(
        view.queryAllByTestId('login-unlock-method-password'),
      ).toHaveLength(0)
      expect(fixture.openVault).not.toHaveBeenCalled()
      const open = view.getByTestId('unlock-vault-btn') as HTMLButtonElement
      expect(open.disabled).toBe(false)
      await fireEvent.click(open)
      expect(fixture.openVault).toHaveBeenCalledOnce()
      view.unmount()
    }
    await fixture.finalize()
    expect(fixture.manager.finalize_sentinel_unlock).toHaveBeenCalledOnce()
    fixture.dispose()
  })

  test('reflects the retained active ceremony after admission rejection without hydration', async () => {
    const fixture = new SentinelFinalizationFixture()
    fixture.manager.vaultStoreId = 'loaded-sentinel-vault'
    vi.spyOn(fixture.current, 'active', 'get').mockReturnValue(true)
    fixture.manager.sentinel_unlock_status.mockReturnValue(
      SentinelVaultUnlockState.CeremonyRequired,
    )
    fixture.manager.finalize_sentinel_unlock.mockRejectedValue(
      new Error('SentinelCeremonyRequired'),
    )

    await fixture.finalize()

    expect(
      fixture.manager.sentinel_unlock_session_status,
    ).toHaveBeenCalledOnce()
    expect(fixture.previousFree).toHaveBeenCalledOnce()
    expect(fixture.state.sentinelUnlockSession).toBe(fixture.current)
    expect(fixture.state.sentinelUnlockSession.active).toBe(true)
    expect(fixture.state.sentinelUnlockSession.ready).toBe(false)
    expect(fixture.state.sentinelUnlockRequest).toBe('current ceremony request')
    expect(fixture.state.sentinelCeremonyPrompt).toBe(true)
    expect(fixture.state.sentinelUnlockStatus).toBe(
      SentinelVaultUnlockState.CeremonyRequired,
    )
    expect(fixture.manager.sentinel_unlock_status).toHaveBeenCalledOnce()
    expect(fixture.state.errorMsg).toBe('')
    expect(fixture.state.isVerifying).toBe(false)
    expect(fixture.state.markVaultUnlocked).not.toHaveBeenCalled()
    fixture.expectNoAutomaticCeremony()
    for (const surface of [LoginSurface.Gate, LoginSurface.Step]) {
      const view = fixture.renderLogin(surface)
      expect(view.getByTestId('sentinel-unlock-initiator')).toBeTruthy()
      expect(view.queryAllByTestId('unlock-vault-btn')).toHaveLength(0)
      expect(view.queryAllByTestId('sentinel-unlock-start-btn')).toHaveLength(0)
      expect(fixture.openVault).not.toHaveBeenCalled()
      view.unmount()
    }
    fixture.dispose()
  })

  test('keeps a loaded vault waiting for shares instead of reopening it', async () => {
    const fixture = new SentinelFinalizationFixture()
    fixture.manager.vaultStoreId = 'loaded-sentinel-vault'
    fixture.manager.finalize_sentinel_unlock.mockRejectedValue(
      new Error('waiting for shares'),
    )
    await fixture.finalize()
    for (const surface of [LoginSurface.Gate, LoginSurface.Step]) {
      const view = fixture.renderLogin(surface)
      expect(
        (view.getByTestId('sentinel-unlock-start-btn') as HTMLButtonElement)
          .disabled,
      ).toBe(true)
      expect(view.queryAllByTestId('unlock-vault-btn')).toHaveLength(0)
      expect(fixture.openVault).not.toHaveBeenCalled()
      view.unmount()
    }
    fixture.dispose()
  })

  test.each([
    'loadSecretPage',
    'ensureProviderSaved',
    'loadProviders',
  ] as const)(
    'keeps Rust unlocked and the ceremony closed when %s rejects after finalization',
    async (operation) => {
      const fixture = new SentinelFinalizationFixture()
      fixture.manager.vaultStoreId = 'loaded-sentinel-vault'
      fixture.manager.sentinel_unlock_status.mockReturnValue(
        SentinelVaultUnlockState.Unlocked,
      )
      fixture.state[operation].mockRejectedValue(
        new Error('SentinelCeremonyRequired'),
      )

      await fixture.finalize()

      expect(fixture.manager.finalize_sentinel_unlock).toHaveBeenCalledOnce()
      expect(fixture.manager.sentinel_unlock_status).toHaveBeenCalledOnce()
      expect(fixture.previousFree).toHaveBeenCalledOnce()
      expect(fixture.state.sentinelUnlockSession).toBe(fixture.current)
      expect(fixture.state.sentinelUnlockSession.active).toBe(false)
      expect(fixture.state.sentinelUnlockStatus).toBe(
        SentinelVaultUnlockState.Unlocked,
      )
      expect(fixture.state.sentinelCeremonyPrompt).toBe(false)
      expect(fixture.state.sentinelUnlockRequest).toBe('')
      expect(fixture.state.errorMsg).toBe('SentinelCeremonyRequired')
      expect(fixture.state.isVerifying).toBe(false)
      expect(fixture.state.isAuthenticated).toBe(false)
      expect(fixture.state.markVaultUnlocked).not.toHaveBeenCalled()
      expect(fixture.state.startVaultSync).not.toHaveBeenCalled()
      fixture.expectNoAutomaticCeremony()
      // Rust's unlocked result also overrides a stale presentation hint.
      fixture.state.sentinelCeremonyPrompt = true
      for (const surface of [LoginSurface.Gate, LoginSurface.Step]) {
        const view = fixture.renderLogin(surface)
        expect(view.queryAllByTestId('sentinel-ceremony-panel')).toHaveLength(0)
        expect(view.queryAllByTestId('sentinel-unlock-start-btn')).toHaveLength(
          0,
        )
        expect(
          view.queryAllByTestId('login-unlock-method-password'),
        ).toHaveLength(0)
        expect(fixture.openVault).not.toHaveBeenCalled()
        view.unmount()
      }
      fixture.dispose()
    },
  )

  test('keeps successful page and provider loading before unlocked presentation and sync', async () => {
    const fixture = new SentinelFinalizationFixture()

    await fixture.finalize()

    expect(
      fixture.manager.sentinel_unlock_session_status,
    ).not.toHaveBeenCalled()
    expect(fixture.manager.sentinel_unlock_status).not.toHaveBeenCalled()
    expect(fixture.previousFree).toHaveBeenCalledOnce()
    expect(fixture.state.sentinelUnlockSession.active).toBe(false)
    expect(fixture.state.sentinelUnlockRequest).toBe('')
    expect(fixture.state.sentinelUnlockStatus).toBe(
      SentinelVaultUnlockState.Unlocked,
    )
    expect(fixture.state.isVerifying).toBe(false)
    const steps = [
      fixture.manager.finalize_sentinel_unlock,
      fixture.state.loadSecretPage,
      fixture.state.ensureProviderSaved,
      fixture.state.loadProviders,
      fixture.state.refreshPasswordEntriesList,
      fixture.state.hydrateMultiDeviceState,
      fixture.state.markVaultUnlocked,
      fixture.state.showSuccess,
      fixture.state.startIdleSessionTracking,
      fixture.state.startVaultSync,
    ]
    for (const step of steps) expect(step).toHaveBeenCalledOnce()
    const order = steps.flatMap((step) => step.mock.invocationCallOrder)
    expect(order).toEqual([...order].sort((left, right) => left - right))
    fixture.expectNoAutomaticCeremony()
    fixture.dispose()
  })
})
