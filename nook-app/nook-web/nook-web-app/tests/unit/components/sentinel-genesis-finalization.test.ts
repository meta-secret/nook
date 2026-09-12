import { err, ok, type Result } from 'neverthrow'
import { NativeVaultStorageFailure } from '$lib/runtime/storage-failure'
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import {
  SentinelGenesisPhase,
  NookVaultManager,
  type NookSentinelGenesisParticipantStatus,
  type NookSentinelGenesisStatus,
} from '$app-wasm'
import SentinelTerminalDashboard from '$lib/components/login/SentinelTerminalDashboard.svelte'
import { SentinelDashboard } from '$lib/components/login/sentinel-dashboard-portal'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import SentinelCardStackDashboard from '$lib/components/login/SentinelCardStackDashboard.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { SentinelGenesisActions } from '$lib/vault/sentinel-genesis'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { requireButtonElement } from '../test-dom-helpers'

type GenesisDashboardProps = ComponentProps<typeof SentinelCardStackDashboard> &
  ComponentProps<typeof SentinelTerminalDashboard>

class GenesisFinalizationFixture {
  readonly previousParticipant = {
    deviceId: 'previous-participant',
    label: 'Previous participant',
    fingerprint: 'previous-fingerprint',
    free: vi.fn(),
    [Symbol.dispose]() {
      this.free()
    },
  } satisfies NookSentinelGenesisParticipantStatus
  readonly currentParticipant = {
    deviceId: 'current-participant',
    label: 'Current participant',
    fingerprint: 'current-fingerprint',
    free: vi.fn(),
    [Symbol.dispose]() {
      this.free()
    },
  } satisfies NookSentinelGenesisParticipantStatus
  readonly status: NookSentinelGenesisStatus = {
    phase: SentinelGenesisPhase.Inactive,
    participants: [],
    free: vi.fn(),
    [Symbol.dispose]() {
      this.free()
    },
  } satisfies NookSentinelGenesisStatus
  readonly failure = new Error('genesis finalization rejected')
  readonly manager = new NookVaultManager()
  readonly state: VaultState = VaultStateTestFixture.create()
  readonly prepare = vi.fn()
  readonly start = vi.fn(async () => false)
  readonly finalizeAction = vi.fn(async () => ok())

  constructor() {
    vi.spyOn(this.manager, 'finalize_sentinel_genesis').mockRejectedValue(
      this.failure,
    )
    vi.spyOn(this.manager, 'sentinel_genesis_status').mockImplementation(
      () => this.status,
    )
    vi.spyOn(this.manager, 'start_sentinel_genesis').mockRejectedValue(
      this.failure,
    )
    this.state.deviceId = 'initiator'
    this.state.isVerifying = false
    this.state.errorMsg = ''
    this.state.dismissSuccess = vi.fn()
    this.state.clearSentinelGenesisStore = vi.fn()
    this.state.initDeviceIdentity = vi.fn(async () => ok())
    this.state.sentinelGenesisPhase = SentinelGenesisPhase.ReadyToFinalize
    this.state.sentinelGenesisParticipantCount = 1
    this.state.sentinelGenesisParticipants = [this.previousParticipant]
    this.state.openManager(this.manager)
    const immediateStorage = async <Value, Failure = Error>(
      operation: () => Result<Value, Failure> | Promise<Result<Value, Failure>>,
    ): Promise<Result<Value, Failure>> => operation()
    this.state.enqueueStorage = immediateStorage
    this.state.t = (request: Parameters<VaultState['t']>[0]) =>
      typeof request === 'string' ? request : request.key
  }

  retain(phase: SentinelGenesisPhase): void {
    this.setStatusPhase(phase)
    Object.defineProperty(this.status, 'participants', {
      configurable: true,
      value: [this.currentParticipant],
    })
  }

  setStatusPhase(phase: SentinelGenesisPhase): void {
    Object.defineProperty(this.status, 'phase', {
      configurable: true,
      value: phase,
    })
  }

  async reject(): Promise<void> {
    await expect(
      new SentinelGenesisActions(this.state).finalize(),
    ).resolves.toEqual(err(new NativeVaultStorageFailure(this.failure)))
    expect(this.manager.sentinel_genesis_status).toHaveBeenCalledOnce()
    expect(this.previousParticipant.free).toHaveBeenCalledOnce()
    expect(this.status.free).toHaveBeenCalledOnce()
    expect(this.currentParticipant.free).not.toHaveBeenCalled()
    expect(this.state.sentinelGenesisPhase).toBe(this.status.phase)
    expect(this.state.sentinelGenesisParticipants).toBe(
      this.status.participants,
    )
    expect(this.state.sentinelGenesisParticipantCount).toBe(
      this.status.participants.length,
    )
    expect(this.state.errorMsg).toBe('')
    expect(this.state.isVerifying).toBe(false)
    expect(this.manager.start_sentinel_genesis).not.toHaveBeenCalled()
    expect(this.manager.finalize_sentinel_genesis).toHaveBeenCalledOnce()
  }

  dashboardProps(): GenesisDashboardProps {
    const props: GenesisDashboardProps = {
      vault: this.state,
      name: 'Genesis fixture',
      participantCount: 3,
      threshold: 2,
      status: this.state.sentinelGenesisPhase,
      request: '',
      participants: this.state.sentinelGenesisParticipants,
      deliveries: [],
      isBusy: this.state.isVerifying,
      initiatorFingerprint: 'initiator-fingerprint',
      initiatorKeyLoading: false,
      onPrepareInitiator: this.prepare,
      onBack: vi.fn(),
      onStart: this.start,
      onAddParticipant: vi.fn(async () => ok()),
      onFinalize: this.finalizeAction,
      onCompleteDelivery: vi.fn(async () => ok()),
    }
    return props
  }

  renderDashboard(surface: SentinelDashboard) {
    const props = this.dashboardProps()
    return surface === SentinelDashboard.CardStack
      ? render(SentinelCardStackDashboard, props)
      : render(SentinelTerminalDashboard, props)
  }

  expectNoAutomaticAction(): void {
    expect(this.start).not.toHaveBeenCalled()
    expect(this.prepare).not.toHaveBeenCalled()
    expect(this.finalizeAction).not.toHaveBeenCalled()
  }
}

describe('Sentinel genesis finalization projection', () => {
  test('retains collecting admission state with Finalize disabled', async () => {
    const fixture = new GenesisFinalizationFixture()
    fixture.retain(SentinelGenesisPhase.CollectingParticipants)
    await fixture.reject()
    const view = fixture.renderDashboard(SentinelDashboard.CardStack)
    const button = requireButtonElement(
      view.getByTestId('sentinel-genesis-finalize'),
    )
    expect(button.disabled).toBe(true)
    expect(view.getByTestId('sentinel-genesis-participant-fields')).toBeTruthy()
    fixture.expectNoAutomaticAction()
    view.unmount()
  })

  test('retains ready admission state and finalizes only after an explicit click', async () => {
    const fixture = new GenesisFinalizationFixture()
    fixture.retain(SentinelGenesisPhase.ReadyToFinalize)
    await fixture.reject()
    const view = fixture.renderDashboard(SentinelDashboard.CardStack)
    const button = requireButtonElement(
      view.getByTestId('sentinel-genesis-finalize'),
    )
    expect(button.disabled).toBe(false)
    fixture.expectNoAutomaticAction()
    await fireEvent.click(button)
    expect(fixture.finalizeAction).toHaveBeenCalledOnce()
    view.unmount()
  })

  test('removes stale readiness after issuance failure and waits for explicit setup navigation', async () => {
    const fixture = new GenesisFinalizationFixture()
    await fixture.reject()
    const view = fixture.renderDashboard(SentinelDashboard.CardStack)
    expect(view.queryAllByTestId('sentinel-genesis-finalize')).toHaveLength(0)
    expect(
      view.queryAllByTestId('sentinel-genesis-ceremony-step'),
    ).toHaveLength(0)
    fixture.expectNoAutomaticAction()
    await fireEvent.click(
      view.getByTestId('sentinel-onboarding-continue-policy'),
    )
    expect(fixture.start).not.toHaveBeenCalled()
    await fireEvent.click(
      view.getByTestId('sentinel-onboarding-continue-devices'),
    )
    expect(fixture.start).toHaveBeenCalledOnce()
    expect(fixture.finalizeAction).not.toHaveBeenCalled()
    view.unmount()
  })

  for (const surface of [
    SentinelDashboard.CardStack,
    SentinelDashboard.Terminal,
  ]) {
    test(`${surface} preserves explicit completion after read failure and removes it after confirmed absence`, async () => {
      const fixture = new GenesisFinalizationFixture()
      fixture.setStatusPhase(SentinelGenesisPhase.AwaitingCompletionCheck)
      await fixture.reject()
      const view = fixture.renderDashboard(surface)
      const button = requireButtonElement(
        view.getByTestId('sentinel-genesis-finalize'),
      )
      expect(button.disabled).toBe(false)
      expect(button.textContent).toContain(
        I18N_KEYS.LoginSentinelGenesisPhaseAwaitingCompletionCheck,
      )
      expect(
        view.queryAllByTestId('sentinel-genesis-request-output'),
      ).toHaveLength(0)
      expect(
        view.queryAllByTestId('sentinel-genesis-copy-request'),
      ).toHaveLength(0)
      fixture.expectNoAutomaticAction()
      await fireEvent.click(button)
      expect(fixture.finalizeAction).toHaveBeenCalledOnce()
      await expect(
        new SentinelGenesisActions(fixture.state).finalize(),
      ).resolves.toEqual(err(new NativeVaultStorageFailure(fixture.failure)))
      await view.rerender(fixture.dashboardProps())
      expect(
        requireButtonElement(view.getByTestId('sentinel-genesis-finalize'))
          .disabled,
      ).toBe(false)
      expect(fixture.state.sentinelGenesisPhase).toBe(
        SentinelGenesisPhase.AwaitingCompletionCheck,
      )
      fixture.setStatusPhase(SentinelGenesisPhase.Inactive)
      await expect(
        new SentinelGenesisActions(fixture.state).finalize(),
      ).resolves.toEqual(err(new NativeVaultStorageFailure(fixture.failure)))
      await view.rerender(fixture.dashboardProps())
      expect(view.queryAllByTestId('sentinel-genesis-finalize')).toHaveLength(0)
      expect(fixture.manager.start_sentinel_genesis).not.toHaveBeenCalled()
      expect(fixture.manager.finalize_sentinel_genesis).toHaveBeenCalledTimes(3)
      if (surface === SentinelDashboard.CardStack) {
        expect(
          view.getByTestId('sentinel-onboarding-continue-policy'),
        ).toBeTruthy()
      } else {
        expect(
          view.getByTestId('sentinel-genesis-participant-count'),
        ).toBeTruthy()
      }
      view.unmount()
    })

    test(`${surface} exposes discovered pending output after an explicit Start rejection`, async () => {
      const fixture = new GenesisFinalizationFixture()
      fixture.state.sentinelGenesisPhase = SentinelGenesisPhase.Inactive
      fixture.setStatusPhase(SentinelGenesisPhase.AwaitingCompletionCheck)
      const request: Parameters<SentinelGenesisActions['start']>[0] = {
        args: { label: 'Genesis fixture', participantCount: 3, threshold: 2 },
      }
      await expect(
        new SentinelGenesisActions(fixture.state).start(request),
      ).resolves.toEqual(err(new NativeVaultStorageFailure(fixture.failure)))
      expect(fixture.manager.sentinel_genesis_status).toHaveBeenCalledOnce()
      expect(fixture.state.sentinelGenesisPhase).toBe(
        SentinelGenesisPhase.AwaitingCompletionCheck,
      )
      expect(fixture.state.isVerifying).toBe(false)
      const view = fixture.renderDashboard(surface)
      const button = requireButtonElement(
        view.getByTestId('sentinel-genesis-finalize'),
      )
      expect(button.disabled).toBe(false)
      fixture.expectNoAutomaticAction()
      expect(fixture.manager.finalize_sentinel_genesis).not.toHaveBeenCalled()
      await fireEvent.click(button)
      expect(fixture.finalizeAction).toHaveBeenCalledOnce()
      expect(fixture.manager.start_sentinel_genesis).toHaveBeenCalledOnce()
      view.unmount()
    })
  }
})
