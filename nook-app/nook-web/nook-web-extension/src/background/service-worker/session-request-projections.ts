import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import {
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  type ExtensionSessionTransportRequest,
} from '../../offscreen/session-request-adapter'
import {
  extensionSessionGrantIdentity,
  type StoredExtensionPairingGrant,
} from '../pairing-grants'

type IdentityHandoffSessionRequest = Extract<
  ExtensionSessionTransportRequest,
  { type: typeof ExtensionSessionMessageType.SealIdentityHandoff }
>

type WebsiteLoginRevealSessionRequest = Extract<
  ExtensionSessionTransportRequest,
  { type: typeof ExtensionSessionMessageType.RevealLogin }
>

export type IdentityHandoffSessionProjection = {
  readonly recipientPublicKey: string
  readonly nonce: string
  readonly expectedDeviceId: string
  readonly expectedDevicePublicKey: string
  readonly expectedDeviceSigningPublicKey: string
}

export function identityHandoffSessionRequest(
  request: IdentityHandoffSessionProjection,
): IdentityHandoffSessionRequest {
  return {
    type: ExtensionSessionMessageType.SealIdentityHandoff,
    payload: {
      recipientPublicKey: request.recipientPublicKey,
      nonce: request.nonce,
      expectedDeviceId: request.expectedDeviceId,
      expectedDevicePublicKey: request.expectedDevicePublicKey,
      expectedDeviceSigningPublicKey: request.expectedDeviceSigningPublicKey,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
}

type WebsiteLoginRevealSessionRequestArgs = {
  grant: StoredExtensionPairingGrant
  origin: string
  secretId: string
}

export function websiteLoginRevealSessionRequest({
  grant,
  origin,
  secretId,
}: WebsiteLoginRevealSessionRequestArgs): WebsiteLoginRevealSessionRequest {
  return {
    type: ExtensionSessionMessageType.RevealLogin,
    payload: {
      ...extensionSessionGrantIdentity(grant),
      origin,
      secretId,
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
}
