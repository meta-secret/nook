import { describe, expect, test } from 'vitest'
import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  AuthenticationWorkflowSnapshotResponseKind,
  AuthenticationWorkflowStage,
  type AuthenticationWorkflowRuntimeResponse,
  type AuthenticationWorkflowSnapshot,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  AuthenticationEnrollmentScanDecisionKind,
  AuthenticationEnrollmentWorkflowDeliveryKind,
  authenticationEnrollmentScanDecision,
  performAuthenticationEnrollmentScan,
  postSaveEnrollmentHoldAllowsOrdinarySurface,
  refreshHeldEnrollmentRecoveryPresentation,
} from '../../../../nook-web-extension/src/content/autofill/authentication-enrollment-scan'

function workflow(
  snapshot: AuthenticationWorkflowSnapshot,
): AuthenticationWorkflowRuntimeResponse['workflow'] {
  return {
    kind: AuthenticationWorkflowSnapshotResponseKind.Matched,
    snapshot,
  }
}

const setup: AuthenticationWorkflowSnapshot = {
  kind: AuthenticationWorkflowKind.TotpEnrollment,
  stage: AuthenticationWorkflowStage.Setup,
  action: AuthenticationWorkflowAction.EnrollAuthenticator,
  currentStep: 2,
  totalSteps: 5,
  approvalRequirement: 'explicit-user-approval',
  observationIndex: 0,
}

describe('authentication enrollment scan reclassification', () => {
  test('blocks ordinary surfaces while post-save confirmation is held', () => {
    expect(postSaveEnrollmentHoldAllowsOrdinarySurface(true)).toBe(false)
    expect(postSaveEnrollmentHoldAllowsOrdinarySurface(false)).toBe(true)
  })
  test('removes an unmatched direct enrollment observation', () => {
    const decision = authenticationEnrollmentScanDecision({
      hints: { qr: true, backupCodes: false },
      postSaveHeld: false,
      workflow: {
        kind: AuthenticationWorkflowSnapshotResponseKind.NoMatch,
      },
    })
    expect(decision.kind).toBe(AuthenticationEnrollmentScanDecisionKind.Remove)
  })

  test('renders a Rust-approved setup action before confirmation', () => {
    const decision = authenticationEnrollmentScanDecision({
      hints: { qr: true, backupCodes: true },
      postSaveHeld: false,
      workflow: workflow(setup),
    })
    expect(decision).toEqual({
      kind: AuthenticationEnrollmentScanDecisionKind.RenderNew,
      snapshot: setup,
    })
  })

  test('preserves confirmation when Rust still observes setup', () => {
    const decision = authenticationEnrollmentScanDecision({
      hints: { qr: true, backupCodes: false },
      postSaveHeld: true,
      workflow: workflow(setup),
    })
    expect(decision.kind).toBe(
      AuthenticationEnrollmentScanDecisionKind.PreservePostSave,
    )
  })

  test('releases confirmation only for Rust-approved recovery', () => {
    const recovery: AuthenticationWorkflowSnapshot = {
      ...setup,
      stage: AuthenticationWorkflowStage.Recovery,
      action: AuthenticationWorkflowAction.SaveBackupCodes,
      currentStep: 4,
    }
    const decision = authenticationEnrollmentScanDecision({
      hints: { qr: true, backupCodes: true },
      postSaveHeld: true,
      workflow: workflow(recovery),
    })
    expect(decision).toEqual({
      kind: AuthenticationEnrollmentScanDecisionKind.RenderPostSaveRecovery,
      hints: { qr: false, backupCodes: true },
      snapshot: recovery,
    })
  })

  test('drives held confirmation through Rust-approved reclassification', async () => {
    const rendered: Array<{ kind: string; snapshot: unknown }> = []
    const baseRequest = {
      hints: { qr: true, backupCodes: true },
      postSaveHeld: true,
      isCurrent: () => true,
      loadVaultConnection: async () => ({ connected: true }),
      removeUnavailable: () => rendered.push({ kind: 'removed', snapshot: {} }),
      renderNew: ({ snapshot }: { snapshot: AuthenticationWorkflowSnapshot }) =>
        rendered.push({ kind: 'new', snapshot }),
      renderPostSaveRecovery: ({
        snapshot,
      }: {
        snapshot: AuthenticationWorkflowSnapshot
      }) => rendered.push({ kind: 'recovery', snapshot }),
    }

    await performAuthenticationEnrollmentScan({
      ...baseRequest,
      deliverWorkflow: async () => ({
        kind: AuthenticationEnrollmentWorkflowDeliveryKind.Delivered,
        workflow: workflow(setup),
      }),
    })
    expect(rendered).toEqual([])

    const recovery: AuthenticationWorkflowSnapshot = {
      ...setup,
      stage: AuthenticationWorkflowStage.Recovery,
      action: AuthenticationWorkflowAction.SaveBackupCodes,
      currentStep: 4,
    }
    await performAuthenticationEnrollmentScan({
      ...baseRequest,
      deliverWorkflow: async () => ({
        kind: AuthenticationEnrollmentWorkflowDeliveryKind.Delivered,
        workflow: workflow(recovery),
      }),
    })
    expect(rendered).toEqual([{ kind: 'recovery', snapshot: recovery }])
  })

  test('removes the enrollment surface when snapshot delivery is unavailable', async () => {
    const rendered: string[] = []
    await performAuthenticationEnrollmentScan({
      hints: { qr: true, backupCodes: false },
      postSaveHeld: false,
      deliverWorkflow: async () => ({
        kind: AuthenticationEnrollmentWorkflowDeliveryKind.Unavailable,
      }),
      isCurrent: () => true,
      loadVaultConnection: async () => ({ connected: true }),
      removeUnavailable: () => rendered.push('removed'),
      renderNew: () => rendered.push('new'),
      renderPostSaveRecovery: () => rendered.push('recovery'),
    })
    expect(rendered).toEqual(['removed'])
  })

  test('updates held progress when Rust advances to recovery', () => {
    const step = document.createElement('p')
    const title = document.createElement('h2')
    const description = document.createElement('p')
    const updates: unknown[] = []
    const host = {
      step,
      title,
      description,
      translatedMessage: (key: string) => `translated:${key}`,
    } as never
    const recovery: AuthenticationWorkflowSnapshot = {
      ...setup,
      stage: AuthenticationWorkflowStage.Recovery,
      action: AuthenticationWorkflowAction.SaveBackupCodes,
      currentStep: 4,
    }

    refreshHeldEnrollmentRecoveryPresentation({
      host,
      snapshot: recovery,
      updateProgress: (args) => updates.push(args),
    })

    expect(updates).toEqual([
      expect.objectContaining({
        step,
        title,
        currentStep: 4,
        totalSteps: 5,
      }),
    ])
    expect(description.textContent).toContain('WidgetBackupDescription')
  })
})
