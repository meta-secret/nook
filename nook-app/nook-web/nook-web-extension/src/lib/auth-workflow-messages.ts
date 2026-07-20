import type { PasswordFormSummary } from '../../../nook-web-shared/src/extension/password-forms'

const MAX_OBSERVED_FIELD_COUNT = 100

export type AuthenticationWorkflowSnapshotView = {
  kind: string
  stage: string
  action: string
  currentStep: number
  totalSteps: number
  requiresHumanApproval: boolean
}

export type AuthenticationWorkflowSnapshotMessage = {
  type: 'nook:authentication-workflow-snapshot'
  payload: {
    origin: string
    observation: Pick<
      PasswordFormSummary,
      | 'usernameFieldCount'
      | 'currentPasswordFieldCount'
      | 'newPasswordFieldCount'
      | 'genericPasswordFieldCount'
      | 'oneTimeCodeFieldCount'
    >
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
    !('observation' in message.payload) ||
    !message.payload.observation ||
    typeof message.payload.observation !== 'object'
  ) {
    return false
  }
  const observation = message.payload.observation as Record<string, unknown>
  return [
    observation.usernameFieldCount,
    observation.currentPasswordFieldCount,
    observation.newPasswordFieldCount,
    observation.genericPasswordFieldCount,
    observation.oneTimeCodeFieldCount,
  ].every(isBoundedCount)
}
