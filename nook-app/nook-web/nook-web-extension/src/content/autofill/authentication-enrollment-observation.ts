import {
  AuthenticationWorkflowAction,
  authentication_workflow_pilot_presentation_capability,
  type AuthenticationPageObservationFacts,
  type AuthenticationWorkflowSnapshot,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { EnrollmentPageHints } from '../enrollment-flow-view'

export type AuthenticationEnrollmentObservationRequest = {
  authenticatorSetupPresent: boolean
  backupCodesCopy: string
  manualCheckpointPresent: boolean
}

/** Collect direct enrollment facts only; Rust owns workflow and action selection. */
export function authenticationEnrollmentObservationFacts({
  authenticatorSetupPresent,
  backupCodesCopy,
  manualCheckpointPresent,
}: AuthenticationEnrollmentObservationRequest): AuthenticationPageObservationFacts {
  return {
    fields: {
      usernameFieldCount: 0,
      currentPasswordFieldCount: 0,
      newPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      oneTimeCodeFieldCount: 0,
    },
    ceremony: {
      oneTimeCodeProgression: 'advance-control-required',
      oneTimeCodeHandlerSignal: '',
      oneTimeCodeHandlerSignals: [],
      authenticationContext: {
        authenticationUsername: 'absent',
        sourceOrigin: location.origin,
        formIdentity: '',
        destinationIdentity: '',
      },
      manualCheckpoint: manualCheckpointPresent ? 'present' : 'absent',
      advanceControl: 'absent',
    },
    authenticator: {
      authenticatorSetup: authenticatorSetupPresent ? 'present' : 'absent',
      backupCodesCopy,
      passkeyControl: 'absent',
      matchingPasskeyAccountCount: 0,
      detailedPasskeyControl: { kind: 'absent' },
    },
    detailedAdvanceControl: { kind: 'absent' },
  }
}

export function approvedPostSaveEnrollmentHints({
  hints,
  snapshot,
}: ApprovedEnrollmentHintsRequest): EnrollmentPageHints {
  const approved = approvedEnrollmentHints({ hints, snapshot })
  return {
    qr: false,
    backupCodes:
      snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes &&
      approved.backupCodes,
  }
}

export type ApprovedEnrollmentHintsRequest = {
  hints: EnrollmentPageHints
  snapshot: AuthenticationWorkflowSnapshot
}

/** Adapt only the closed Rust-approved action into the corresponding page actuator. */
export function approvedEnrollmentHints({
  hints,
  snapshot,
}: ApprovedEnrollmentHintsRequest): EnrollmentPageHints {
  if (
    authentication_workflow_pilot_presentation_capability(snapshot) !==
    'propose-action'
  ) {
    return { qr: false, backupCodes: false }
  }
  return {
    qr:
      snapshot.action === AuthenticationWorkflowAction.EnrollAuthenticator &&
      hints.qr,
    backupCodes:
      snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes &&
      hints.backupCodes,
  }
}
