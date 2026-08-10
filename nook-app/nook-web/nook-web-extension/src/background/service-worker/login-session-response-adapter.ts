import {
  type WebsiteLoginFillResponse,
  isWebsiteLoginFillResponse,
} from '../../lib/login-fill-messages'
import { NookWebsiteLoginSaveDecision } from '../../lib/login-save-messages'
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
  if (
    response &&
    typeof response === 'object' &&
    isWebsiteLoginFillResponse(response)
  ) {
    return response
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

function isLoginSaveDecision(
  decision: number,
): decision is NookWebsiteLoginSaveDecision {
  switch (decision) {
    case NookWebsiteLoginSaveDecision.Create:
    case NookWebsiteLoginSaveDecision.Update:
    case NookWebsiteLoginSaveDecision.AlreadySaved:
    case NookWebsiteLoginSaveDecision.Invalid:
      return true
    default:
      return false
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
    response.ok === true &&
    (!('decision' in response) ||
      (typeof response.decision === 'number' &&
        isLoginSaveDecision(response.decision)))
  ) {
    if ('decision' in response) {
      const decision = response.decision
      if (typeof decision === 'number' && isLoginSaveDecision(decision)) {
        return { ok: true, decision }
      }
      return { ok: false, reason: 'login-save-session-invalid' }
    }
    return { ok: true }
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
