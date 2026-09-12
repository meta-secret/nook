import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { EnrollmentPageHints } from '../enrollment-flow'

type SupplementalEnrollmentHintsRequest = {
  action: AuthenticationWorkflowAction
  detected: EnrollmentPageHints
}

export class SelectedEnrollmentPresentation {
  constructor(private readonly request: AuthenticationWorkflowAction) {}
  get hints(): EnrollmentPageHints {
    const action = this.request
    return {
      qr: action === AuthenticationWorkflowAction.EnrollAuthenticator,
      backupCodes: action === AuthenticationWorkflowAction.SaveBackupCodes,
    }
  }
}
export class SupplementalEnrollmentPresentation {
  constructor(private readonly request: SupplementalEnrollmentHintsRequest) {}
  get hints(): EnrollmentPageHints {
    const { action, detected } = this.request
    return action === AuthenticationWorkflowAction.SaveBackupCodes ||
      action === AuthenticationWorkflowAction.EnrollAuthenticator
      ? { qr: false, backupCodes: false }
      : detected
  }
}
