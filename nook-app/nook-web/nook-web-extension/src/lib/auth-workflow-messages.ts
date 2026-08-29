import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationDetailedAdvanceControlObservation,
  AuthenticationPageObservationFacts,
  AuthenticationWorkflowSnapshot,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type AuthenticationPageObservationView = AuthenticationPageObservationFacts
export type AuthenticationWorkflowSnapshotView = AuthenticationWorkflowSnapshot

export enum AuthenticationWorkflowSnapshotMessageType {
  NookAuthenticationWorkflowSnapshot = 'nook:authentication-workflow-snapshot',
}

export const MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS = 64

export type AuthenticationWorkflowSnapshotMessage = {
  type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot
  payload: {
    origin: string
    observations: AuthenticationPageObservationView[]
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isAdvanceControl(
  value: unknown,
): value is AuthenticationAdvanceControlObservation {
  if (!value || typeof value !== 'object') return false
  const control = value as AuthenticationAdvanceControlObservation
  return (
    ['inert', 'actionable'].includes(control.actionability) &&
    ['unowned', 'owned-form', 'locally-scoped'].includes(control.ownership) &&
    ['activation', 'semantic-submit'].includes(control.semantics) &&
    [
      'absent',
      'generic',
      'standards-based-email',
      'strong',
      'explicit',
    ].includes(control.authenticationUsername) &&
    [
      control.passwordFieldCount,
      control.newPasswordFieldCount,
      control.oneTimeCodeFieldCount,
      control.semanticSubmitControlCount,
    ].every(isCount) &&
    [
      control.sourceOrigin,
      control.formIdentity,
      control.destinationIdentity,
      control.label,
    ].every((identity) => typeof identity === 'string')
  )
}

function isDetailedControl(
  value: unknown,
): value is AuthenticationDetailedAdvanceControlObservation {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false
  if (value.kind === 'absent') return true
  return (
    value.kind === 'observed' &&
    'observation' in value &&
    isAdvanceControl(value.observation)
  )
}

export function isAuthenticationWorkflowSnapshotMessage(
  message: unknown,
): message is AuthenticationWorkflowSnapshotMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !==
      AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object' ||
    !('origin' in message.payload) ||
    typeof message.payload.origin !== 'string' ||
    !('observations' in message.payload) ||
    !Array.isArray(message.payload.observations) ||
    message.payload.observations.length === 0 ||
    message.payload.observations.length >
      MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS
  ) {
    return false
  }
  return message.payload.observations.every((value) => {
    if (!value || typeof value !== 'object') return false
    const observation = value as AuthenticationPageObservationView
    const { fields, ceremony, authenticator } = observation
    const authenticationContext = ceremony?.authenticationContext
    return (
      Boolean(fields && ceremony && authenticator) &&
      [
        fields.usernameFieldCount,
        fields.currentPasswordFieldCount,
        fields.newPasswordFieldCount,
        fields.genericPasswordFieldCount,
        fields.oneTimeCodeFieldCount,
        authenticator.matchingPasskeyAccountCount,
      ].every(isCount) &&
      ['absent', 'present'].includes(ceremony.manualCheckpoint) &&
      ['advance-control-required', 'auto-submit-observed'].includes(
        ceremony.oneTimeCodeProgression,
      ) &&
      typeof ceremony.oneTimeCodeHandlerSignal === 'string' &&
      Boolean(authenticationContext) &&
      typeof authenticationContext?.sourceOrigin === 'string' &&
      typeof authenticationContext.formIdentity === 'string' &&
      typeof authenticationContext.destinationIdentity === 'string' &&
      ['absent', 'present'].includes(authenticator.authenticatorSetup) &&
      ['absent', 'present'].includes(authenticator.backupCodes) &&
      ['absent', 'present'].includes(authenticator.passkeyControl) &&
      isDetailedControl(observation.detailedAdvanceControl) &&
      isDetailedControl(authenticator.detailedPasskeyControl)
    )
  })
}
