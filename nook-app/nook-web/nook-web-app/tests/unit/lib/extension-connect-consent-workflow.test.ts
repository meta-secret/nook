import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const approvalPort = vi.hoisted(() => ({
  authorize: vi.fn(),
  prepareAuthorizedGrant: vi.fn(),
  deliver: vi.fn(),
  admitCompletion: vi.fn(),
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
import { VaultStorageFailure, VaultStorageFailureKind } from '$lib/runtime/storage-failure'
import {
  NookExtensionConsentApprovalAvailabilityState,
  NookExtensionConsentPhaseState,
  NookExtensionConsentVaultReadiness,
  NookVaultManager,
} from '$app-wasm'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import type { VaultState } from '$lib/vault.svelte'
import type { ExtensionPairingApprovedMessage } from '$web-shared/extension/runtime-messages'

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

async function approve(harness: ReturnType<typeof createHarness>) {
  let state: ExtensionConsentWorkflowState = harness.workflow.initialState()
  await harness.workflow.approve(state, (next) => {
    state = next
  })
  return state
}

beforeEach(() => {
  vi.restoreAllMocks()
  approvalPort.authorize.mockResolvedValue(ok())
  approvalPort.prepareAuthorizedGrant.mockResolvedValue(
    ok({} as ExtensionPairingApprovedMessage),
  )
  approvalPort.deliver.mockResolvedValue(
    ok({ kind: ExtensionPairingDeliveryKind.Delivered }),
  )
  approvalPort.admitCompletion.mockReturnValue(ok())
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
        availability: NookExtensionConsentApprovalAvailabilityState.ManagerUnavailable,
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
      expect(state.phase.state).toBe(NookExtensionConsentPhaseState.AwaitingAuthorization)
      harness.workflow.dispose(state)
    }
  })

  test('defers eligibility to Rust and does not authorize while blocked', async () => {
    const harness = createHarness()
    harness.vault.isSaving = true

    const initial = harness.workflow.initialState()
    await harness.workflow.approve(initial, vi.fn())

    expect(approvalPort.authorize).not.toHaveBeenCalled()
    harness.workflow.dispose(initial)
  })

  test('transitions durable approval before grant delivery and completes delivered outcome', async () => {
    const harness = createHarness()

    const state = await approve(harness)

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Completed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.outcome).toEqual({ kind: ExtensionConsentDeliveryOutcomeKind.Delivered })
    expect(harness.workflow.closeOutcome(state)).toBe(
      ExtensionConsentCloseOutcome.Approved,
    )
    harness.workflow.dispose(state)
  })

  test.each([
    [
      'messaging unavailable',
      { kind: ExtensionPairingDeliveryKind.MessagingUnavailable },
      ExtensionConsentDeliveryOutcomeKind.MessagingUnavailable,
      I18N_KEYS.ExtensionConsentMessagingUnavailable,
    ],
    [
      'plaintext provider migration required',
      { kind: ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired },
      ExtensionConsentDeliveryOutcomeKind.PlaintextProviderMigrationRequired,
      I18N_KEYS.ExtensionConsentPlaintextProviderMigrationRequired,
    ],
  ])('keeps %s as a translated post-authorization outcome', async (_name, delivery, outcome, key) => {
    const harness = createHarness()
    approvalPort.deliver.mockResolvedValue(ok(delivery))

    const state = await approve(harness)
    const notice = new ExtensionConsentWorkflowPresentation().notice(
      state,
      harness.workflow.approvalAvailability(state),
    )

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Completed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.outcome.kind).toBe(outcome)
    expect(notice).toEqual({
      kind: ExtensionConsentWorkflowNoticeKind.Message,
      translationKey: key,
    })
    harness.workflow.dispose(state)
  })

  test('stores a typed rejection reason and projects translated copy at the UI edge', async () => {
    const harness = createHarness()
    approvalPort.deliver.mockResolvedValue(
      ok({
        kind: ExtensionPairingDeliveryKind.Rejected,
        reason: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
      }),
    )

    const state = await approve(harness)
    const notice = new ExtensionConsentWorkflowPresentation().notice(
      state,
      harness.workflow.approvalAvailability(state),
    )

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Completed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.outcome).toEqual({
      kind: ExtensionConsentDeliveryOutcomeKind.Rejected,
      rejection: {
        kind: ExtensionConsentRejectionKind.WithReason,
        reason: ExtensionPairingRejectionReason.EventLogAccessNotGranted,
      },
    })
    expect(notice).toMatchObject({
      kind: ExtensionConsentWorkflowNoticeKind.Rejected,
      translationKey: I18N_KEYS.ExtensionConsentGrantRejected,
    })
    harness.workflow.dispose(state)
  })

  test('preserves rejection without inventing a free-form reason', async () => {
    const harness = createHarness()
    approvalPort.deliver.mockResolvedValue(
      ok({ kind: ExtensionPairingDeliveryKind.Rejected }),
    )

    const state = await approve(harness)

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Completed)
    expect(state.outcome).toEqual({
      kind: ExtensionConsentDeliveryOutcomeKind.Rejected,
      rejection: { kind: ExtensionConsentRejectionKind.WithoutReason },
    })
    harness.workflow.dispose(state)
  })

  test('keeps authorization failure retryable and cancellation-owned', async () => {
    const harness = createHarness()
    const failure = new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)
    approvalPort.authorize.mockResolvedValue(err(failure))

    const state = await approve(harness)
    const notice = new ExtensionConsentWorkflowPresentation().notice(
      state,
      harness.workflow.approvalAvailability(state),
    )

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.AuthorizationFailed)
    expect(state.failure.kind).toBe(ExtensionConsentWorkflowFailureKind.Authorization)
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
    harness.workflow.dispose(state)
  })

  test('retains approved phase after grant preparation failure', async () => {
    const harness = createHarness()
    const failure = new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)
    approvalPort.prepareAuthorizedGrant.mockResolvedValue(err(failure))

    const state = await approve(harness)

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.failure.kind).toBe(ExtensionConsentWorkflowFailureKind.GrantPreparation)
    expect(harness.workflow.closeOutcome(state)).toBe(
      ExtensionConsentCloseOutcome.Approved,
    )
    harness.workflow.dispose(state)
  })

  test('retains approved phase after delivery admission failure', async () => {
    const harness = createHarness()
    const failure = new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)
    approvalPort.deliver.mockResolvedValue(err(failure))

    const state = await approve(harness)

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.failure.kind).toBe(ExtensionConsentWorkflowFailureKind.DeliveryAdmission)
    expect(harness.workflow.closeOutcome(state)).toBe(
      ExtensionConsentCloseOutcome.Approved,
    )
    harness.workflow.dispose(state)
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
    expect(state.failure.kind).toBe(ExtensionConsentWorkflowFailureKind.BrowserHandoff)
    expect(notice).toEqual({
      kind: ExtensionConsentWorkflowNoticeKind.Message,
      translationKey: I18N_KEYS.ExtensionConnectIdentityHandoffFailed,
    })
    harness.workflow.dispose(state)
  })

  test('retains approved phase for refresh and completion failures', async () => {
    const harness = createHarness()
    const failure = new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)
    harness.vault.refreshDeviceState = vi.fn(async () => err(failure))

    const state = await approve(harness)

    expect(state.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(state.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(state.failure.kind).toBe(ExtensionConsentWorkflowFailureKind.DeviceRefresh)

    approvalPort.admitCompletion.mockReturnValue(err(failure))
    const completionHarness = createHarness()
    completionHarness.vault.refreshDeviceState = vi.fn(async () => ok())
    const completionState = await approve(completionHarness)
    expect(completionState.kind).toBe(ExtensionConsentWorkflowKind.Failed)
    expect(completionState.phase.state).toBe(NookExtensionConsentPhaseState.Approved)
    expect(completionState.failure.kind).toBe(ExtensionConsentWorkflowFailureKind.CompletionAdmission)
    harness.workflow.dispose(state)
    completionHarness.workflow.dispose(completionState)
  })
})
