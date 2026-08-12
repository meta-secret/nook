import type { PasswordFormSummary } from '../../../nook-web-shared/src/extension/password-forms'
import type { AuthenticationWorkflowSnapshot } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type AuthenticationPageObservationView = Pick<
  PasswordFormSummary,
  | 'usernameFieldCount'
  | 'currentPasswordFieldCount'
  | 'newPasswordFieldCount'
  | 'genericPasswordFieldCount'
  | 'oneTimeCodeFieldCount'
  | 'manualCheckpointPresent'
  | 'passkeyControlPresent'
> & {
  authenticatorSetupHint: boolean
  backupCodesHint: boolean
  matchingPasskeyAccountCount: number
}

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
    return (
      [
        observation.usernameFieldCount,
        observation.currentPasswordFieldCount,
        observation.newPasswordFieldCount,
        observation.genericPasswordFieldCount,
        observation.oneTimeCodeFieldCount,
      ].every(
        (count) =>
          typeof count === 'number' && Number.isInteger(count) && count >= 0,
      ) &&
      typeof observation.manualCheckpointPresent === 'boolean' &&
      typeof observation.authenticatorSetupHint === 'boolean' &&
      typeof observation.backupCodesHint === 'boolean' &&
      typeof observation.passkeyControlPresent === 'boolean' &&
      typeof observation.matchingPasskeyAccountCount === 'number' &&
      Number.isInteger(observation.matchingPasskeyAccountCount) &&
      observation.matchingPasskeyAccountCount >= 0
    )
  })
}
