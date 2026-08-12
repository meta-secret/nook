import { isNokeySender } from './routing-trust'
import type * as RuntimeMessages from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  OpenCompanionLauncherNormalizationKind,
  type normalizeOpenCompanionLauncherMessage,
} from '../../../../nook-web-shared/src/extension/companion-launcher-message-adapter'
import type * as PairingIdentity from './pairing-identity'
import type * as PairingImport from './pairing-import'
import type * as SessionLifecycle from './session-lifecycle'

type ChromeMessageListener = Parameters<
  typeof chrome.runtime.onMessageExternal.addListener
>[0]

type ExternalCompanionRoutingArgs = {
  dependencies: ExternalCompanionRoutingDependencies
  message: Parameters<ChromeMessageListener>[0]
  sender: chrome.runtime.MessageSender
  sendResponse: Parameters<ChromeMessageListener>[2]
}

export type ExternalCompanionRoutingDependencies = {
  createIdentityHandoff: typeof PairingIdentity.createIdentityHandoff
  discoverPairedVaultIdentity: typeof PairingIdentity.discoverPairedVaultIdentity
  hasPairingApprovedType: typeof PairingIdentity.hasPairingApprovedType
  importPairingAfterCompanionReady: typeof PairingImport.importPairingAfterCompanionReady
  isExtensionIdentityHandoffRequestMessage: typeof RuntimeMessages.isExtensionIdentityHandoffRequestMessage
  isExtensionPairedVaultIdentityDiscoveryMessage: typeof RuntimeMessages.isExtensionPairedVaultIdentityDiscoveryMessage
  isExtensionPairedVaultIdentityHandoffRequestMessage: typeof RuntimeMessages.isExtensionPairedVaultIdentityHandoffRequestMessage
  isExtensionPairedVaultUnlockRequestMessage: typeof RuntimeMessages.isExtensionPairedVaultUnlockRequestMessage
  normalizeOpenCompanionLauncherMessage: typeof normalizeOpenCompanionLauncherMessage
  openCompanionLauncher: typeof SessionLifecycle.openCompanionLauncher
  requestPairedVaultUnlock: typeof PairingIdentity.requestPairedVaultUnlock
}

type MessageResponse = Parameters<
  ExternalCompanionRoutingArgs['sendResponse']
>[0]

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

export function routeExternalCompanionMessage({
  dependencies,
  message,
  sender,
  sendResponse,
}: ExternalCompanionRoutingArgs): boolean {
  const {
    createIdentityHandoff,
    discoverPairedVaultIdentity,
    hasPairingApprovedType,
    importPairingAfterCompanionReady,
    isExtensionIdentityHandoffRequestMessage,
    isExtensionPairedVaultIdentityDiscoveryMessage,
    isExtensionPairedVaultIdentityHandoffRequestMessage,
    isExtensionPairedVaultUnlockRequestMessage,
    normalizeOpenCompanionLauncherMessage,
    openCompanionLauncher,
    requestPairedVaultUnlock,
  } = dependencies
  const launcherMessage = normalizeOpenCompanionLauncherMessage(message)
  if (
    launcherMessage.kind === OpenCompanionLauncherNormalizationKind.Normalized
  ) {
    if (!isNokeySender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openCompanionLauncher(launcherMessage.message.intent)
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(launcherFailureResponse))
    return true
  }

  if (isExtensionPairedVaultIdentityDiscoveryMessage(message)) {
    if (!isNokeySender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void discoverPairedVaultIdentity(message).then(sendResponse)
    return true
  }

  if (isExtensionPairedVaultUnlockRequestMessage(message)) {
    if (!isNokeySender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void requestPairedVaultUnlock(message)
      .then(sendResponse)
      .catch(() => {
        const unlockFailureResponse: Parameters<typeof sendResponse>[0] = {
          ok: false,
          requestId: message.payload.requestId,
          vaultStoreId: message.payload.vaultStoreId,
          reason: 'unlock-launch-failed',
        }
        return sendResponse(unlockFailureResponse)
      })
    return true
  }

  if (
    isExtensionIdentityHandoffRequestMessage(message) ||
    isExtensionPairedVaultIdentityHandoffRequestMessage(message)
  ) {
    if (!isNokeySender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void createIdentityHandoff(message).then(sendResponse)
    return true
  }

  if (!hasPairingApprovedType(message) || !isNokeySender(sender)) {
    sendResponse(invalidPairingGrantResponse)
    return false
  }
  void importPairingAfterCompanionReady(message).then(sendResponse)
  return true
}
