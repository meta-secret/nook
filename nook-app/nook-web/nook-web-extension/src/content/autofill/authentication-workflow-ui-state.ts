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

  approvedWorkflowDisposition(
    workflow: PasswordFormObservation,
  ): LiveAuthenticationWorkflowDisposition {
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
    const hints = authenticatorEnrollmentInteraction.detectEnrollmentHints()
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
    return new LiveApprovedAuthenticationWorkflow(liveRequest).disposition
  }
}

// eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
export const authenticationWorkflowUi = new AuthenticationWorkflowUi({
  widgetState,
})
