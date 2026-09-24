import { ExternalSenderTrustPolicy } from './routing-trust'
import type * as RuntimeMessages from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  ExtensionPairingApprovedGrantAdmission,
  ExtensionPairingApprovedMessageType,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import { NormalizedOpenCompanionLauncherMessage as NormalizedOpenCompanionLauncherMessageSchema } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import type * as PairingIdentity from './pairing-identity'
import type * as PairingImport from './pairing-import'
import type * as SessionLifecycle from './session-lifecycle'
import { ExtensionSessionLifecycle } from './session-lifecycle'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../../lib/concrete-decoder'
import {
  SerializedWireSnapshotKind,
  SerializedWireValueAdapter,
} from '../../lib/serialized-wire-value-adapter'

type ChromeMessageListener = Parameters<
  typeof chrome.runtime.onMessageExternal.addListener
>[0]

export type ExternalCompanionValue =
  | string
  | number
  | boolean
  | ExternalCompanionMessage
  | ExternalCompanionValue[]

export type ExternalCompanionMessage = {
  [key: string]: ExternalCompanionValue
}

export type ExternalCompanionRoutingRequest = {
  dependencies: ExternalCompanionRoutingDependencies
  message: ExternalCompanionMessage
  sender: chrome.runtime.MessageSender
  sendResponse: Parameters<ChromeMessageListener>[2]
}

export type ExternalCompanionRoutingDependencies = {
  createIdentityHandoff: typeof PairingIdentity.extensionPairingIdentity.createIdentityHandoff
  createPairedIdentityHandoff: typeof PairingIdentity.extensionPairingIdentity.createPairedIdentityHandoff
  discoverPairedVaultIdentity: typeof PairingIdentity.extensionPairingIdentity.discoverPairedVaultIdentity
  decodePairingApprovedMessage: typeof RuntimeMessages.ExtensionPairingApprovedMessage.decode
  importPairingAfterCompanionReady: typeof PairingImport.importPairingAfterCompanionReady
  decodeExtensionIdentityHandoffRequestMessage: typeof RuntimeMessages.ExtensionIdentityHandoffRequestMessage.decode
  decodeExtensionPairedVaultIdentityDiscoveryMessage: typeof RuntimeMessages.ExtensionPairedVaultIdentityDiscoveryMessage.decode
  decodeExtensionPairedVaultIdentityHandoffRequestMessage: typeof RuntimeMessages.ExtensionPairedVaultIdentityHandoffRequestMessage.decode
  decodeExtensionPairedVaultUnlockRequestMessage: typeof RuntimeMessages.ExtensionPairedVaultUnlockRequestMessage.decode
  decodeOpenCompanionLauncherMessage: typeof NormalizedOpenCompanionLauncherMessageSchema.decode
  openCompanionLauncher: typeof SessionLifecycle.extensionSessionLifecycle.openCompanionLauncher
  refreshAuthenticationSurfaces: typeof SessionLifecycle.extensionSessionLifecycle.refreshAuthenticationSurfaces
  requestPairedVaultUnlock: typeof PairingIdentity.extensionPairingIdentity.requestPairedVaultUnlock
}

type MessageResponse = { ok: boolean; reason?: string }

const forbiddenSenderResponse: MessageResponse = {
  ok: false,
  reason: 'forbidden-sender',
}
const successResponse: MessageResponse = { ok: true }
const launcherFailureResponse: MessageResponse = {
  ok: false,
  reason: 'launcher-failed',
}
const invalidPairingGrantResponse: MessageResponse = {
  ok: false,
  reason: 'invalid-pairing-grant',
}
const eventLogImportFailureResponse: MessageResponse = {
  ok: false,
  reason: 'event-log-import-failed',
}

function pairingGrantDecodeFailureResponse(
  message: ExternalCompanionMessage,
): MessageResponse {
  if (
    message.type !==
    ExtensionPairingApprovedMessageType.NookExtensionPairingApproved
  ) {
    return invalidPairingGrantResponse
  }
  const admission = ExtensionPairingApprovedGrantAdmission.parse(
    message.payload,
  )
  if (admission.isErr()) return { ok: false, reason: admission.error }
  return eventLogImportFailureResponse
}

export class ExternalCompanionRouter {
  constructor(private readonly request: ExternalCompanionRoutingRequest) {}

  async route(): Promise<boolean> {
    const { dependencies, message, sender, sendResponse } = this.request
    const eventLogRecordsSnapshot =
      SerializedWireValueAdapter.snapshotEventLogRecords(message)
    if (!(await ExternalSenderTrustPolicy.admits(sender))) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    const {
      createIdentityHandoff,
      createPairedIdentityHandoff,
      discoverPairedVaultIdentity,
      decodePairingApprovedMessage,
      importPairingAfterCompanionReady,
      decodeExtensionIdentityHandoffRequestMessage,
      decodeExtensionPairedVaultIdentityDiscoveryMessage,
      decodeExtensionPairedVaultIdentityHandoffRequestMessage,
      decodeExtensionPairedVaultUnlockRequestMessage,
      decodeOpenCompanionLauncherMessage,
      openCompanionLauncher,
      refreshAuthenticationSurfaces,
      requestPairedVaultUnlock,
    } = dependencies
    const launcherMessage = runConcreteDecoder(
      decodeOpenCompanionLauncherMessage,
      message,
    )
    if (launcherMessage.kind === ConcreteDecoderResultKind.Decoded) {
      const source = ExtensionSessionLifecycle.sourceFromSender(sender)
      void openCompanionLauncher(launcherMessage.value.intent, source)
        .then(() => sendResponse(successResponse))
        .catch(() => sendResponse(launcherFailureResponse))
      return true
    }

    const identityDiscovery = runConcreteDecoder(
      decodeExtensionPairedVaultIdentityDiscoveryMessage,
      message,
    )
    if (identityDiscovery.kind === ConcreteDecoderResultKind.Decoded) {
      if (!(await ExternalSenderTrustPolicy.admits(sender))) {
        sendResponse(forbiddenSenderResponse)
        return false
      }
      void discoverPairedVaultIdentity(identityDiscovery.value).then(
        sendResponse,
      )
      return true
    }

    const pairedVaultUnlock = runConcreteDecoder(
      decodeExtensionPairedVaultUnlockRequestMessage,
      message,
    )
    if (pairedVaultUnlock.kind === ConcreteDecoderResultKind.Decoded) {
      const decodedMessage = pairedVaultUnlock.value
      const source = ExtensionSessionLifecycle.sourceFromSender(sender)
      void requestPairedVaultUnlock(decodedMessage, source)
        .then(sendResponse)
        .catch(() => {
          const unlockFailureResponse: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'unlock-launch-failed',
          }
          return sendResponse(unlockFailureResponse)
        })
      return true
    }

    const identityHandoff = runConcreteDecoder(
      decodeExtensionIdentityHandoffRequestMessage,
      message,
    )
    if (identityHandoff.kind === ConcreteDecoderResultKind.Decoded) {
      void createIdentityHandoff(identityHandoff.value).then(sendResponse)
      return true
    }

    const pairedIdentityHandoff = runConcreteDecoder(
      decodeExtensionPairedVaultIdentityHandoffRequestMessage,
      message,
    )
    if (pairedIdentityHandoff.kind === ConcreteDecoderResultKind.Decoded) {
      if (!(await ExternalSenderTrustPolicy.admits(sender))) {
        sendResponse(forbiddenSenderResponse)
        return false
      }
      void createPairedIdentityHandoff(pairedIdentityHandoff.value).then(
        sendResponse,
      )
      return true
    }

    const pairingApproval = runConcreteDecoder(
      decodePairingApprovedMessage,
      message,
    )
    if (pairingApproval.kind === ConcreteDecoderResultKind.Rejected) {
      sendResponse(pairingGrantDecodeFailureResponse(message))
      return false
    }
    if (eventLogRecordsSnapshot.kind === SerializedWireSnapshotKind.Missing) {
      sendResponse(invalidPairingGrantResponse)
      return false
    }
    const preservedEventLogRecords =
      SerializedWireValueAdapter.restoreEventLogRecords<
        typeof pairingApproval.value.eventLogRecords
      >(eventLogRecordsSnapshot.value)
    const importMessage: typeof pairingApproval.value = {
      ...pairingApproval.value,
      eventLogRecords: preservedEventLogRecords,
    }
    void importPairingAfterCompanionReady(importMessage)
      .then(async (response) => {
        if (!response.ok) return response
        try {
          await refreshAuthenticationSurfaces()
        } catch {
          // The pairing import has already committed; keep its success response.
        }
        return response
      })
      .then(sendResponse)
    return true
  }
}
