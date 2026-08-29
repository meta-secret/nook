import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { authenticationRecoveryCopy } from '../../lib/backup-code-candidates'
import {
  startBackupCodeEnrollment,
  type EnrollmentFlowHost,
} from '../enrollment-flow'
import {
  AuthenticationObservationBindingKind,
  performRevalidatedAuthenticationAction,
} from './workflow-revalidation'

type StartRevalidatedBackupCodeEnrollmentArgs = {
  workflow: PasswordFormObservation
  host: EnrollmentFlowHost
}

export async function startRevalidatedBackupCodeEnrollment({
  workflow,
  host,
}: StartRevalidatedBackupCodeEnrollmentArgs): Promise<boolean> {
  return performRevalidatedAuthenticationAction({
    workflow,
    expectedAction: AuthenticationWorkflowAction.SaveBackupCodes,
    observationBinding: {
      kind: AuthenticationObservationBindingKind.Unbound,
    },
    backupCodesCopy: authenticationRecoveryCopy(),
    act: () => {
      startBackupCodeEnrollment({ host })
      return true
    },
  })
}
