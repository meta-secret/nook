import {
  AuthenticationWorkflowSnapshotResponseKind,
  type AuthenticationWorkflowRuntimeResponse,
  type AuthenticationWorkflowSnapshot,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { EnrollmentPageHints } from '../enrollment-flow-view'
import type { EnrollmentFlowHost } from '../enrollment-flow'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'
import { approvedPostSaveEnrollmentHints } from './authentication-enrollment-observation'

export enum AuthenticationEnrollmentScanDecisionKind {
  Remove = 'remove',
  RenderNew = 'render-new',
  PreservePostSave = 'preserve-post-save',
  RenderPostSaveRecovery = 'render-post-save-recovery',
}

export type AuthenticationEnrollmentScanDecision =
  | { kind: AuthenticationEnrollmentScanDecisionKind.Remove }
  | {
      kind: AuthenticationEnrollmentScanDecisionKind.RenderNew
      snapshot: AuthenticationWorkflowSnapshot
    }
  | { kind: AuthenticationEnrollmentScanDecisionKind.PreservePostSave }
  | {
      kind: AuthenticationEnrollmentScanDecisionKind.RenderPostSaveRecovery
      hints: EnrollmentPageHints
      snapshot: AuthenticationWorkflowSnapshot
    }

export type AuthenticationEnrollmentScanDecisionRequest = {
  hints: EnrollmentPageHints
  postSaveHeld: boolean
  workflow: AuthenticationWorkflowRuntimeResponse['workflow']
}

export enum AuthenticationEnrollmentWorkflowDeliveryKind {
  Delivered = 'delivered',
  Unavailable = 'unavailable',
}

export type AuthenticationEnrollmentWorkflowDelivery =
  | { kind: AuthenticationEnrollmentWorkflowDeliveryKind.Unavailable }
  | {
      kind: AuthenticationEnrollmentWorkflowDeliveryKind.Delivered
      workflow: AuthenticationWorkflowRuntimeResponse['workflow']
    }

export type AuthenticationEnrollmentScanRequest<VaultConnection> = {
  hints: EnrollmentPageHints
  postSaveHeld: boolean
  deliverWorkflow: () => Promise<AuthenticationEnrollmentWorkflowDelivery>
  isCurrent: () => boolean
  loadVaultConnection: () => Promise<VaultConnection>
  removeUnavailable: () => void
  renderNew: (args: {
    snapshot: AuthenticationWorkflowSnapshot
    vaultConnection: VaultConnection
  }) => void
  renderPostSaveRecovery: (args: {
    hints: EnrollmentPageHints
    snapshot: AuthenticationWorkflowSnapshot
  }) => void
}

export function postSaveEnrollmentHoldAllowsOrdinarySurface(
  postSaveHeld: boolean,
): boolean {
  return !postSaveHeld
}

export type HeldEnrollmentRecoveryPresentationRequest = {
  host: EnrollmentFlowHost
  snapshot: AuthenticationWorkflowSnapshot
  updateProgress: (args: {
    step: HTMLParagraphElement
    title: HTMLHeadingElement
    currentStep: number
    totalSteps: number
    titleKey: BrowserMessageKey
  }) => void
}

export function refreshHeldEnrollmentRecoveryPresentation({
  host,
  snapshot,
  updateProgress,
}: HeldEnrollmentRecoveryPresentationRequest): void {
  updateProgress({
    step: host.step,
    title: host.title,
    currentStep: snapshot.currentStep,
    totalSteps: snapshot.totalSteps,
    titleKey: BROWSER_MESSAGE_KEYS.WidgetBackupTitle,
  })
  host.description.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetBackupDescription,
  )
}

export function authenticationEnrollmentScanDecision({
  hints,
  postSaveHeld,
  workflow,
}: AuthenticationEnrollmentScanDecisionRequest): AuthenticationEnrollmentScanDecision {
  if (
    workflow.kind !== AuthenticationWorkflowSnapshotResponseKind.Matched ||
    !('snapshot' in workflow)
  ) {
    return { kind: AuthenticationEnrollmentScanDecisionKind.Remove }
  }
  if (!postSaveHeld) {
    return {
      kind: AuthenticationEnrollmentScanDecisionKind.RenderNew,
      snapshot: workflow.snapshot,
    }
  }
  const approvedHints = approvedPostSaveEnrollmentHints({
    hints,
    snapshot: workflow.snapshot,
  })
  return approvedHints.backupCodes
    ? {
        kind: AuthenticationEnrollmentScanDecisionKind.RenderPostSaveRecovery,
        hints: approvedHints,
        snapshot: workflow.snapshot,
      }
    : { kind: AuthenticationEnrollmentScanDecisionKind.PreservePostSave }
}

/**
 * Deliver and apply one enrollment scan. Rust owns classification; this
 * coordinator owns only stale-result rejection and the corresponding UI edge.
 */
export async function performAuthenticationEnrollmentScan<VaultConnection>({
  hints,
  postSaveHeld,
  deliverWorkflow,
  isCurrent,
  loadVaultConnection,
  removeUnavailable,
  renderNew,
  renderPostSaveRecovery,
}: AuthenticationEnrollmentScanRequest<VaultConnection>): Promise<void> {
  const delivery = await deliverWorkflow()
  if (!isCurrent()) return
  if (
    delivery.kind === AuthenticationEnrollmentWorkflowDeliveryKind.Unavailable
  ) {
    removeUnavailable()
    return
  }
  const decision = authenticationEnrollmentScanDecision({
    hints,
    postSaveHeld,
    workflow: delivery.workflow,
  })
  if (decision.kind === AuthenticationEnrollmentScanDecisionKind.Remove) {
    removeUnavailable()
    return
  }
  if (
    decision.kind ===
    AuthenticationEnrollmentScanDecisionKind.RenderPostSaveRecovery
  ) {
    renderPostSaveRecovery({
      hints: decision.hints,
      snapshot: decision.snapshot,
    })
    return
  }
  if (
    decision.kind === AuthenticationEnrollmentScanDecisionKind.PreservePostSave
  ) {
    return
  }
  const vaultConnection = await loadVaultConnection()
  if (!isCurrent()) return
  renderNew({ snapshot: decision.snapshot, vaultConnection })
}
