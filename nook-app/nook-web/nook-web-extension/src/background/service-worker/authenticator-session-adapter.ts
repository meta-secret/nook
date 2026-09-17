import { err, ok, type Result } from 'neverthrow'
import type {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportResult,
} from './session-document'
import type { WebsiteAuthenticatorBackupAttachMessageMode } from '../../lib/enrollment-messages'
import type { ExtensionSessionResponse } from '../../offscreen/session'
import {
  extensionSessionGrantIdentity,
  type StoredExtensionPairingGrant,
} from '../pairing-grants'
import {
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  type ExtensionSessionTransportRequest,
} from '../../offscreen/session-request-adapter'
import { extensionPairingIdentity } from './pairing-identity'

import {
  decode_authenticator_code_session_response,
  decode_authenticator_preview_session_response,
  decode_authenticator_secret_session_response,
  decode_authenticator_backup_verification_session_response,
  type AuthenticatorCodeSessionResponse,
  type AuthenticatorPreviewSessionResponse,
  type AuthenticatorSecretSessionResponse,
  type VerifiedAuthenticatorBackupAttachResponse,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
export type {
  AuthenticatorCodeSessionResponse,
  AuthenticatorPreviewSessionResponse,
  AuthenticatorSecretSessionResponse,
  VerifiedAuthenticatorBackupAttachResponse,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export enum AuthenticatorSessionFailureKind {
  InitializationFailed = 'authenticator-session-initialization-failed',
  InvalidResponse = 'authenticator-session-invalid-response',
  ExpiredCode = 'authenticator-session-expired-code',
  PageDeliveryFailed = 'authenticator-page-delivery-failed',
  PageRejected = 'authenticator-page-rejected',
}

export class AuthenticatorSessionFailure {
  constructor(readonly kind: AuthenticatorSessionFailureKind) {}
  get response() {
    return { ok: false as const, reason: this.kind }
  }
}

type AuthenticatorSessionError =
  ExtensionSessionTransportFailure | AuthenticatorSessionFailure

type AuthenticatorSessionTransport = {
  sendSessionMessage(
    message: ExtensionSessionTransportRequest,
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  sendSessionMessage<Response, DecodeFailure>(
    message: ExtensionSessionTransportRequest,
    decodeResponse: (
      response: ExtensionSessionResponse,
    ) => Result<Response, DecodeFailure>,
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
}

function authenticatorResponseDecoder<Response>(
  decode: (response: unknown) => Response,
): (response: unknown) => Result<Response, AuthenticatorSessionFailure> {
  return (response) => {
    try {
      return ok(decode(response))
    } catch {
      return err(
        new AuthenticatorSessionFailure(
          AuthenticatorSessionFailureKind.InvalidResponse,
        ),
      )
    }
  }
}

type AuthenticatorCodeFromSessionArgs = {
  grant: StoredExtensionPairingGrant
  secretId: string
}

type ConfirmAuthenticatorEnrollmentArgs = {
  grant: StoredExtensionPairingGrant
  otpauthUri: string
  origin: string
}

type AuthenticatorBackupCodesSessionAttachmentRequest = {
  grant: StoredExtensionPairingGrant
  secretId: string
  codes: string[]
  mode: WebsiteAuthenticatorBackupAttachMessageMode
}

type SelectedAuthenticatorPageAcknowledgedArgs = {
  tabId: number
  frameId: number
  origin: string
  requestId: string
  vaultStoreId: string
  secretId: string
  authorizationGeneration: string
}

export enum AuthenticatorPageAcknowledgementKind {
  Acknowledged = 'acknowledged',
}

export type AuthenticatorPageAcknowledgement = {
  readonly kind: AuthenticatorPageAcknowledgementKind.Acknowledged
  readonly requestId: string
}

export class ExtensionAuthenticatorSession {
  private readonly readiness = companionWasmReady
  constructor(private readonly pairing: AuthenticatorSessionTransport) {}

  async authenticatorCodeFromSession({
    grant,
    secretId,
  }: AuthenticatorCodeFromSessionArgs): Promise<
    Result<AuthenticatorCodeSessionResponse, AuthenticatorSessionError>
  > {
    try {
      await this.readiness
    } catch {
      return err(
        new AuthenticatorSessionFailure(
          AuthenticatorSessionFailureKind.InitializationFailed,
        ),
      )
    }
    const message: Parameters<typeof this.pairing.sendSessionMessage>[0] = {
      type: 'nook:extension-session-authenticator-code',
      payload: {
        ...extensionSessionGrantIdentity(grant),
        secretId,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const delivery = await this.pairing.sendSessionMessage(
      message,
      authenticatorResponseDecoder(decode_authenticator_code_session_response),
    )
    if (delivery.isErr()) return err(delivery.error)
    const response = delivery.value
    if (response.expiresAt <= Date.now()) {
      return err(
        new AuthenticatorSessionFailure(
          AuthenticatorSessionFailureKind.ExpiredCode,
        ),
      )
    }
    return ok(response)
  }

  async authenticatorPreviewFromSession(
    otpauthUri: string,
  ): Promise<
    Result<AuthenticatorPreviewSessionResponse, AuthenticatorSessionError>
  > {
    try {
      await this.readiness
    } catch {
      return err(
        new AuthenticatorSessionFailure(
          AuthenticatorSessionFailureKind.InitializationFailed,
        ),
      )
    }
    const message: Parameters<typeof this.pairing.sendSessionMessage>[0] = {
      type: 'nook:extension-session-authenticator-enroll-preview',
      payload: { otpauthUri, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const delivery = await this.pairing.sendSessionMessage(
      message,
      authenticatorResponseDecoder(
        decode_authenticator_preview_session_response,
      ),
    )
    if (delivery.isErr()) return err(delivery.error)
    return ok(delivery.value)
  }

  async stagedAuthenticatorCodeFromSession(
    otpauthUri: string,
  ): Promise<
    Result<AuthenticatorCodeSessionResponse, AuthenticatorSessionError>
  > {
    try {
      await this.readiness
    } catch {
      return err(
        new AuthenticatorSessionFailure(
          AuthenticatorSessionFailureKind.InitializationFailed,
        ),
      )
    }
    const message: Parameters<typeof this.pairing.sendSessionMessage>[0] = {
      type: 'nook:extension-session-authenticator-enroll-code',
      payload: { otpauthUri, queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    }
    const delivery = await this.pairing.sendSessionMessage(
      message,
      authenticatorResponseDecoder(decode_authenticator_code_session_response),
    )
    if (delivery.isErr()) return err(delivery.error)
    const response = delivery.value
    if (response.expiresAt <= Date.now()) {
      return err(
        new AuthenticatorSessionFailure(
          AuthenticatorSessionFailureKind.ExpiredCode,
        ),
      )
    }
    return ok(response)
  }

  async confirmAuthenticatorEnrollment({
    grant,
    otpauthUri,
    origin,
  }: ConfirmAuthenticatorEnrollmentArgs): Promise<
    Result<AuthenticatorSecretSessionResponse, AuthenticatorSessionError>
  > {
    try {
      await this.readiness
    } catch {
      return err(
        new AuthenticatorSessionFailure(
          AuthenticatorSessionFailureKind.InitializationFailed,
        ),
      )
    }
    const message: Parameters<typeof this.pairing.sendSessionMessage>[0] = {
      type: 'nook:extension-session-authenticator-enroll-confirm',
      payload: {
        ...extensionSessionGrantIdentity(grant),
        otpauthUri,
        origin,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const delivery = await this.pairing.sendSessionMessage(
      message,
      authenticatorResponseDecoder(
        decode_authenticator_secret_session_response,
      ),
    )
    if (delivery.isErr()) return err(delivery.error)
    return ok(delivery.value)
  }

  async attachAuthenticatorBackupCodesFromSession({
    grant,
    secretId,
    codes,
    mode,
  }: AuthenticatorBackupCodesSessionAttachmentRequest): Promise<
    Result<VerifiedAuthenticatorBackupAttachResponse, AuthenticatorSessionError>
  > {
    const transportCodes = [...codes]
    try {
      try {
        await this.readiness
      } catch {
        return err(
          new AuthenticatorSessionFailure(
            AuthenticatorSessionFailureKind.InitializationFailed,
          ),
        )
      }
      const message: Parameters<typeof this.pairing.sendSessionMessage>[0] = {
        type: 'nook:extension-session-authenticator-backup-attach',
        payload: {
          ...extensionSessionGrantIdentity(grant),
          secretId,
          codes: transportCodes,
          mode,
          queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
        },
      }
      const delivery = await this.pairing.sendSessionMessage(
        message,
        authenticatorResponseDecoder(
          decode_authenticator_backup_verification_session_response,
        ),
      )
      if (delivery.isErr()) return err(delivery.error)
      return ok(delivery.value)
    } finally {
      transportCodes.fill('')
    }
  }

  async selectedAuthenticatorPageAcknowledged({
    tabId,
    frameId,
    origin,
    requestId,
    vaultStoreId,
    secretId,
    authorizationGeneration,
  }: SelectedAuthenticatorPageAcknowledgedArgs): Promise<
    Result<AuthenticatorPageAcknowledgement, AuthenticatorSessionFailure>
  > {
    const message: Parameters<typeof chrome.tabs.sendMessage>[1] = {
      type: 'nook:website-authenticator-selected',
      payload: {
        origin,
        requestId,
        account: { vaultStoreId, secretId, authorizationGeneration },
      },
    }
    const options: chrome.tabs.MessageSendOptions = { frameId }
    let response: unknown
    try {
      response = await chrome.tabs.sendMessage(tabId, message, options)
    } catch {
      return err(
        new AuthenticatorSessionFailure(
          AuthenticatorSessionFailureKind.PageDeliveryFailed,
        ),
      )
    }
    return response &&
      typeof response === 'object' &&
      'ok' in response &&
      response.ok === true
      ? ok({
          kind: AuthenticatorPageAcknowledgementKind.Acknowledged,
          requestId,
        })
      : err(
          new AuthenticatorSessionFailure(
            AuthenticatorSessionFailureKind.PageRejected,
          ),
        )
  }
}

export const extensionAuthenticatorSession = new ExtensionAuthenticatorSession(
  extensionPairingIdentity,
)
