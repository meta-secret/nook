import {
  DeviceProtectionStatus,
  NookSentinelUnlockSessionStatus,
  NookVaultArchitecture,
  NookVaultManager,
  ProviderSyncFreshness,
  SentinelGenesisPhase,
  SentinelVaultUnlockState,
  VaultRecoveryErrorKind,
} from '$app-wasm'
import { unselectedVaultScope } from '$lib/auth/providers'
import type { NookSecretRecord } from '$lib/nook'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import type { VaultState } from '$lib/vault.svelte'
import { RosterHydrationKind } from '$lib/vault/action-contexts'
import { DeviceMode, ReplicationType } from '$lib/vault/architecture-model'
import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import { ProviderSaveOutcome } from '$lib/vault/providers.svelte'
import { SentinelUnlockActions } from '$lib/vault/sentinel-unlock'
import { VaultSessionUnlockOutcome } from '$lib/vault/session'
import { PasswordEntrySelectionKind } from '$lib/vault/state/session.svelte'
import { err, ok, type Result } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

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
  readonly loadSecretPage = vi.fn<VaultState['loadSecretPage']>(async () =>
    ok({
      displayedSecretCount: 0,
      totalSecretCount: 0,
      pageOffset: 0,
      query: '',
    }),
  )
  readonly ensureProviderSaved = vi.fn<VaultState['ensureProviderSaved']>(
    async () => ok(ProviderSaveOutcome.Saved),
  )
  readonly loadProviders = vi.fn<VaultState['loadProviders']>(async () =>
    ok({ providers: [], activeVaultStoreId: unselectedVaultScope() }),
  )
  readonly refreshPasswordEntriesList = vi.fn<
    VaultState['refreshPasswordEntriesList']
  >(async () => ok({ entries: [] }))
  readonly hydrateMultiDeviceState = vi.fn<
    VaultState['hydrateMultiDeviceState']
  >(async () => ok({ kind: RosterHydrationKind.Skipped }))
  readonly markVaultUnlocked = vi.fn(() =>
    ok(VaultSessionUnlockOutcome.Unlocked),
  )
  readonly showSuccess = vi.fn()
  readonly startIdleSessionTracking = vi.fn()
  readonly startVaultSync = vi.fn()
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
    vi.spyOn(this.state, 'showLoginVaultPicker', 'get').mockReturnValue(false)
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
    this.state.initDeviceIdentity = vi.fn(async () =>
      ok({
        deviceId: 'sentinel-device',
        devicePublicKey: 'sentinel-public-key',
      }),
    )
    this.state.syncFromStorage = this.syncFromStorage
    this.state.connectStorageArgs = vi.fn()
    this.state.refreshVaultArchitectureFromManager = vi.fn(() =>
      ok({
        deviceMode: this.state.vaultArchitecture.device_mode,
        vaultType: this.state.vaultArchitecture.vault_type,
        replicationType: this.state.vaultArchitecture.replication_type,
      }),
    )
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
