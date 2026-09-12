import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import type { SentinelActionResult } from '$lib/vault/sentinel-genesis'
import { err, ok, type Result } from 'neverthrow'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import {
  NookSentinelUnlockSessionStatus,
  NookVaultManager,
  NookVaultArchitecture,
  DeviceProtectionStatus,
  ProviderSyncFreshness,
  SentinelVaultUnlockState,
  SentinelGenesisPhase,
  VaultApplication,
  VaultRecoveryErrorKind,
} from '$app-wasm'
import LoginGate from '$lib/components/LoginGate.svelte'
import LoginUnlockStep from '$lib/components/login/LoginUnlockStep.svelte'
import SentinelUnlockParticipantHelper from '$lib/components/login/SentinelUnlockParticipantHelper.svelte'
import { LoginVaultEntryKind } from '$lib/components/login/login-unlock-state'
import { DeviceMode, ReplicationType } from '$lib/vault/architecture-model'
import { PasswordEntrySelectionKind } from '$lib/vault/state/session.svelte'
import {
  LoginSetupKind,
} from '$lib/vault/state/provider.svelte'
import type { NookSecretRecord } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import { SentinelUnlockActions } from '$lib/vault/sentinel-unlock'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { requireButtonElement } from '../test-dom-helpers'

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
  readonly storedDeliveriesRequest = {
    resolve: vi.fn(async () => []),
    free: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }
  readonly manager = new NookVaultManager()
  readonly state: VaultState = VaultStateTestFixture.create()
  readonly finalizeSentinelUnlock = vi.fn(
    async (): Promise<NookSecretRecord[]> => [],
  )
  readonly sentinelUnlockSessionStatus = vi.fn(() => this.current)
  readonly sentinelUnlockStatus = vi.fn(
    () => SentinelVaultUnlockState.AwaitingShares,
  )
  readonly startSentinelUnlock = vi.fn(
    async (): Promise<NookSentinelUnlockSessionStatus> => this.current,
  )
  readonly waitForStorageChain = vi.fn(async () => {})
  readonly syncFromStorage = vi.fn<VaultState['syncFromStorage']>(async () =>
    ok(ProviderSyncOutcome.Synced),
  )
  readonly loadSecretPage = vi.fn<VaultState['loadSecretPage']>(async () => ok())
  readonly ensureProviderSaved = vi.fn<VaultState['ensureProviderSaved']>(
    async () => ok(),
  )
  readonly loadProviders = vi.fn<VaultState['loadProviders']>(async () => ok())
  readonly refreshPasswordEntriesList = vi.fn<
    () => Promise<SentinelActionResult<void>>
  >(async () => ok())
  readonly hydrateMultiDeviceState = vi.fn(async () => ok())
  readonly markVaultUnlocked = vi.fn(() => ok())
  readonly showSuccess = vi.fn()
  readonly startIdleSessionTracking = vi.fn()
  readonly startVaultSync = vi.fn()
  readonly failureOperations = {
    loadSecretPage: this.loadSecretPage,
    ensureProviderSaved: this.ensureProviderSaved,
    loadProviders: this.loadProviders,
  }

  constructor() {
    Object.defineProperty(this.manager, 'vaultStoreId', {
      configurable: true,
      value: '',
      writable: true,
    })
    this.manager.finalize_sentinel_unlock = this.finalizeSentinelUnlock
    this.manager.sentinel_unlock_session_status =
      this.sentinelUnlockSessionStatus
    this.manager.sentinel_unlock_status = this.sentinelUnlockStatus
    this.manager.sentinel_unlock_request_json = vi.fn(
      () => 'new ceremony request',
    )
    this.manager.sentinel_stored_deliveries_request = vi.fn(
      () => this.storedDeliveriesRequest,
    )
    this.manager.start_sentinel_unlock = this.startSentinelUnlock
    this.manager.connect = vi.fn()
    this.state.isInitializing = false
    this.state.isVerifying = false
    this.state.isAuthenticated = false
    this.state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
    this.state.errorMsg = ''
    this.state.sentinelUnlockSession = this.previous
    this.state.sentinelUnlockRequest = 'current ceremony request'
    this.state.sentinelUnlockStatus = SentinelVaultUnlockState.AwaitingShares
    this.state.sentinelCeremonyPrompt = true
    this.state.loginPasswordPrompt = false
    this.state.loginDeviceKeysCapable = true
    this.state.vaultArchitecture = NookVaultArchitecture.sentinel(
      DeviceMode.Standard,
      ReplicationType.Personal,
      2,
      3,
      0,
    )
    this.state.localVaultPresent = true
    this.state.localVaults = []
    this.state.passwordEntries = []
    this.state.sentinelStoredDeliveries = []
    this.state.sentinelGenesisPhase = SentinelGenesisPhase.Inactive
    this.state.clearSelectedLoginVaultStore()
    this.state.clearActiveVaultStore()
    this.state.selectedPasswordEntry = {
      kind: PasswordEntrySelectionKind.NotSelected,
    }
    this.state.clearExistingVaultRecoverySummary()
    this.state.clearOauthFile()
    this.state.clearOauthSetupPreset()
    this.state.prepareLocalLogin = vi.fn()
    this.state.refreshSentinelUnlockStatus = vi.fn()
    this.state.openManager(this.manager)
    const immediateStorage = async <Value, Failure = Error>(
      operation: () => Result<Value, Failure> | Promise<Result<Value, Failure>>,
    ): Promise<Result<Value, Failure>> => operation()
    this.state.enqueueStorage = immediateStorage
    this.state.waitForStorageChain = this.waitForStorageChain
    this.state.dismissSuccess = vi.fn()
    this.state.loadSecretPage = this.loadSecretPage
    this.state.ensureProviderSaved = this.ensureProviderSaved
    this.state.loadProviders = this.loadProviders
    this.state.refreshPasswordEntriesList = this.refreshPasswordEntriesList
    this.state.hydrateMultiDeviceState = this.hydrateMultiDeviceState
    this.state.markVaultUnlocked = this.markVaultUnlocked
    this.state.showSuccess = this.showSuccess
    this.state.startIdleSessionTracking = this.startIdleSessionTracking
    this.state.startVaultSync = this.startVaultSync
    this.state.initDeviceIdentity = vi.fn(async () => ok())
    this.state.syncFromStorage = this.syncFromStorage
    this.state.connectStorageArgs = vi.fn()
    this.state.refreshVaultArchitectureFromManager = vi.fn(() => ok())
    this.state.resolveErrorMessage = (message: string) => message
    this.state.t = (request: Parameters<VaultState['t']>[0]) =>
      typeof request === 'string' ? request : request.key
    vi.spyOn(this.previous, 'active', 'get').mockReturnValue(true)
    vi.spyOn(this.previous, 'ready', 'get').mockReturnValue(true)
  }

  setVaultStoreId(value: string): void {
    Object.defineProperty(this.manager, 'vaultStoreId', {
      configurable: true,
      value,
      writable: true,
    })
  }

  get vault(): VaultState {
    return this.state
  }

  async finalize(): Promise<void> {
    const actions = new SentinelUnlockActions(this.state)
    const result = await actions.finalizeSentinelUnlock()
    if (result.isErr()) actions.presentFinalizationFailure(result.error)
  }

  renderLogin(surface: LoginSurface) {
    const props = {
      vault: this.vault,
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
  test('does not list stored deliveries while the helper is collapsed', async () => {
    const fixture = new SentinelFinalizationFixture()
    const view = render(SentinelUnlockParticipantHelper, {
      vault: fixture.vault,
    })

    await tick()

    expect(fixture.state.waitForStorageChain).not.toHaveBeenCalled()
    expect(fixture.state.initDeviceIdentity).not.toHaveBeenCalled()
    expect(
      fixture.manager.sentinel_stored_deliveries_request,
    ).not.toHaveBeenCalled()
    view.unmount()
    fixture.dispose()
  })

  test('lists stored deliveries only after protection and sync activity are ready', async () => {
    const locked = new SentinelFinalizationFixture()
    locked.state.deviceProtectionStatus = DeviceProtectionStatus.Passkey
    const lockedView = render(SentinelUnlockParticipantHelper, {
      vault: locked.vault,
      expanded: true,
    })

    await tick()

    expect(locked.state.initDeviceIdentity).not.toHaveBeenCalled()
    expect(
      locked.manager.sentinel_stored_deliveries_request,
    ).not.toHaveBeenCalled()
    lockedView.unmount()
    locked.dispose()

    const initializing = new SentinelFinalizationFixture()
    initializing.state.isInitializing = true
    const initializingView = render(SentinelUnlockParticipantHelper, {
      vault: initializing.vault,
      expanded: true,
    })

    await tick()

    expect(initializing.state.initDeviceIdentity).not.toHaveBeenCalled()
    expect(
      initializing.manager.sentinel_stored_deliveries_request,
    ).not.toHaveBeenCalled()
    initializingView.unmount()
    initializing.dispose()

    const verifying = new SentinelFinalizationFixture()
    verifying.state.isVerifying = true
    const verifyingView = render(SentinelUnlockParticipantHelper, {
      vault: verifying.vault,
      expanded: true,
    })

    await tick()

    expect(verifying.state.initDeviceIdentity).not.toHaveBeenCalled()
    expect(
      verifying.manager.sentinel_stored_deliveries_request,
    ).not.toHaveBeenCalled()
    verifyingView.unmount()
    verifying.dispose()

    const syncing = new SentinelFinalizationFixture()
    syncing.state.isSyncing = true
    const syncingView = render(SentinelUnlockParticipantHelper, {
      vault: syncing.vault,
      expanded: true,
    })

    await tick()

    expect(syncing.state.waitForStorageChain).not.toHaveBeenCalled()
    expect(syncing.state.initDeviceIdentity).not.toHaveBeenCalled()
    expect(
      syncing.manager.sentinel_stored_deliveries_request,
    ).not.toHaveBeenCalled()
    syncingView.unmount()
    syncing.dispose()

    const ready = new SentinelFinalizationFixture()
    let releaseStorageChain = () => {}
    const storageChainIdle = new Promise<void>((resolve) => {
      releaseStorageChain = resolve
    })
    ready.waitForStorageChain.mockReturnValue(storageChainIdle)
    const readyView = render(SentinelUnlockParticipantHelper, {
      vault: ready.vault,
      expanded: true,
    })

    await vi.waitFor(() => {
      expect(ready.state.waitForStorageChain).toHaveBeenCalledOnce()
    })
    expect(ready.state.initDeviceIdentity).not.toHaveBeenCalled()
    expect(
      ready.manager.sentinel_stored_deliveries_request,
    ).not.toHaveBeenCalled()

    releaseStorageChain()

    await vi.waitFor(() => {
      expect(ready.state.initDeviceIdentity).toHaveBeenCalledOnce()
      expect(
        ready.manager.sentinel_stored_deliveries_request,
      ).toHaveBeenCalledOnce()
      expect(ready.storedDeliveriesRequest.resolve).toHaveBeenCalledOnce()
      expect(ready.storedDeliveriesRequest.free).toHaveBeenCalledOnce()
    })
    readyView.unmount()
    ready.dispose()
  })

  test('does not start a second delivery listing while one is in flight', async () => {
    const fixture = new SentinelFinalizationFixture()
    let finishListing = () => {}
    const pendingListing = new Promise<never[]>((resolve) => {
      finishListing = () => resolve([])
    })
    fixture.storedDeliveriesRequest.resolve.mockReturnValue(pendingListing)
    const view = render(SentinelUnlockParticipantHelper, {
      vault: fixture.vault,
      expanded: true,
      showWhenEmpty: true,
    })

    await vi.waitFor(() => {
      expect(
        fixture.manager.sentinel_stored_deliveries_request,
      ).toHaveBeenCalledOnce()
      expect(fixture.storedDeliveriesRequest.resolve).toHaveBeenCalledOnce()
    })

    const toggle = view.getByTestId('sentinel-unlock-participant-toggle')
    await fireEvent.click(toggle)
    await fireEvent.click(toggle)

    expect(
      fixture.manager.sentinel_stored_deliveries_request,
    ).toHaveBeenCalledOnce()
    expect(fixture.storedDeliveriesRequest.free).not.toHaveBeenCalled()

    view.unmount()
    finishListing()
    await vi.waitFor(() => {
      expect(fixture.storedDeliveriesRequest.free).toHaveBeenCalledOnce()
    })
    fixture.dispose()
  })

  test('frees a failed stored-deliveries request', async () => {
    const fixture = new SentinelFinalizationFixture()
    fixture.storedDeliveriesRequest.resolve.mockRejectedValue(
      new Error('stored delivery read failed'),
    )
    const view = render(SentinelUnlockParticipantHelper, {
      vault: fixture.vault,
      expanded: true,
    })

    await vi.waitFor(() => {
      expect(fixture.storedDeliveriesRequest.resolve).toHaveBeenCalledOnce()
      expect(fixture.storedDeliveriesRequest.free).toHaveBeenCalledOnce()
    })
    expect(fixture.state.errorMsg).toBe(I18N_KEYS.AuthStorageSyncFailed)
    view.unmount()
    fixture.dispose()
  })

  test('refreshes Sentinel status only after device protection is ready', async () => {
    const locked = new SentinelFinalizationFixture()
    locked.state.deviceProtectionStatus = DeviceProtectionStatus.Passkey
    const lockedView = locked.renderLogin(LoginSurface.Gate)

    await tick()

    expect(locked.state.refreshSentinelUnlockStatus).not.toHaveBeenCalled()
    lockedView.unmount()
    locked.dispose()

    const ready = new SentinelFinalizationFixture()
    const readyView = ready.renderLogin(LoginSurface.Gate)

    await vi.waitFor(() => {
      expect(ready.state.refreshSentinelUnlockStatus).toHaveBeenCalledOnce()
    })
    readyView.unmount()
    ready.dispose()
  })

  test('clears stale readiness and request after terminal rejection without restarting', async () => {
    const fixture = new SentinelFinalizationFixture()
    fixture.finalizeSentinelUnlock.mockRejectedValue(
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
    expect(fixture.state.errorMsg).toBe(I18N_KEYS.AuthStorageSyncFailed)
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
      const open = requireButtonElement(view.getByTestId('unlock-vault-btn'))
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
    fixture.setVaultStoreId('loaded-sentinel-vault')
    vi.spyOn(fixture.current, 'active', 'get').mockReturnValue(true)
    fixture.sentinelUnlockStatus.mockReturnValue(
      SentinelVaultUnlockState.CeremonyRequired,
    )
    fixture.finalizeSentinelUnlock.mockRejectedValue(
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
    fixture.setVaultStoreId('loaded-sentinel-vault')
    fixture.finalizeSentinelUnlock.mockRejectedValue(
      new Error('waiting for shares'),
    )
    await fixture.finalize()
    for (const surface of [LoginSurface.Gate, LoginSurface.Step]) {
      const view = fixture.renderLogin(surface)
      expect(
        requireButtonElement(view.getByTestId('sentinel-unlock-start-btn'))
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
      fixture.setVaultStoreId('loaded-sentinel-vault')
      fixture.sentinelUnlockStatus.mockReturnValue(
        SentinelVaultUnlockState.Unlocked,
      )
      fixture.failureOperations[operation].mockResolvedValue(
        err(
          new NativeVaultStorageFailure(new Error('SentinelCeremonyRequired')),
        ),
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
      expect(fixture.state.errorMsg).toBe(I18N_KEYS.AuthStorageSyncFailed)
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
      fixture.finalizeSentinelUnlock,
      fixture.loadSecretPage,
      fixture.ensureProviderSaved,
      fixture.loadProviders,
      fixture.refreshPasswordEntriesList,
      fixture.hydrateMultiDeviceState,
      fixture.markVaultUnlocked,
      fixture.showSuccess,
      fixture.startIdleSessionTracking,
      fixture.startVaultSync,
    ]
    for (const step of steps) expect(step).toHaveBeenCalledOnce()
    const order = steps.flatMap((step) => step.mock.invocationCallOrder)
    expect(order).toEqual([...order].sort((left, right) => left - right))
    fixture.expectNoAutomaticCeremony()
    fixture.dispose()
  })
})

describe('Sentinel ceremony hydration', () => {
  test('allows a locked Sentinel ceremony to start after ceremony-required sync failure', async () => {
    const fixture = new SentinelFinalizationFixture()
    const syncFailure = new NativeVaultStorageFailure(
      new Error('SentinelCeremonyRequired'),
    )
    fixture.syncFromStorage.mockResolvedValue(err(syncFailure))
    fixture.startSentinelUnlock.mockResolvedValue(fixture.current)

    const actions = new SentinelUnlockActions(fixture.vault)
    const result = await actions.startSentinelUnlock()

    expect(result.isOk()).toBe(true)
    expect(fixture.state.syncFromStorage).toHaveBeenCalledWith(
      ProviderSyncFreshness.Forced,
    )
    expect(fixture.manager.start_sentinel_unlock).toHaveBeenCalledOnce()
    expect(fixture.manager.sentinel_unlock_request_json).toHaveBeenCalledOnce()
    expect(fixture.state.sentinelUnlockRequest).toBe('new ceremony request')
    expect(fixture.state.sentinelCeremonyPrompt).toBe(true)
    expect(syncFailure.recoveryKind).toBe(
      VaultRecoveryErrorKind.SentinelCeremonyRequired,
    )
    fixture.dispose()
  })

  test('propagates unrelated sync failures instead of starting a ceremony', async () => {
    const fixture = new SentinelFinalizationFixture()
    const syncFailure = new NativeVaultStorageFailure(
      new Error('provider unavailable'),
    )
    fixture.syncFromStorage.mockResolvedValue(err(syncFailure))

    const actions = new SentinelUnlockActions(fixture.vault)
    const result = await actions.startSentinelUnlock()

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toBe(syncFailure)
    expect(fixture.manager.start_sentinel_unlock).not.toHaveBeenCalled()
    expect(fixture.manager.sentinel_unlock_request_json).not.toHaveBeenCalled()
    expect(syncFailure.recoveryKind).toBe(VaultRecoveryErrorKind.Other)
    fixture.dispose()
  })
})
