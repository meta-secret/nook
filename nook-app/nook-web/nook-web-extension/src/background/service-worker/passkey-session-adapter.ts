import { err, ok, type Result } from 'neverthrow'
import type {
  WebsitePasskeyAssertionResponse,
  WebsitePasskeyRegistrationResponse,
} from '../../lib/webauthn-messages'
export {
  decode_website_passkey_account_list,
  WebsitePasskeyAccountListKind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export enum PasskeySessionResponseFailure {
  InvalidResponse = 'passkey-session-invalid-response',
  Rejected = 'passkey-session-rejected',
  InvalidMaterial = 'passkey-session-invalid-material',
  IncompleteMaterial = 'passkey-session-incomplete-material',
}

type PasskeySessionResponse =
  WebsitePasskeyRegistrationResponse | WebsitePasskeyAssertionResponse

export class SessionPasskeyResponse {
  constructor(private readonly response: unknown) {}

  decode(): Result<PasskeySessionResponse, PasskeySessionResponseFailure> {
    const response = this.response
    if (!response || typeof response !== 'object' || !('ok' in response)) {
      return err(PasskeySessionResponseFailure.InvalidResponse)
    }
    if (response.ok !== true) {
      return err(PasskeySessionResponseFailure.Rejected)
    }
    if (
      !('credentialId' in response) ||
      typeof response.credentialId !== 'string' ||
      !('clientDataJSON' in response) ||
      typeof response.clientDataJSON !== 'string'
    ) {
      return err(PasskeySessionResponseFailure.InvalidMaterial)
    }
    if (
      'attestationObject' in response &&
      typeof response.attestationObject === 'string' &&
      'transports' in response &&
      Array.isArray(response.transports) &&
      response.transports.every((transport) => typeof transport === 'string')
    ) {
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return ok({
        ok: true,
        credentialId: response.credentialId,
        clientDataJSON: response.clientDataJSON,
        attestationObject: response.attestationObject,
        transports: response.transports,
      })
    }
    if (
      'authenticatorData' in response &&
      typeof response.authenticatorData === 'string' &&
      'signature' in response &&
      typeof response.signature === 'string' &&
      'userHandle' in response &&
      typeof response.userHandle === 'string'
    ) {
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return ok({
        ok: true,
        credentialId: response.credentialId,
        clientDataJSON: response.clientDataJSON,
        authenticatorData: response.authenticatorData,
        signature: response.signature,
        userHandle: response.userHandle,
      })
    }
    return err(PasskeySessionResponseFailure.IncompleteMaterial)
  }
}
