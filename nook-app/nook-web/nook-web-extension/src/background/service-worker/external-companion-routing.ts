import {
  isExtensionIdentityHandoffRequestMessage,
  isExtensionPairedVaultIdentityDiscoveryMessage,
  isExtensionPairedVaultIdentityHandoffRequestMessage,
  isExtensionPairedVaultUnlockRequestMessage,
  isOpenCompanionLauncherMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import { importPairingAfterCompanionReady } from './pairing-import'
import {
  createIdentityHandoff,
  discoverPairedVaultIdentity,
  hasPairingApprovedType,
  isNokeySender,
  requestPairedVaultUnlock,
} from './pairing-identity'
import { openCompanionLauncher } from './session-lifecycle'

type ChromeMessageListener = Parameters<
  typeof chrome.runtime.onMessageExternal.addListener
>[0]

type ExternalCompanionRoutingArgs = {
  message: Parameters<ChromeMessageListener>[0]
  sender: chrome.runtime.MessageSender
  sendResponse: Parameters<ChromeMessageListener>[2]
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
  message,
  sender,
  sendResponse,
}: ExternalCompanionRoutingArgs): boolean {
  if (isOpenCompanionLauncherMessage(message)) {
    if (!isNokeySender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openCompanionLauncher(message.payload?.intent)
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
