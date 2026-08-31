import { type PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { documentAuthenticationWorkflowObservation } from '../../../../nook-web-shared/src/extension/document-authentication-workflow-observation'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { EnrollmentFlowHost } from '../enrollment-flow'
import {
  AuthenticationObservationBindingKind,
  performRevalidatedAuthenticationAction,
  RevalidatedAuthenticationActionOutcomeKind,
  RevalidatedAuthenticationActResultKind,
} from './workflow-revalidation'

type StartRevalidatedBackupCodeEnrollmentArgs = {
  workflow?: PasswordFormObservation
  host: EnrollmentFlowHost
  start: () => void
}

export async function startRevalidatedBackupCodeEnrollment({
  workflow = documentAuthenticationWorkflowObservation(),
  host,
  start,
}: StartRevalidatedBackupCodeEnrollmentArgs): Promise<boolean> {
  if (host.isBusy()) return false
  host.setBusy(true)
  let started = false
  try {
    const observationBinding: Parameters<
      typeof performRevalidatedAuthenticationAction
    >[0]['observationBinding'] = {
      kind: AuthenticationObservationBindingKind.Unbound,
    }
    const revalidationRequest: Parameters<
      typeof performRevalidatedAuthenticationAction
    >[0] = {
      workflow,
      expectedAction: AuthenticationWorkflowAction.SaveBackupCodes,
      observationBinding,
      approvalIsActive: () => host.isBusy() && host.panel.isConnected,
      act: () => {
        start()
        started = true
        const result: ReturnType<
          Parameters<typeof performRevalidatedAuthenticationAction>[0]['act']
        > = { kind: RevalidatedAuthenticationActResultKind.Acted }
        return result
      },
    }
    const outcome =
      await performRevalidatedAuthenticationAction(revalidationRequest)
    return outcome.kind === RevalidatedAuthenticationActionOutcomeKind.Acted
  } finally {
    if (!started) host.setBusy(false)
  }
}
