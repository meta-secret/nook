import {
  decode_website_passkey_registration_request,
  decode_website_passkey_assertion_request,
  type PasskeyRegistrationRequest,
  type PasskeyAssertionRequest,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { extensionWasmRuntime } from './nook-wasm'
import {
  WebsitePasskeyCancelMessageType,
  WebsitePasskeyCeremony,
  WebsitePasskeyOptionsMessageType,
  WebsitePasskeyOptionsStatus,
  WebsitePasskeyPerformMessageType,
} from './webauthn-message-types'

export {
  WebsitePasskeyCancelMessageType,
  WebsitePasskeyCeremony,
  WebsitePasskeyOptionsMessageType,
  WebsitePasskeyOptionsStatus,
  WebsitePasskeyPerformMessageType,
} from './webauthn-message-types'

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsitePasskeyOptionsMessage {
  private constructor() {}
  declare readonly type: WebsitePasskeyOptionsMessageType.NookWebsitePasskeyOptions
  declare readonly payload: {
    requestId: string
    ceremony: WebsitePasskeyCeremony
    requestJson: string
    expiresAt: number
  }
  static validBase(message: unknown): message is {
    payload: WebsitePasskeyOptionsMessage['payload']
  } {
    if (!message || typeof message !== 'object' || !('payload' in message)) {
      return false
    }
    const payload = message.payload
    return (
      !!payload &&
      typeof payload === 'object' &&
      'requestId' in payload &&
      typeof payload.requestId === 'string' &&
      payload.requestId.length >= 16 &&
      payload.requestId.length <= 128 &&
      'ceremony' in payload &&
      (payload.ceremony === WebsitePasskeyCeremony.Create ||
        payload.ceremony === WebsitePasskeyCeremony.Get) &&
      'requestJson' in payload &&
      typeof payload.requestJson === 'string' &&
      payload.requestJson.length > 0 &&
      payload.requestJson.length <= 65_536 &&
      'expiresAt' in payload &&
      typeof payload.expiresAt === 'number' &&
      Number.isFinite(payload.expiresAt) &&
      payload.expiresAt > Date.now()
    )
  }

  static is(message: unknown): message is WebsitePasskeyOptionsMessage {
    return (
      WebsitePasskeyOptionsMessage.validBase(message) &&
      'type' in message &&
      message.type ===
        WebsitePasskeyOptionsMessageType.NookWebsitePasskeyOptions
    )
  }

  static async parsedWebsitePasskeyRequest(
    args: ParseWebsitePasskeyRequestArgs,
  ): Promise<WebsitePasskeyRequestParse> {
    await extensionWasmRuntime.ensureNookWasm()
    try {
      if (args.ceremony === WebsitePasskeyCeremony.Get) {
        const value = decode_website_passkey_assertion_request(args.requestJson)
        return {
          kind: WebsitePasskeyRequestParseKind.Parsed,
          request: {
            ceremony: WebsitePasskeyCeremony.Get,
            value,
          },
        }
      }
      const value = decode_website_passkey_registration_request(
        args.requestJson,
      )
      return {
        kind: WebsitePasskeyRequestParseKind.Parsed,
        request: {
          ceremony: WebsitePasskeyCeremony.Create,
          value,
        },
      }
    } catch {
      return { kind: WebsitePasskeyRequestParseKind.Rejected }
    }
  }

  static websitePasskeyRequestJson(
    args: WebsitePasskeyRequestJsonArgs,
  ): string {
    if (
      args.request.ceremony !== WebsitePasskeyCeremony.Get ||
      args.credentialSelection.kind ===
        WebsitePasskeyCredentialSelectionKind.RequestDefaults
    ) {
      return JSON.stringify(args.request.value)
    }
    if (args.credentialSelection.credentialId.length === 0) {
      throw new Error('Selected passkey credential ID must not be empty.')
    }
    const request: PasskeyAssertionRequest = {
      ...args.request.value,
      allowCredentials: [{ id: args.credentialSelection.credentialId }],
    }
    return JSON.stringify(request)
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsitePasskeyPerformMessage {
  private constructor() {}
  declare readonly type: WebsitePasskeyPerformMessageType.NookWebsitePasskeyPerform
  declare readonly payload: WebsitePasskeyOptionsMessage['payload'] & {
    vaultStoreId: string
    credentialId?: string
  }
  static is(message: unknown): message is WebsitePasskeyPerformMessage {
    return (
      WebsitePasskeyOptionsMessage.validBase(message) &&
      'type' in message &&
      message.type ===
        WebsitePasskeyPerformMessageType.NookWebsitePasskeyPerform &&
      'vaultStoreId' in message.payload &&
      typeof message.payload.vaultStoreId === 'string' &&
      message.payload.vaultStoreId.length > 0 &&
      (!('credentialId' in message.payload) ||
        (typeof message.payload.credentialId === 'string' &&
          message.payload.credentialId.length > 0))
    )
  }
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsitePasskeyCancelMessage {
  private constructor() {}
  declare readonly type: WebsitePasskeyCancelMessageType.NookWebsitePasskeyCancel
  declare readonly payload: {
    requestId: string
  }
  static is(message: unknown): message is WebsitePasskeyCancelMessage {
    return Boolean(
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type ===
        WebsitePasskeyCancelMessageType.NookWebsitePasskeyCancel &&
      'payload' in message &&
      message.payload &&
      typeof message.payload === 'object' &&
      'requestId' in message.payload &&
      typeof message.payload.requestId === 'string' &&
      message.payload.requestId.length >= 16 &&
      message.payload.requestId.length <= 128,
    )
  }
}

export type WebsitePasskeyAccount = {
  credentialId: string
  userName: string
  userDisplayName: string
}

export type WebsitePasskeyVaultOption = {
  vaultStoreId: string
  vaultName: string
  account?: WebsitePasskeyAccount
}

export type WebsitePasskeyOptionsResponse =
  | { ok: false; reason: string }
  | {
      ok: true
      status: WebsitePasskeyOptionsStatus
      options: WebsitePasskeyVaultOption[]
    }

export type WebsitePasskeyRegistrationResponse = {
  ok: true
  credentialId: string
  clientDataJSON: string
  attestationObject: string
  transports: string[]
}

export type WebsitePasskeyAssertionResponse = {
  ok: true
  credentialId: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  userHandle: string
}

export type WebsitePasskeyPerformResponse =
  | { ok: false; reason: string }
  | WebsitePasskeyRegistrationResponse
  | WebsitePasskeyAssertionResponse

export enum WebsitePasskeyRequestParseKind {
  Parsed = 'parsed',
  Rejected = 'rejected',
}

export type WebsitePasskeyRequestParse =
  | {
      kind: WebsitePasskeyRequestParseKind.Parsed
      request: WebsitePasskeyRequest
    }
  | { kind: WebsitePasskeyRequestParseKind.Rejected }

export type WebsitePasskeyRequest =
  | {
      ceremony: WebsitePasskeyCeremony.Create
      value: PasskeyRegistrationRequest
    }
  | {
      ceremony: WebsitePasskeyCeremony.Get
      value: PasskeyAssertionRequest
    }

export type ParseWebsitePasskeyRequestArgs = {
  ceremony: WebsitePasskeyCeremony
  requestJson: string
}

export type WebsitePasskeyRequestJsonArgs = {
  request: WebsitePasskeyRequest
  credentialSelection: WebsitePasskeyCredentialSelection
}

export enum WebsitePasskeyCredentialSelectionKind {
  RequestDefaults = 'request-defaults',
  Selected = 'selected',
}

export type WebsitePasskeyCredentialSelection =
  | { kind: WebsitePasskeyCredentialSelectionKind.RequestDefaults }
  | {
      kind: WebsitePasskeyCredentialSelectionKind.Selected
      credentialId: string
    }
