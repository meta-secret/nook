import type {
  AuthenticationPageObservationFacts,
  AuthenticationWorkflowRuntimeResponse,
  AuthenticationWorkflowRuntimeResponseWire,
  AuthenticationWorkflowSnapshot,
  WebsiteLoginMatchAvailability,
  WebsiteLoginMatchAvailabilityWire,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type {
  AuthenticationWorkflowRuntimeResponse,
  AuthenticationWorkflowRuntimeResponseWire,
  WebsiteLoginMatchAvailability,
  WebsiteLoginMatchAvailabilityWire,
}
export type AuthenticationPageObservationView =
  AuthenticationPageObservationFacts

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
    if (
      !observation.fields ||
      typeof observation.fields !== 'object' ||
      !observation.ceremony ||
      typeof observation.ceremony !== 'object' ||
      !observation.authenticator ||
      typeof observation.authenticator !== 'object'
    ) {
      return false
    }
    return (
      [
        observation.fields.usernameFieldCount,
        observation.fields.currentPasswordFieldCount,
        observation.fields.newPasswordFieldCount,
        observation.fields.genericPasswordFieldCount,
        observation.fields.oneTimeCodeFieldCount,
      ].every(
        (count) =>
          typeof count === 'number' && Number.isInteger(count) && count >= 0,
      ) &&
      typeof observation.ceremony.manualCheckpoint === 'string' &&
      typeof observation.ceremony.oneTimeCodeProgression === 'string' &&
      typeof observation.ceremony.advanceControl === 'string' &&
      typeof observation.authenticator.authenticatorSetup === 'string' &&
      typeof observation.authenticator.backupCodes === 'string' &&
      typeof observation.authenticator.passkeyControl === 'string' &&
      typeof observation.authenticator.matchingPasskeyAccountCount ===
        'number' &&
      Number.isInteger(observation.authenticator.matchingPasskeyAccountCount) &&
      observation.authenticator.matchingPasskeyAccountCount >= 0
    )
  })
}
