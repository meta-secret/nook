import { describe, expect, test, vi } from 'vitest'
import {
  NookSentinelUnlockSessionStatus,
  SentinelVaultUnlockState,
} from '$app-wasm'
import type { NookSecretRecord } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import { finalizeSentinelUnlock } from '$lib/vault/sentinel-unlock'

class SentinelFinalizationFixture {
  readonly previous = NookSentinelUnlockSessionStatus.inactive()
  readonly current = NookSentinelUnlockSessionStatus.inactive()
  readonly previousFree = vi.spyOn(this.previous, 'free')
  readonly currentFree = vi.spyOn(this.current, 'free')
  readonly manager = {
    finalize_sentinel_unlock: vi.fn(
      async (): Promise<NookSecretRecord[]> => [],
    ),
    sentinel_unlock_session_status: vi.fn(() => this.current),
    sentinel_unlock_status: vi.fn(() => SentinelVaultUnlockState.NotSentinel),
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
    requireManager: () =>
      this.manager as ReturnType<VaultState['requireManager']>,
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
    await finalizeSentinelUnlock(this.state as VaultState)
  }

  expectNoAutomaticCeremony(): void {
    expect(this.state.initDeviceIdentity).not.toHaveBeenCalled()
    expect(this.state.syncFromStorage).not.toHaveBeenCalled()
    expect(this.state.connectStorageArgs).not.toHaveBeenCalled()
    expect(this.manager.connect).not.toHaveBeenCalled()
    expect(this.manager.start_sentinel_unlock).not.toHaveBeenCalled()
    expect(this.manager.sentinel_unlock_status).not.toHaveBeenCalled()
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
    expect(fixture.state.isVerifying).toBe(false)
    expect(fixture.state.loadSecretPage).not.toHaveBeenCalled()
    fixture.expectNoAutomaticCeremony()

    await fixture.finalize()
    expect(fixture.manager.finalize_sentinel_unlock).toHaveBeenCalledOnce()
    fixture.dispose()
  })

  test('reflects the retained active ceremony after admission rejection without hydration', async () => {
    const fixture = new SentinelFinalizationFixture()
    vi.spyOn(fixture.current, 'active', 'get').mockReturnValue(true)
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
    expect(fixture.state.errorMsg).toBe('')
    expect(fixture.state.isVerifying).toBe(false)
    expect(fixture.state.markVaultUnlocked).not.toHaveBeenCalled()
    fixture.expectNoAutomaticCeremony()
    fixture.dispose()
  })

  test('keeps successful page and provider loading before unlocked presentation and sync', async () => {
    const fixture = new SentinelFinalizationFixture()

    await fixture.finalize()

    expect(
      fixture.manager.sentinel_unlock_session_status,
    ).not.toHaveBeenCalled()
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
