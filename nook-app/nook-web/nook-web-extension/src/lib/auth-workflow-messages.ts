import type { PasswordFormSummary } from '../../../nook-web-shared/src/extension/password-forms'

const MAX_OBSERVED_FIELD_COUNT = 100
const MAX_WORKFLOW_OBSERVATIONS = 20

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

export type AuthenticationWorkflowSnapshotView = {
  kind: string
  stage: string
  action: string
  currentStep: number
  totalSteps: number
  requiresHumanApproval: boolean
  observationIndex: number
}

export type AuthenticationWorkflowSnapshotMessage = {
  type: 'nook:authentication-workflow-snapshot'
  payload: {
    origin: string
    observations: AuthenticationPageObservationView[]
  }
}

function isBoundedCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_OBSERVED_FIELD_COUNT
  )
}

export function isAuthenticationWorkflowSnapshotMessage(
  message: unknown,
): message is AuthenticationWorkflowSnapshotMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== 'nook:authentication-workflow-snapshot' ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object' ||
    !('origin' in message.payload) ||
    typeof message.payload.origin !== 'string' ||
    !('observations' in message.payload) ||
    !Array.isArray(message.payload.observations) ||
    message.payload.observations.length === 0 ||
    message.payload.observations.length > MAX_WORKFLOW_OBSERVATIONS
  ) {
    return false
  }
  return message.payload.observations.every((value) => {
    if (!value || typeof value !== 'object') return false
    const observation = value as Record<string, unknown>
    return (
      [
        observation.usernameFieldCount,
        observation.currentPasswordFieldCount,
        observation.newPasswordFieldCount,
        observation.genericPasswordFieldCount,
        observation.oneTimeCodeFieldCount,
      ].every(isBoundedCount) &&
      typeof observation.manualCheckpointPresent === 'boolean' &&
      typeof observation.authenticatorSetupHint === 'boolean' &&
      typeof observation.backupCodesHint === 'boolean' &&
      typeof observation.passkeyControlPresent === 'boolean' &&
      isBoundedCount(observation.matchingPasskeyAccountCount)
    )
  })
}
