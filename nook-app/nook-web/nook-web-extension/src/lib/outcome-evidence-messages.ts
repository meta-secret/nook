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

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticationOutcomeClassifyMessage {
  private constructor() {}
  declare readonly type: AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify
  declare readonly payload: {
    observation: AuthenticationOutcomeObservationView
    timeoutMs: number
  }
  static is(message: unknown): message is AuthenticationOutcomeClassifyMessage {
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
    const { payload } = message

    if (!('observation' in payload)) return false
    const observation = payload.observation
    if (!observation || typeof observation !== 'object') return false
    return (
      'navigatedAwayFromAuthPath' in observation &&
      typeof observation.navigatedAwayFromAuthPath === 'boolean' &&
      'authFieldsPresent' in observation &&
      typeof observation.authFieldsPresent === 'boolean' &&
      'successMarkerPresent' in observation &&
      typeof observation.successMarkerPresent === 'boolean' &&
      'errorMarkerPresent' in observation &&
      typeof observation.errorMarkerPresent === 'boolean' &&
      'sameDocumentMutation' in observation &&
      typeof observation.sameDocumentMutation === 'boolean' &&
      'inIframe' in observation &&
      typeof observation.inIframe === 'boolean' &&
      'elapsedMs' in observation &&
      typeof observation.elapsedMs === 'number' &&
      Number.isFinite(observation.elapsedMs) &&
      observation.elapsedMs >= 0 &&
      'timeoutMs' in payload &&
      typeof payload.timeoutMs === 'number' &&
      Number.isFinite(payload.timeoutMs) &&
      payload.timeoutMs > 0
    )
  }
}
