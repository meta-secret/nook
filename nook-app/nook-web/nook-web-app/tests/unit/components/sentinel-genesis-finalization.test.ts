import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import {
  SentinelGenesisPhase,
  type NookSentinelGenesisParticipantStatus,
  type NookSentinelGenesisStatus,
} from '$app-wasm'
import SentinelTerminalDashboard from '$lib/components/login/SentinelTerminalDashboard.svelte'
import { SentinelDashboard } from '$lib/components/login/sentinel-dashboard-portal'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import SentinelCardStackDashboard from '$lib/components/login/SentinelCardStackDashboard.svelte'
import type { VaultState } from '$lib/vault.svelte'
import { finalize, start } from '$lib/vault/sentinel-genesis'

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
  readonly status = {
    phase: SentinelGenesisPhase.Inactive as SentinelGenesisPhase,
    participants: [] as NookSentinelGenesisParticipantStatus[],
    free: vi.fn(),
    [Symbol.dispose]() {
      this.free()
    },
  } satisfies NookSentinelGenesisStatus
  readonly failure = new Error('genesis finalization rejected')
  readonly manager = {
    finalize_sentinel_genesis: vi.fn(async () => {
      throw this.failure
    }),
    sentinel_genesis_status: vi.fn(
      (): NookSentinelGenesisStatus => this.status,
    ),
    start_sentinel_genesis: vi.fn(async () => {
      throw this.failure
    }),
  }
  readonly state = {
    deviceId: 'initiator',
    hasManager: true,
    isVerifying: false,
    errorMsg: '',
    sentinelGenesisDeliveries: [],
    dismissSuccess: vi.fn(),
    clearSentinelGenesisStore: vi.fn(),
    initDeviceIdentity: vi.fn(async () => {}),
    sentinelGenesisPhase: SentinelGenesisPhase.ReadyToFinalize,
    sentinelGenesisParticipantCount: 1,
    sentinelGenesisParticipants: [this.previousParticipant],
    requireManager: () =>
      this.manager as unknown as ReturnType<VaultState['requireManager']>,
    enqueueStorage: async <Value>(operation: () => Value | Promise<Value>) =>
      operation(),
    t: (request: Parameters<VaultState['t']>[0]) =>
      typeof request === 'string' ? request : request.key,
  }
  readonly prepare = vi.fn()
  readonly start = vi.fn(async () => false)
  readonly finalizeAction = vi.fn(async () => {})

  retain(phase: SentinelGenesisPhase): void {
    this.status.phase = phase
    this.status.participants = [this.currentParticipant]
  }

  async reject(): Promise<void> {
    await expect(finalize(this.state as unknown as VaultState)).rejects.toBe(
      this.failure,
    )
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
    expect(this.state.errorMsg).toBe(this.failure.message)
    expect(this.state.isVerifying).toBe(false)
    expect(this.manager.start_sentinel_genesis).not.toHaveBeenCalled()
    expect(this.manager.finalize_sentinel_genesis).toHaveBeenCalledOnce()
  }

  dashboardProps(): GenesisDashboardProps {
    const props: GenesisDashboardProps = {
      vault: this.state as unknown as VaultState,
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
      onAddParticipant: vi.fn(),
      onFinalize: this.finalizeAction,
      onCompleteDelivery: vi.fn(),
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
    const button = view.getByTestId(
      'sentinel-genesis-finalize',
    ) as HTMLButtonElement
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
    const button = view.getByTestId(
      'sentinel-genesis-finalize',
    ) as HTMLButtonElement
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
      fixture.status.phase = SentinelGenesisPhase.AwaitingCompletionCheck
      await fixture.reject()
      const view = fixture.renderDashboard(surface)
      const button = view.getByTestId(
        'sentinel-genesis-finalize',
      ) as HTMLButtonElement
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
        finalize(fixture.state as unknown as VaultState),
      ).rejects.toBe(fixture.failure)
      await view.rerender(fixture.dashboardProps())
      expect(
        (view.getByTestId('sentinel-genesis-finalize') as HTMLButtonElement)
          .disabled,
      ).toBe(false)
      expect(fixture.state.sentinelGenesisPhase).toBe(
        SentinelGenesisPhase.AwaitingCompletionCheck,
      )
      fixture.status.phase = SentinelGenesisPhase.Inactive
      await expect(
        finalize(fixture.state as unknown as VaultState),
      ).rejects.toBe(fixture.failure)
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
      fixture.status.phase = SentinelGenesisPhase.AwaitingCompletionCheck
      const request: Parameters<typeof start>[0] = {
        state: fixture.state as unknown as VaultState,
        args: { label: 'Genesis fixture', participantCount: 3, threshold: 2 },
      }
      await expect(start(request)).rejects.toBe(fixture.failure)
      expect(fixture.manager.sentinel_genesis_status).toHaveBeenCalledOnce()
      expect(fixture.state.sentinelGenesisPhase).toBe(
        SentinelGenesisPhase.AwaitingCompletionCheck,
      )
      expect(fixture.state.isVerifying).toBe(false)
      const view = fixture.renderDashboard(surface)
      const button = view.getByTestId(
        'sentinel-genesis-finalize',
      ) as HTMLButtonElement
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
