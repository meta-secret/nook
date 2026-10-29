import { err, type Result } from 'neverthrow'
import { Effect } from 'effect'
import type {
  DecodedExtensionSessionTransportDelivery,
  ExtensionSessionTransportDelivery,
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportResult,
} from './session-document'
import type { ExtensionSessionResponse } from '../../offscreen/session'
import type { BeginExtensionPairingMessage } from '../../../../nook-web-shared/src/extension/runtime-messages'
import { companionWasmReady } from '../../../../nook-web-shared/src/extension/companion-ready'
import { ExtensionConnectScope } from '../../../../nook-web-shared/src/extension/extension-connect-scope'
import {
  decode_extension_session_status_response,
  ExtensionSessionStatusAvailability,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { simpleVaultRuntime } from '../../lib/simple-vault-runtime'
import { ExtensionConnectTabs } from './extension-connect-tab'
import { WebsiteAuthenticatorResponseStatus } from '../../lib/login-fill-messages'
import {
  extensionSessionInteractiveDeadline,
  extensionSessionProbeDeadline,
  type ExtensionSessionTransportRequest,
} from '../../offscreen/session-request-adapter'
import {
  WebsitePasskeyRequestParseKind,
  WebsitePasskeyCeremony,
  type WebsitePasskeyRequest,
  WebsitePasskeyOptionsMessage as WebsitePasskeyOptionsMessageSchema,
} from '../../lib/webauthn-messages'
import type {
  ExtensionPairingItems,
  StoredExtensionPairingGrant,
} from '../pairing-grants'
import { extensionPairingGrantPolicyReady } from '../pairing-grants'
import {
  SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS,
  extensionSessionLifecycle,
} from './session-lifecycle'
import {
  ExtensionPairingStorage,
  type ExtensionSessionStorageItems,
  type ExtensionSessionStorageWrite,
} from './pairing-identity-storage'

export {
  type ExtensionSessionStorageItems,
  type ExtensionSessionStorageValue,
  type ExtensionSessionStorageWrite,
} from './pairing-identity-storage'

export type SessionMessageRequest = [message: ExtensionSessionTransportRequest]

export type DecodedSessionMessageRequest<Response, DecodeFailure> = [
  message: ExtensionSessionTransportRequest,
  decodeResponse: (
    response: ExtensionSessionResponse,
  ) => Result<Response, DecodeFailure>,
]

export { ExtensionSessionStatusAvailability }

export enum HasPairingApprovedTypeResultType {
  NookExtensionPairingApproved = 'nook:extension-pairing-approved',
}

export enum WebsitePasskeyRequestContextKind {
  Rejected = 'rejected',
  Validated = 'validated',
}

export type WebsitePasskeyRequestContext =
  | { kind: WebsitePasskeyRequestContextKind.Rejected }
  | {
      kind: WebsitePasskeyRequestContextKind.Validated
      origin: string
      rpId: string
      request: WebsitePasskeyRequest
    }

type RequestOriginAndRpIdArgs = {
  ceremony: WebsitePasskeyCeremony
  requestJson: string
}

type IsAuthorizedWebsiteSenderArgs = {
  sender: chrome.runtime.MessageSender
  origin: string
}

type AvailableWebsiteGrantsArgs = {
  origin: string
  sender: chrome.runtime.MessageSender
  forbiddenReason: string
}

type WebsiteGrantAccess =
  | { grants: StoredExtensionPairingGrant[] }
  | {
      response:
        | { ok: false; reason: string }
        | {
            ok: true
            status:
              | WebsiteAuthenticatorResponseStatus.Unavailable
              | WebsiteAuthenticatorResponseStatus.Locked
          }
    }

type WebsiteGrantsArgs = AvailableWebsiteGrantsArgs & {
  interactive: boolean
}

/** Owns the browser runtime resources shared by these interactions. */
class ExtensionPairingIdentity {
  private readonly pairingStorage = new ExtensionPairingStorage()
  private readonly connectTabs = new ExtensionConnectTabs(simpleVaultRuntime)
  randomNonce(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    )
  }

  setSessionStorage(items: ExtensionSessionStorageWrite): Promise<void> {
    return this.pairingStorage.setSessionStorage(items)
  }

  getSessionStorage(key: string): Promise<ExtensionSessionStorageItems> {
    return this.pairingStorage.getSessionStorage(key)
  }

  getAllSessionStorage(): Promise<ExtensionSessionStorageItems> {
    return this.pairingStorage.getAllSessionStorage()
  }

  removeSessionStorage(key: string): Promise<void> {
    return this.pairingStorage.removeSessionStorage(key)
  }

  /** Opens Nook's connect route in the one Nook tab of the requesting
   * window and returns that tab's id; a failure rejects. */
  async openExtensionPairing(
    device: BeginExtensionPairingMessage['payload'],
  ): Promise<number> {
    await companionWasmReady
    const url = new URL(
      await simpleVaultRuntime.runtimeSimpleVaultUrl('extension-connect'),
    )
    url.searchParams.set('device_id', device.deviceId)
    url.searchParams.set('device_public_key', device.devicePublicKey)
    url.searchParams.set(
      'device_signing_public_key',
      device.deviceSigningPublicKey,
    )
    url.searchParams.set('extension_id', chrome.runtime.id)
    url.searchParams.set('device_label', device.deviceLabel)
    // It only names the page's progress port for the side panel that
    // started this connect.
    url.searchParams.set('connect_id', device.connectId)
    url.searchParams.set(
      'scopes',
      [
        ExtensionConnectScope.VaultAccess,
        ExtensionConnectScope.PasswordFilling,
        ExtensionConnectScope.PasskeyManagement,
        ExtensionConnectScope.SyncProviderCredentials,
      ].join(','),
    )
    const connectTab: Parameters<typeof this.connectTabs.open>[0] = {
      windowId: device.windowId,
      url: url.toString(),
    }
    return Effect.runPromise(this.connectTabs.open(connectTab))
  }

  sendSessionMessage(
    ...request: SessionMessageRequest
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  sendSessionMessage<Response, DecodeFailure>(
    ...request: DecodedSessionMessageRequest<Response, DecodeFailure>
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
  async sendSessionMessage<
    Response = ExtensionSessionResponse,
    DecodeFailure = never,
  >(
    ...request:
      | SessionMessageRequest
      | DecodedSessionMessageRequest<Response, DecodeFailure>
  ): Promise<
    | ExtensionSessionTransportResult<ExtensionSessionResponse>
    | ExtensionSessionTransportResult<Response, DecodeFailure>
  > {
    const [message, decodeResponse] = request
    const document = await extensionSessionLifecycle.openSessionDocument()
    if (document.isErr()) {
      return err<ExtensionSessionResponse, ExtensionSessionTransportFailure>(
        document.error,
      )
    }
    if (decodeResponse) {
      const delivery: DecodedExtensionSessionTransportDelivery<
        Response,
        DecodeFailure
      > = { message, decodeResponse }
      return document.value.sendMessage(delivery)
    }
    const delivery: ExtensionSessionTransportDelivery = { message }
    return document.value.sendMessage(delivery)
  }

  websiteSessionStatusTransport(
    response: unknown,
  ): ExtensionSessionStatusAvailability {
    try {
      return decode_extension_session_status_response(response)
    } catch {
      return ExtensionSessionStatusAvailability.Unavailable
    }
  }

  async setPairingStorage(items: ExtensionPairingItems): Promise<void> {
    return this.pairingStorage.setPairingStorage(items)
  }

  async getPairingStorage(key?: string): Promise<ExtensionPairingItems> {
    return this.pairingStorage.getPairingStorage(key)
  }

  async requestOriginAndRpId({
    ceremony,
    requestJson,
  }: RequestOriginAndRpIdArgs): Promise<WebsitePasskeyRequestContext> {
    const parseArgs: Parameters<
      typeof WebsitePasskeyOptionsMessageSchema.parsedWebsitePasskeyRequest
    >[0] = {
      ceremony,
      requestJson,
    }
    const parsed =
      await WebsitePasskeyOptionsMessageSchema.parsedWebsitePasskeyRequest(
        parseArgs,
      )
    if (parsed.kind === WebsitePasskeyRequestParseKind.Rejected) {
      return { kind: WebsitePasskeyRequestContextKind.Rejected }
    }
    return {
      kind: WebsitePasskeyRequestContextKind.Validated,
      origin: parsed.request.value.origin,
      rpId:
        parsed.request.ceremony === WebsitePasskeyCeremony.Get
          ? parsed.request.value.rpId
          : parsed.request.value.relyingParty.id,
      request: parsed.request,
    }
  }

  isAuthorizedWebsiteSender({
    sender,
    origin,
  }: IsAuthorizedWebsiteSenderArgs): boolean {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.tab ||
      !('id' in sender.tab) ||
      !sender.url
    ) {
      return false
    }
    try {
      return new URL(sender.url).origin === origin
    } catch {
      return false
    }
  }

  async passkeyPairingGrants(): Promise<StoredExtensionPairingGrant[]> {
    const pairingPolicy = await extensionPairingGrantPolicyReady
    const stored = await this.getPairingStorage()
    return pairingPolicy
      .selectedPairingGrantFirst(stored)
      .filter((grant) =>
        grant.scopes.includes(ExtensionConnectScope.PasskeyManagement),
      )
  }

  async passwordPairingGrants(): Promise<StoredExtensionPairingGrant[]> {
    const pairingPolicy = await extensionPairingGrantPolicyReady
    const stored = await this.getPairingStorage()
    return pairingPolicy
      .selectedPairingGrantFirst(stored)
      .filter((grant) =>
        grant.scopes.includes(ExtensionConnectScope.PasswordFilling),
      )
  }

  async availableWebsiteGrants({
    origin,
    sender,
    forbiddenReason,
  }: AvailableWebsiteGrantsArgs): Promise<WebsiteGrantAccess> {
    const request: WebsiteGrantsArgs = {
      origin,
      sender,
      forbiddenReason,
      interactive: true,
    }
    return this.websiteGrants(request)
  }

  async passiveAvailableWebsiteGrants({
    origin,
    sender,
    forbiddenReason,
  }: AvailableWebsiteGrantsArgs): Promise<WebsiteGrantAccess> {
    const request: WebsiteGrantsArgs = {
      origin,
      sender,
      forbiddenReason,
      interactive: false,
    }
    return this.websiteGrants(request)
  }

  private async websiteGrants({
    origin,
    sender,
    forbiddenReason,
    interactive,
  }: WebsiteGrantsArgs): Promise<WebsiteGrantAccess> {
    const nookTypedArgs0_8: Parameters<
      typeof this.isAuthorizedWebsiteSender
    >[0] = {
      sender,
      origin,
    }
    if (!this.isAuthorizedWebsiteSender(nookTypedArgs0_8)) {
      return { response: { ok: false, reason: forbiddenReason } }
    }
    const grants = await this.passwordPairingGrants()
    if (grants.length === 0) {
      return {
        response: {
          ok: true,
          status: WebsiteAuthenticatorResponseStatus.Unavailable,
        },
      }
    }

    const queueExpiresAt = Date.now() + SESSION_INTERACTIVE_QUEUE_TIMEOUT_MS
    const queue = interactive
      ? extensionSessionInteractiveDeadline(queueExpiresAt)
      : extensionSessionProbeDeadline(queueExpiresAt)
    const nookTypedArgs0_9: Parameters<typeof this.sendSessionMessage>[0] = {
      type: 'nook:extension-session-status',
      payload: { queue },
    }
    const statusDelivery = await this.sendSessionMessage(nookTypedArgs0_9)
    if (statusDelivery.isErr())
      return { response: statusDelivery.error.response }
    const status = statusDelivery.value
    await companionWasmReady
    const sessionStatus = this.websiteSessionStatusTransport(status)
    if (interactive) {
      // The site page opens the Nook side panel to unlock; Sign in is its gesture.
      if (sessionStatus !== ExtensionSessionStatusAvailability.Unlocked) {
        return {
          response: {
            ok: true,
            status: WebsiteAuthenticatorResponseStatus.Locked,
          },
        }
      }
      return { grants }
    }
    if (sessionStatus === ExtensionSessionStatusAvailability.Unavailable) {
      return {
        response: {
          ok: true,
          status: WebsiteAuthenticatorResponseStatus.Unavailable,
        },
      }
    }
    return sessionStatus === ExtensionSessionStatusAvailability.Unlocked
      ? { grants }
      : {
          response: {
            ok: true,
            status: WebsiteAuthenticatorResponseStatus.Locked,
          },
        }
  }
}

export const extensionPairingIdentity = new ExtensionPairingIdentity()
