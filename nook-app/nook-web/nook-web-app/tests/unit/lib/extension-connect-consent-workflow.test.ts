import { err, ok, type Result } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const approvalPort = vi.hoisted(() => ({
  authorize: vi.fn(),
  prepareAuthorizedGrant: vi.fn(),
  deliver: vi.fn(),
  admitCompletion: vi.fn(),
  releaseAuthorization: vi.fn(),
}))

vi.mock('$lib/extension/vault-approval', () => ({
  ExtensionVaultApproval: vi.fn(() => approvalPort),
}))

import {
  ExtensionConsentCloseOutcome,
  ExtensionConsentDeliveryOutcomeKind,
  ExtensionConsentRejectionKind,
  ExtensionConsentWorkflowFailureKind,
  ExtensionConsentWorkflowKind,
  ExtensionConsentWorkflowNoticeKind,
  ExtensionConnectConsentWorkflow,
  ExtensionConsentWorkflowPresentation,
  type ExtensionConsentWorkflowState,
} from '$lib/components/extension-connect-consent-workflow'
import { ExtensionVaultApproval } from '$lib/extension/vault-approval'
import {
  ExtensionConnectScope,
  ExtensionIdentityRequestSource,
  type ExtensionConnectRequest,
} from '$lib/extension/connect'
import {
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
} from '$lib/extension/extension-pairing-delivery'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import {
  NookExtensionConsentApprovalAvailabilityState,
  NookExtensionConsentPhaseState,
  NookExtensionConsentVaultReadiness,
  NookVaultManager,
} from '$app-wasm'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import type { VaultState } from '$lib/vault.svelte'
import type { ExtensionPairingApprovedMessage } from '$web-shared/extension/runtime-messages'
import type { NookExtensionConsentPhase } from '$app-wasm'

function createHarness() {
  const vault = VaultStateTestFixture.create()
  vault.openManager(new NookVaultManager())
  vault.isAuthenticated = true
  const request: ExtensionConnectRequest = {
    source: ExtensionIdentityRequestSource.ExtensionConnect,
    deviceId: 'device-1',
    devicePublicKey: 'device-key',
    deviceSigningPublicKey: 'signing-key',
    extensionRuntimeId: 'extension-1',
    deviceLabel: 'Nook Extension',
    nonce: 'nonce-1',
    scopes: [ExtensionConnectScope.VaultAccess],
  }
  const workflow = new ExtensionConnectConsentWorkflow(vault, request)
  return { vault, workflow }
}

class DeferredWorkflowStage<T> {
  private complete: (value: T) => void = () => {
    throw new Error('Deferred value was not initialized.')
  }

  readonly promise: Promise<T>

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.complete = resolve
    })
  }

  resume(value: T): void {
    this.complete(value)
  }
}

async function approve(harness: ReturnType<typeof createHarness>) {
  let state: ExtensionConsentWorkflowState = harness.workflow.initialState()
  await harness.workflow.approve(state, (next) => {
    state = next
  })
  return state
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  approvalPort.authorize.mockResolvedValue(ok())
  approvalPort.prepareAuthorizedGrant.mockResolvedValue(
    ok({} as ExtensionPairingApprovedMessage),
  )
  approvalPort.deliver.mockResolvedValue(
    ok({ kind: ExtensionPairingDeliveryKind.Delivered, eventCount: 1 }),
  )
  approvalPort.admitCompletion.mockReturnValue(ok())
  approvalPort.releaseAuthorization.mockImplementation(() => {})
})

describe('extension consent web workflow', () => {
  test('maps each semantic readiness fact into a Rust observation', () => {
    const scenarios: ReadonlyArray<{
      readonly readiness: NookExtensionConsentVaultReadiness
      readonly availability: NookExtensionConsentApprovalAvailabilityState
      readonly arrange: (vault: VaultState) => void
    }> = [
      {
        readiness: NookExtensionConsentVaultReadiness.ManagerUnavailable,
        availability:
          NookExtensionConsentApprovalAvailabilityState.ManagerUnavailable,
        arrange: (vault) => vault.clearManager(),
      },
      {
        readiness: NookExtensionConsentVaultReadiness.Locked,
        availability: NookExtensionConsentApprovalAvailabilityState.VaultLocked,
        arrange: (vault) => (vault.isAuthenticated = false),
      },
      {
        readiness: NookExtensionConsentVaultReadiness.Verifying,
        availability: NookExtensionConsentApprovalAvailabilityState.VaultBusy,
        arrange: (vault) => (vault.isVerifying = true),
      },
      {
        readiness: NookExtensionConsentVaultReadiness.Saving,
        availability: NookExtensionConsentApprovalAvailabilityState.VaultBusy,
        arrange: (vault) => (vault.isSaving = true),
      },
      {
        readiness: NookExtensionConsentVaultReadiness.Ready,
        availability: NookExtensionConsentApprovalAvailabilityState.Available,
        arrange: () => {},
      },
    ]
    for (const scenario of scenarios) {
      const harness = createHarness()
      scenario.arrange(harness.vault)

      const state = harness.workflow.initialState()
      expect(harness.workflow.approvalAvailability(state)).toBe(
        scenario.availability,
      )
      expect(state.phase.state).toBe(
        NookExtensionConsentPhaseState.AwaitingAuthorization,
      )
      harness.workflow.dispose()
    }
  })

  test('defers eligibility to Rust and does not authorize while blocked', async () => {
    const harness = createHarness()
    harness.vault.isSaving = true

    const initial = harness.workflow.initialState()
    await harness.workflow.approve(initial, vi.fn())

    expect(approvalPort.authorize).not.toHaveBeenCalled()
    harness.workflow.dispose()
  })

  test('transitions durable approval before grant delivery and completes delivered outcome', async () => {
    const harness = createHarness()

    const state = await approve(harness)

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Completed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.outcome).toEqual({
      kind: ExtensionConsentDeliveryOutcomeKind.Delivered,
      eventCount: 1,
    })
    expect(harness.workflow.closeOutcome(state)).toBe(
      ExtensionConsentCloseOutcome.Approved,
    )
    harness.workflow.dispose()
  })

  test.each([
    {
      name: 'messaging unavailable',
      delivery: { kind: ExtensionPairingDeliveryKind.MessagingUnavailable },
      outcome: {
        kind: ExtensionConsentDeliveryOutcomeKind.MessagingUnavailable,
      },
      notice: {
        kind: ExtensionConsentWorkflowNoticeKind.Message,
        translationKey: I18N_KEYS.ExtensionConsentMessagingUnavailable,
      },
    },
    {
      name: 'plaintext provider migration required',
      delivery: {
        kind: ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired,
      },
      outcome: {
        kind: ExtensionConsentDeliveryOutcomeKind.PlaintextProviderMigrationRequired,
      },
      notice: {
        kind: ExtensionConsentWorkflowNoticeKind.Message,
        translationKey:
          I18N_KEYS.ExtensionConsentPlaintextProviderMigrationRequired,
      },
    },
    {
      name: 'rejected with its typed reason',
      delivery: {
        kind: ExtensionPairingDeliveryKind.Rejected,
        reason: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
      },
      outcome: {
        kind: ExtensionConsentDeliveryOutcomeKind.Rejected,
        rejection: {
          kind: ExtensionConsentRejectionKind.WithReason,
          reason: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
        },
      },
      notice: {
        kind: ExtensionConsentWorkflowNoticeKind.Rejected,
        translationKey: I18N_KEYS.ExtensionConsentGrantRejected,
        rejection: {
          kind: ExtensionConsentRejectionKind.WithReason,
          reason: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
        },
      },
    },
  ])(
    'keeps $name retryable after Rust approval',
    async ({ delivery, outcome, notice: expectedNotice }) => {
      const harness = createHarness()
      const refreshDeviceState = vi.fn(
        async (): Promise<Result<void, VaultStorageFailure>> => ok(),
      )
      harness.vault.refreshDeviceState = refreshDeviceState
      approvalPort.deliver.mockResolvedValueOnce(ok(delivery))

      const retryableState = await approve(harness)
      const notice = new ExtensionConsentWorkflowPresentation().notice(
        retryableState,
        harness.workflow.approvalAvailability(retryableState),
      )

      expect(retryableState.kind).toBe(ExtensionConsentWorkflowKind.Failed)
      if (retryableState.kind === ExtensionConsentWorkflowKind.Failed) {
        expect(retryableState.phase.state).toBe(
          NookExtensionConsentPhaseState.Approved,
        )
        expect(retryableState.failure.kind).toBe(
          ExtensionConsentWorkflowFailureKind.NonDeliveryOutcome,
        )
        if (
          retryableState.failure.kind ===
          ExtensionConsentWorkflowFailureKind.NonDeliveryOutcome
        ) {
          expect(retryableState.failure.outcome).toEqual(outcome)
        }
      }
      expect(harness.workflow.canContinue(retryableState)).toBe(true)
      expect(
        new ExtensionConsentWorkflowPresentation().actionTranslationKey(
          retryableState,
        ),
      ).toBe(I18N_KEYS.DevicesAccessTryAgain)
      expect(harness.workflow.closeOutcome(retryableState)).toBe(
        ExtensionConsentCloseOutcome.Approved,
      )
      expect(notice).toEqual(expectedNotice)
      expect(approvalPort.authorize).toHaveBeenCalledTimes(1)
      expect(refreshDeviceState).not.toHaveBeenCalled()
      expect(approvalPort.admitCompletion).not.toHaveBeenCalled()

      let state = retryableState
      await harness.workflow.approve(state, (next) => {
        state = next
      })

      expect(state.kind).toBe(ExtensionConsentWorkflowKind.Completed)
      if (state.kind === ExtensionConsentWorkflowKind.Completed) {
        expect(state.outcome.kind).toBe(
          ExtensionConsentDeliveryOutcomeKind.Delivered,
        )
      }
      expect(approvalPort.authorize).toHaveBeenCalledTimes(1)
      expect(approvalPort.prepareAuthorizedGrant).toHaveBeenCalledTimes(2)
      expect(approvalPort.deliver).toHaveBeenCalledTimes(2)
      expect(refreshDeviceState).toHaveBeenCalledTimes(1)
      expect(approvalPort.admitCompletion).toHaveBeenCalledTimes(1)
      harness.workflow.dispose()
    },
  )

  test('preserves rejection without inventing a free-form reason', async () => {
    const harness = createHarness()
    approvalPort.deliver.mockResolvedValue(
      ok({ kind: ExtensionPairingDeliveryKind.Rejected }),
    )

    const state = await approve(harness)

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    if (state.kind === ExtensionConsentWorkflowKind.Failed) {
      expect(state.failure.kind).toBe(
        ExtensionConsentWorkflowFailureKind.NonDeliveryOutcome,
      )
      if (
        state.failure.kind ===
        ExtensionConsentWorkflowFailureKind.NonDeliveryOutcome
      ) {
        expect(state.failure.outcome).toEqual({
          kind: ExtensionConsentDeliveryOutcomeKind.Rejected,
          rejection: { kind: ExtensionConsentRejectionKind.WithoutReason },
        })
      }
    }
    harness.workflow.dispose()
  })

  test('keeps authorization failure retryable and cancellation-owned', async () => {
    const harness = createHarness()
    const failure = new VaultStorageFailure(
      VaultStorageFailureKind.OperationFailed,
    )
    approvalPort.authorize.mockResolvedValue(err(failure))

    const state = await approve(harness)
    const notice = new ExtensionConsentWorkflowPresentation().notice(
      state,
      harness.workflow.approvalAvailability(state),
    )

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(state.phase.state).toBe(
      NookExtensionConsentPhaseState.AuthorizationFailed,
    )
    expect(state.failure.kind).toBe(
      ExtensionConsentWorkflowFailureKind.Authorization,
    )
    expect(notice).toEqual({
      kind: ExtensionConsentWorkflowNoticeKind.Message,
      translationKey: failure.translationKey,
    })
    expect(harness.workflow.closeOutcome(state)).toBe(
      ExtensionConsentCloseOutcome.Cancelled,
    )
    expect(harness.workflow.approvalAvailability(state)).toBe(
      NookExtensionConsentApprovalAvailabilityState.RetryAvailable,
    )
    harness.workflow.dispose()
  })

  test('retains approved phase after grant preparation failure', async () => {
    const harness = createHarness()
    const failure = new VaultStorageFailure(
      VaultStorageFailureKind.OperationFailed,
    )
    approvalPort.prepareAuthorizedGrant.mockResolvedValue(err(failure))

    const state = await approve(harness)

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.failure.kind).toBe(
      ExtensionConsentWorkflowFailureKind.GrantPreparation,
    )
    expect(harness.workflow.closeOutcome(state)).toBe(
      ExtensionConsentCloseOutcome.Approved,
    )
    harness.workflow.dispose()
  })

  test('retains approved phase after delivery admission failure', async () => {
    const harness = createHarness()
    const failure = new VaultStorageFailure(
      VaultStorageFailureKind.OperationFailed,
    )
    approvalPort.deliver.mockResolvedValue(err(failure))

    const state = await approve(harness)

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.failure.kind).toBe(
      ExtensionConsentWorkflowFailureKind.DeliveryAdmission,
    )
    expect(harness.workflow.closeOutcome(state)).toBe(
      ExtensionConsentCloseOutcome.Approved,
    )
    harness.workflow.dispose()
  })

  test('retains approved phase when browser handoff throws', async () => {
    const harness = createHarness()
    approvalPort.deliver.mockRejectedValue(new Error('browser failure'))

    const state = await approve(harness)
    const notice = new ExtensionConsentWorkflowPresentation().notice(
      state,
      harness.workflow.approvalAvailability(state),
    )

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.failure.kind).toBe(
      ExtensionConsentWorkflowFailureKind.BrowserHandoff,
    )
    expect(notice).toEqual({
      kind: ExtensionConsentWorkflowNoticeKind.Message,
      translationKey: I18N_KEYS.ExtensionConnectIdentityHandoffFailed,
    })
    harness.workflow.dispose()
  })

  test('retains approved phase for refresh and completion failures', async () => {
    const harness = createHarness()
    const failure = new VaultStorageFailure(
      VaultStorageFailureKind.OperationFailed,
    )
    harness.vault.refreshDeviceState = vi.fn(async () => err(failure))

    const state = await approve(harness)

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.failure.kind).toBe(
      ExtensionConsentWorkflowFailureKind.DeviceRefresh,
    )

    approvalPort.admitCompletion.mockReturnValue(err(failure))
    const completionHarness = createHarness()
    completionHarness.vault.refreshDeviceState = vi.fn(async () => ok())
    const completionState = await approve(completionHarness)
    expect(completionState.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(completionState.phase.state).toBe(
      NookExtensionConsentPhaseState.Approved,
    )
    expect(completionState.failure.kind).toBe(
      ExtensionConsentWorkflowFailureKind.CompletionAdmission,
    )
    harness.workflow.dispose()
    completionHarness.workflow.dispose()
  })

  test.each([
    {
      name: 'grant preparation',
      kind: ExtensionConsentWorkflowFailureKind.GrantPreparation,
      deliveryCalls: 1,
      refreshCalls: 1,
      completionCalls: 1,
    },
    {
      name: 'browser handoff',
      kind: ExtensionConsentWorkflowFailureKind.BrowserHandoff,
      deliveryCalls: 2,
      refreshCalls: 1,
      completionCalls: 1,
    },
    {
      name: 'delivery admission',
      kind: ExtensionConsentWorkflowFailureKind.DeliveryAdmission,
      deliveryCalls: 2,
      refreshCalls: 1,
      completionCalls: 1,
    },
    {
      name: 'device refresh',
      kind: ExtensionConsentWorkflowFailureKind.DeviceRefresh,
      deliveryCalls: 2,
      refreshCalls: 2,
      completionCalls: 1,
    },
    {
      name: 'completion admission',
      kind: ExtensionConsentWorkflowFailureKind.CompletionAdmission,
      deliveryCalls: 2,
      refreshCalls: 2,
      completionCalls: 2,
    },
  ])(
    'retries $name using the existing approval',
    async ({ kind, deliveryCalls, refreshCalls, completionCalls }) => {
      const harness = createHarness()
      const failure = new VaultStorageFailure(
        VaultStorageFailureKind.OperationFailed,
      )
      const refreshDeviceState = vi.fn(
        async (): Promise<Result<void, VaultStorageFailure>> => ok(),
      )
      harness.vault.refreshDeviceState = refreshDeviceState

      switch (kind) {
        case ExtensionConsentWorkflowFailureKind.GrantPreparation:
          approvalPort.prepareAuthorizedGrant.mockResolvedValueOnce(
            err(failure),
          )
          break
        case ExtensionConsentWorkflowFailureKind.BrowserHandoff:
          approvalPort.deliver.mockRejectedValueOnce(
            new Error('browser handoff failed'),
          )
          break
        case ExtensionConsentWorkflowFailureKind.DeliveryAdmission:
          approvalPort.deliver.mockResolvedValueOnce(err(failure))
          break
        case ExtensionConsentWorkflowFailureKind.DeviceRefresh:
          refreshDeviceState.mockResolvedValueOnce(err(failure))
          break
        case ExtensionConsentWorkflowFailureKind.CompletionAdmission:
          approvalPort.admitCompletion.mockReturnValueOnce(err(failure))
          break
        case ExtensionConsentWorkflowFailureKind.Authorization:
        case ExtensionConsentWorkflowFailureKind.ProviderTransition:
          throw new Error('Scenario must fail after durable approval.')
      }

      let state: ExtensionConsentWorkflowState = harness.workflow.initialState()
      await harness.workflow.approve(state, (next) => {
        state = next
      })

      expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
      expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
      if (state.kind === ExtensionConsentWorkflowKind.Failed) {
        expect(state.failure.kind).toBe(kind)
      }
      expect(harness.workflow.approvalAvailability(state)).toBe(
        NookExtensionConsentApprovalAvailabilityState.AlreadyApproved,
      )
      expect(harness.workflow.closeOutcome(state)).toBe(
        ExtensionConsentCloseOutcome.Approved,
      )
      expect(harness.workflow.canContinue(state)).toBe(true)
      expect(
        new ExtensionConsentWorkflowPresentation().actionTranslationKey(state),
      ).toBe(I18N_KEYS.DevicesAccessTryAgain)

      await harness.workflow.approve(state, (next) => {
        state = next
      })

      expect(state.kind).toBe(ExtensionConsentWorkflowKind.Completed)
      expect(harness.workflow.canContinue(state)).toBe(false)
      expect(approvalPort.authorize).toHaveBeenCalledTimes(1)
      expect(approvalPort.prepareAuthorizedGrant).toHaveBeenCalledTimes(2)
      expect(ExtensionVaultApproval).toHaveBeenCalledOnce()
      expect(approvalPort.deliver).toHaveBeenCalledTimes(deliveryCalls)
      expect(refreshDeviceState).toHaveBeenCalledTimes(refreshCalls)
      expect(approvalPort.admitCompletion).toHaveBeenCalledTimes(
        completionCalls,
      )
      harness.workflow.dispose()
    },
  )

  test('defers phase disposal until an in-flight approval stops and suppresses later publication', async () => {
    const harness = createHarness()
    const preparationStarted = new DeferredWorkflowStage<boolean>()
    const releasePreparation = new DeferredWorkflowStage<boolean>()
    approvalPort.prepareAuthorizedGrant.mockImplementationOnce(async () => {
      preparationStarted.resume(true)
      await releasePreparation.promise
      return ok({} as ExtensionPairingApprovedMessage)
    })

    const trackedPhases = new Set<NookExtensionConsentPhase>()
    const phaseFreeCounts: Array<{ value: number }> = []
    const trackPhase = (phase: NookExtensionConsentPhase) => {
      if (trackedPhases.has(phase)) return
      trackedPhases.add(phase)
      const count = { value: 0 }
      phaseFreeCounts.push(count)
      const free = phase.free.bind(phase)
      vi.spyOn(phase, 'free').mockImplementation(() => {
        count.value += 1
        free()
      })
    }

    let state: ExtensionConsentWorkflowState = harness.workflow.initialState()
    trackPhase(state.phase)
    let publicationCount = 0
    const operation = harness.workflow.approve(state, (next) => {
      publicationCount += 1
      trackPhase(next.phase)
      state = next
    })

    await preparationStarted.promise
    expect(state.kind).toBe(ExtensionConsentWorkflowKind.PreparingGrant)
    expect(phaseFreeCounts.map(({ value }) => value)).toEqual([1, 1, 0])
    const publicationsBeforeDispose = publicationCount

    harness.workflow.dispose()

    expect(phaseFreeCounts.map(({ value }) => value)).toEqual([1, 1, 0])
    releasePreparation.resume(true)
    await operation

    expect(publicationCount).toBe(publicationsBeforeDispose)
    expect(approvalPort.deliver).not.toHaveBeenCalled()
    expect(phaseFreeCounts.map(({ value }) => value)).toEqual([1, 1, 1])
    harness.workflow.dispose()
    expect(phaseFreeCounts.map(({ value }) => value)).toEqual([1, 1, 1])
  })
})
