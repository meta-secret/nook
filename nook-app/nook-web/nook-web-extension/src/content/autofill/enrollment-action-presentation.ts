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
    switch (action) {
      case AuthenticationWorkflowAction.EnrollAuthenticator:
        return { qr: 'present', backupCodes: false }
      case AuthenticationWorkflowAction.SaveBackupCodes:
        return { qr: 'absent', backupCodes: true }
      case AuthenticationWorkflowAction.ContinueWithNook:
      case AuthenticationWorkflowAction.GeneratePassword:
      case AuthenticationWorkflowAction.FillTotp:
      case AuthenticationWorkflowAction.UsePasskey:
      case AuthenticationWorkflowAction.CreatePasskey:
      case AuthenticationWorkflowAction.TakeOver:
        return { qr: 'absent', backupCodes: false }
    }
  }
}
export class SupplementalEnrollmentPresentation {
  constructor(private readonly request: SupplementalEnrollmentHintsRequest) {}
  get hints(): EnrollmentPageHints {
    const { action, detected } = this.request
    switch (action) {
      case AuthenticationWorkflowAction.SaveBackupCodes:
      case AuthenticationWorkflowAction.EnrollAuthenticator:
        return { qr: 'absent', backupCodes: false }
      case AuthenticationWorkflowAction.ContinueWithNook:
      case AuthenticationWorkflowAction.GeneratePassword:
      case AuthenticationWorkflowAction.FillTotp:
      case AuthenticationWorkflowAction.UsePasskey:
      case AuthenticationWorkflowAction.CreatePasskey:
      case AuthenticationWorkflowAction.TakeOver:
        return detected
    }
  }
}
