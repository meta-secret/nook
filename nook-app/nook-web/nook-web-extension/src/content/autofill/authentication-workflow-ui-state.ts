import {
  AuthenticationWorkflowScopeComparison,
  LiveApprovedAuthenticationWorkflow,
} from '../../../../nook-web-shared/src/extension/password-form-classified-observations'

import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'

import { authenticatorEnrollmentInteraction } from '../enrollment-flow'

import { WidgetWorkflowRootKind, widgetState } from './state'

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

  approvedWorkflowIsStillCurrent(workflow: PasswordFormObservation): boolean {
    const rendered = this.ui.widgetState.renderedWorkflowRoot
    if (rendered.kind !== WidgetWorkflowRootKind.Assigned) return false
    const scopePair: ConstructorParameters<
      typeof AuthenticationWorkflowScopeComparison
    >[0] = {
      left: rendered.observation,
      right: workflow,
    }
    if (!new AuthenticationWorkflowScopeComparison(scopePair).matches) {
      return false
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
    return new LiveApprovedAuthenticationWorkflow(liveRequest).observation
  }
}

export const authenticationWorkflowUi = new AuthenticationWorkflowUi({
  widgetState,
})
