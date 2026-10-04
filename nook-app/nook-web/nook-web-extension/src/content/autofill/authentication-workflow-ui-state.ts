import {
  AuthenticationControlIdentitySnapshot,
  AuthenticationControlIdentityComparison,
} from './workflow-revalidation'
import { pageQrCapture } from '../../lib/page-qr-capture'
import {
  AuthenticationWorkflowScopeComparison,
  AuthenticationWorkflowScopeDisposition,
  LiveAuthenticationWorkflowDisposition,
  LiveApprovedAuthenticationWorkflow,
} from '../../../../nook-web-shared/src/extension/password-form-classified-observations'

import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'

import { authenticatorEnrollmentInteraction } from '../enrollment-flow'

import { WidgetWorkflowAdmissionKind, widgetState } from './state'

type PasskeyWidgetStatusUpdate = {
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  text: string
  enableContinue: boolean
}

/** Owns the browser runtime resources shared by these interactions. */
type AuthenticationWorkflowUiContext = {
  readonly widgetState: typeof widgetState
}
class AuthenticationWorkflowUi {
  constructor(private readonly ui: AuthenticationWorkflowUiContext) {}

  setStatus({
    description,
    continueButton,
    text,
    enableContinue,
  }: PasskeyWidgetStatusUpdate): void {
    description.textContent = text
    continueButton.disabled = !enableContinue || this.ui.widgetState.busy
  }

  async approvedWorkflowDisposition(
    workflow: PasswordFormObservation,
  ): Promise<LiveAuthenticationWorkflowDisposition> {
    const rendered = this.ui.widgetState.workflowAdmission()
    if (rendered.kind !== WidgetWorkflowAdmissionKind.Assigned)
      return LiveAuthenticationWorkflowDisposition.Changed
    const scopePair: ConstructorParameters<
      typeof AuthenticationWorkflowScopeComparison
    >[0] = {
      left: rendered.observation,
      right: workflow,
    }
    if (
      new AuthenticationWorkflowScopeComparison(scopePair).disposition !==
      AuthenticationWorkflowScopeDisposition.Same
    ) {
      return LiveAuthenticationWorkflowDisposition.Changed
    }
    const workflowIsAttached = () =>
      workflow.root.isConnected &&
      (workflow.root === document || workflow.root.ownerDocument === document)
    if (!workflowIsAttached())
      return LiveAuthenticationWorkflowDisposition.Changed
    const controls = AuthenticationControlIdentitySnapshot.capture(workflow)
    const setupSnapshot =
      await pageQrCapture.prepareAuthenticationAuthenticatorSetupObservation()
    const current = this.ui.widgetState.workflowAdmission()
    if (
      !workflowIsAttached() ||
      controls.compare(
        AuthenticationControlIdentitySnapshot.capture(workflow),
      ) === AuthenticationControlIdentityComparison.Changed ||
      current.kind !== WidgetWorkflowAdmissionKind.Assigned ||
      current.observation !== rendered.observation ||
      current.facts !== rendered.facts ||
      !pageQrCapture.authenticationAuthenticatorSetupSnapshotIsCurrent(
        setupSnapshot,
      )
    )
      return LiveAuthenticationWorkflowDisposition.Changed
    const hints =
      authenticatorEnrollmentInteraction.detectEnrollmentHints(setupSnapshot)
    const liveRequest: ConstructorParameters<
      typeof LiveApprovedAuthenticationWorkflow
    >[0] = {
      approved: {
        observation: rendered.observation,
        facts: rendered.facts,
      },
      authenticatorSetupHint: hints.qr,
      backupCodesHint: hints.backupCodes,
    }
    const disposition = await new LiveApprovedAuthenticationWorkflow(
      liveRequest,
    ).extensionDisposition(globalThis)
    const afterDecision = this.ui.widgetState.workflowAdmission()
    if (
      !workflowIsAttached() ||
      afterDecision.kind !== WidgetWorkflowAdmissionKind.Assigned ||
      afterDecision.observation !== rendered.observation ||
      afterDecision.facts !== rendered.facts ||
      controls.compare(
        AuthenticationControlIdentitySnapshot.capture(workflow),
      ) === AuthenticationControlIdentityComparison.Changed ||
      !pageQrCapture.authenticationAuthenticatorSetupSnapshotIsCurrent(
        setupSnapshot,
      )
    )
      return LiveAuthenticationWorkflowDisposition.Changed
    return disposition
  }
}

const authenticationWorkflowUiDependencies: ConstructorParameters<
  typeof AuthenticationWorkflowUi
>[0] = {
  widgetState,
}
export const authenticationWorkflowUi = new AuthenticationWorkflowUi(
  authenticationWorkflowUiDependencies,
)
