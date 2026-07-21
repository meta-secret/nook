export type AuthenticationOutcomeObservationView = {
  navigatedAwayFromAuthPath: boolean
  authFieldsPresent: boolean
  successMarkerPresent: boolean
  errorMarkerPresent: boolean
  sameDocumentMutation: boolean
  inIframe: boolean
  elapsedMs: number
}

export type AuthenticationOutcomeVerdictName =
  | 'sufficient'
  | 'insufficient'
  | 'conflicting'
  | 'timeout'

export type AuthenticationOutcomeVerdictView = {
  name: AuthenticationOutcomeVerdictName
  allowsCredentialCommit: boolean
}

export type AuthenticationOutcomeClassifyMessage = {
  type: 'nook:authentication-outcome-classify'
  payload: {
    observation: AuthenticationOutcomeObservationView
    timeoutMs?: number
  }
}

export function isAuthenticationOutcomeClassifyMessage(
  message: unknown,
): message is AuthenticationOutcomeClassifyMessage {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('type' in message) ||
    message.type !== 'nook:authentication-outcome-classify' ||
    !('payload' in message) ||
    typeof message.payload !== 'object' ||
    message.payload === null
  ) {
    return false
  }
  const payload = message.payload as Record<string, unknown>
  const observation = payload.observation
  if (typeof observation !== 'object' || observation === null) return false
  const view = observation as Record<string, unknown>
  return (
    typeof view.navigatedAwayFromAuthPath === 'boolean' &&
    typeof view.authFieldsPresent === 'boolean' &&
    typeof view.successMarkerPresent === 'boolean' &&
    typeof view.errorMarkerPresent === 'boolean' &&
    typeof view.sameDocumentMutation === 'boolean' &&
    typeof view.inIframe === 'boolean' &&
    typeof view.elapsedMs === 'number' &&
    Number.isFinite(view.elapsedMs) &&
    view.elapsedMs >= 0 &&
    (payload.timeoutMs === undefined ||
      (typeof payload.timeoutMs === 'number' &&
        Number.isFinite(payload.timeoutMs) &&
        payload.timeoutMs > 0))
  )
}

export function isAuthenticationOutcomeVerdictName(
  value: unknown,
): value is AuthenticationOutcomeVerdictName {
  return (
    value === 'sufficient' ||
    value === 'insufficient' ||
    value === 'conflicting' ||
    value === 'timeout'
  )
}
