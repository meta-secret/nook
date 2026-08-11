import type {
  AuthenticationOutcomeDecision,
  AuthenticationOutcomeResponse,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type { AuthenticationOutcomeResponse }

export type AuthenticationOutcomeObservationView = {
  navigatedAwayFromAuthPath: boolean
  authFieldsPresent: boolean
  successMarkerPresent: boolean
  errorMarkerPresent: boolean
  sameDocumentMutation: boolean
  inIframe: boolean
  elapsedMs: number
}

export type AuthenticationOutcomeVerdictView = AuthenticationOutcomeDecision

export enum AuthenticationOutcomeClassifyMessageType {
  NookAuthenticationOutcomeClassify = 'nook:authentication-outcome-classify',
}

export type AuthenticationOutcomeClassifyMessage = {
  type: AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify
  payload: {
    observation: AuthenticationOutcomeObservationView
    timeoutMs: number
  }
}

export function isAuthenticationOutcomeClassifyMessage(
  message: object,
): message is AuthenticationOutcomeClassifyMessage {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !==
      AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object' ||
    Array.isArray(message.payload)
  ) {
    return false
  }
  const payload =
    message.payload as AuthenticationOutcomeClassifyMessage['payload']

  const observation = payload.observation
  if (!observation || typeof observation !== 'object') return false
  const view = observation as AuthenticationOutcomeObservationView
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
    'timeoutMs' in payload &&
    typeof payload.timeoutMs === 'number' &&
    Number.isFinite(payload.timeoutMs) &&
    payload.timeoutMs > 0
  )
}
