import {
  authenticationWorkflowScopesMatch,
  liveApprovedAuthenticationWorkflow,
} from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { detectEnrollmentHints } from '../enrollment-flow'
import { WidgetWorkflowRootKind, widgetState } from './state'

type PasskeyWidgetStatusUpdate = {
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  text: string
  enableContinue: boolean
}

export function setStatus({
  description,
  continueButton,
  text,
  enableContinue,
}: PasskeyWidgetStatusUpdate): void {
  description.textContent = text
  continueButton.disabled = !enableContinue || widgetState.busy
}

export function approvedWorkflowIsStillCurrent(
  workflow: PasswordFormObservation,
): boolean {
  const rendered = widgetState.renderedWorkflowRoot
  if (rendered.kind !== WidgetWorkflowRootKind.Assigned) return false
  const scopePair: Parameters<typeof authenticationWorkflowScopesMatch>[0] = {
    left: rendered.observation,
    right: workflow,
  }
  if (!authenticationWorkflowScopesMatch(scopePair)) {
    return false
  }
  const hints = detectEnrollmentHints()
  const liveRequest: Parameters<typeof liveApprovedAuthenticationWorkflow>[0] =
    {
      approved: {
        observation: rendered.observation,
        facts: rendered.facts,
      },
      authenticatorSetupHint: hints.qr,
      backupCodesHint: hints.backupCodes,
    }
  return liveApprovedAuthenticationWorkflow(liveRequest)
}
