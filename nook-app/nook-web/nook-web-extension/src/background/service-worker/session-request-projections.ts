import type {
  ExtensionIdentityHandoffRequestMessage,
  ExtensionPairedVaultIdentityHandoffRequestMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
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
  { type: `${ExtensionSessionMessageType.SealIdentityHandoff}` }
>

type WebsiteLoginRevealSessionRequest = Extract<
  ExtensionSessionTransportRequest,
  { type: `${ExtensionSessionMessageType.RevealLogin}` }
>

export function identityHandoffSessionRequest(
  message:
    | ExtensionIdentityHandoffRequestMessage
    | ExtensionPairedVaultIdentityHandoffRequestMessage,
): IdentityHandoffSessionRequest {
  return {
    type: ExtensionSessionMessageType.SealIdentityHandoff,
    payload: {
      recipientPublicKey: message.payload.recipientPublicKey,
      nonce: message.payload.nonce,
      expectedDeviceId: message.payload.expectedDeviceId,
      expectedDevicePublicKey: message.payload.expectedDevicePublicKey,
      expectedDeviceSigningPublicKey:
        message.payload.expectedDeviceSigningPublicKey,
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
