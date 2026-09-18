import {
  type WebsiteLoginFillResponse,
  WebsiteLoginOptionsMessage as WebsiteLoginOptionsMessageSchema,
} from '../../lib/login-fill-messages'
import { NookWebsiteLoginSaveDecision } from '../../lib/login-save-messages'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../../lib/concrete-decoder'
import type { AuthenticationOutcomeVerdict } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type LoginOperationFailure = {
  ok: false
  reason: string
  verdict?: AuthenticationOutcomeVerdict
}
export type LoginOperationSuccess = { ok: true }
export type LoginSaveActionResponse =
  LoginOperationFailure | { ok: true; decision?: NookWebsiteLoginSaveDecision }

export function decodeWebsiteLoginFillResponse(
  response: unknown,
): WebsiteLoginFillResponse {
  const decoded = runConcreteDecoder(
    WebsiteLoginOptionsMessageSchema.decodeWebsiteLoginFillResponse,
    response,
  )
  if (decoded.kind === ConcreteDecoderResultKind.Decoded) {
    return decoded.value
  }
  return { ok: false, reason: 'login-fill-session-invalid' }
}

export function isLoginPickerPageAcknowledgement(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false
  return 'ok' in response && response.ok === true
}

enum LoginOperationFailureDecodeKind {
  Invalid = 'invalid',
  Failure = 'failure',
}

type LoginOperationFailureDecode =
  | { kind: LoginOperationFailureDecodeKind.Invalid }
  | {
      kind: LoginOperationFailureDecodeKind.Failure
      failure: LoginOperationFailure
    }

function loginOperationFailure(response: unknown): LoginOperationFailureDecode {
  if (
    response &&
    typeof response === 'object' &&
    'ok' in response &&
    response.ok === false &&
    'reason' in response &&
    typeof response.reason === 'string'
  ) {
    return {
      kind: LoginOperationFailureDecodeKind.Failure,
      failure: { ok: false, reason: response.reason },
    }
  }
  return { kind: LoginOperationFailureDecodeKind.Invalid }
}

enum LoginSaveDecisionDecodeKind {
  Invalid = 'invalid',
  Decoded = 'decoded',
}

type LoginSaveDecisionDecode =
  | { kind: LoginSaveDecisionDecodeKind.Invalid }
  | {
      kind: LoginSaveDecisionDecodeKind.Decoded
      decision: NookWebsiteLoginSaveDecision
    }

function decodeLoginSaveDecision(decision: number): LoginSaveDecisionDecode {
  switch (decision) {
    case NookWebsiteLoginSaveDecision.Create:
      return {
        kind: LoginSaveDecisionDecodeKind.Decoded,
        decision: NookWebsiteLoginSaveDecision.Create,
      }
    case NookWebsiteLoginSaveDecision.Update:
      return {
        kind: LoginSaveDecisionDecodeKind.Decoded,
        decision: NookWebsiteLoginSaveDecision.Update,
      }
    case NookWebsiteLoginSaveDecision.AlreadySaved:
      return {
        kind: LoginSaveDecisionDecodeKind.Decoded,
        decision: NookWebsiteLoginSaveDecision.AlreadySaved,
      }
    case NookWebsiteLoginSaveDecision.Invalid:
      return {
        kind: LoginSaveDecisionDecodeKind.Decoded,
        decision: NookWebsiteLoginSaveDecision.Invalid,
      }
    default:
      return { kind: LoginSaveDecisionDecodeKind.Invalid }
  }
}

export function decodeLoginSaveActionResponse(
  response: unknown,
): LoginSaveActionResponse {
  const failureDecode = loginOperationFailure(response)
  if (failureDecode.kind === LoginOperationFailureDecodeKind.Failure) {
    return failureDecode.failure
  }
  if (
    response &&
    typeof response === 'object' &&
    'ok' in response &&
    response.ok === true
  ) {
    if (!('decision' in response)) return { ok: true }
    if (typeof response.decision === 'number') {
      const decision = decodeLoginSaveDecision(response.decision)
      if (decision.kind === LoginSaveDecisionDecodeKind.Decoded) {
        return { ok: true, decision: decision.decision }
      }
    }
  }
  return { ok: false, reason: 'login-save-session-invalid' }
}

export function decodeLoginOperationResponse(
  response: unknown,
): LoginOperationSuccess | LoginOperationFailure {
  const failureDecode = loginOperationFailure(response)
  if (failureDecode.kind === LoginOperationFailureDecodeKind.Failure) {
    return failureDecode.failure
  }
  if (
    response &&
    typeof response === 'object' &&
    'ok' in response &&
    response.ok === true
  ) {
    return { ok: true }
  }
  return { ok: false, reason: 'login-save-session-invalid' }
}
