import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { EnrollmentPageHints } from '../enrollment-flow'

export function selectedEnrollmentHints(
  action: AuthenticationWorkflowAction,
): EnrollmentPageHints {
  return {
    qr: action === AuthenticationWorkflowAction.EnrollAuthenticator,
    backupCodes: action === AuthenticationWorkflowAction.SaveBackupCodes,
  }
}

type SupplementalEnrollmentHintsRequest = {
  action: AuthenticationWorkflowAction
  detected: EnrollmentPageHints
}

export function supplementalEnrollmentHints({
  action,
  detected,
}: SupplementalEnrollmentHintsRequest): EnrollmentPageHints {
  return action === AuthenticationWorkflowAction.SaveBackupCodes
    ? { qr: false, backupCodes: false }
    : detected
}
