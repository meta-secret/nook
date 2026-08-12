import {
  isBeginExtensionPairingMessage,
  isExtensionLocalEventLogUpdatedMessage,
  isOpenCompanionLauncherMessage,
  isOpenSimpleVaultMessage,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import { isExtensionPairingStateQueryMessage } from '../../lib/pairing-state'
import {
  importLocalEventLogUpdate,
  importPairingAfterCompanionReady,
} from './pairing-import'
import {
  hasPairingApprovedType,
  isNokeySender,
  openExtensionPairing,
} from './pairing-identity'
import { handlePairingStateQuery } from './pairing-state-query'
import {
  closeExtensionSessionDocument,
  ensureExtensionSessionDocument,
  extensionSessionDocument,
  isExtensionSessionEnsureMessage,
  isExtensionSessionExpiryMessage,
  isExtensionSessionLockMessage,
  openCompanionLauncher,
  openSimpleVault,
  queryActiveTabLoginDetection,
} from './session-lifecycle'
import {
  LoginDetectionStatus,
  isQueryActiveTabLoginDetectionMessage,
  type LoginDetectionResponse,
} from '../../lib/login-detection-messages'

type ChromeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]

type ExtensionLifecycleRoutingArgs = {
  message: Parameters<ChromeMessageListener>[0]
  sender: chrome.runtime.MessageSender
  sendResponse: Parameters<ChromeMessageListener>[2]
}

const forbiddenSenderResponse = { ok: false, reason: 'forbidden-sender' }
const successResponse = { ok: true }
const sessionRuntimeFailureResponse = {
  ok: false,
  reason: 'session-runtime-failed',
}
const sessionLockFailureResponse = { ok: false, reason: 'session-lock-failed' }
const launcherFailureResponse = { ok: false, reason: 'launcher-failed' }
const pairingLaunchFailureResponse = {
  ok: false,
  reason: 'pairing-launch-failed',
}

export enum ExtensionLifecycleRoutingResult {
  Unhandled = 'unhandled',
}

export function routeExtensionLifecycleMessage({
  message,
  sender,
  sendResponse,
}: ExtensionLifecycleRoutingArgs): boolean | ExtensionLifecycleRoutingResult {
  if (isExtensionPairingStateQueryMessage(message)) {
    const queryContext: Parameters<typeof handlePairingStateQuery>[0] = {
      sender,
      sendResponse,
    }
    return handlePairingStateQuery(queryContext)
  }

  if (isExtensionSessionEnsureMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void ensureExtensionSessionDocument()
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(sessionRuntimeFailureResponse))
    return true
  }

  if (isExtensionSessionLockMessage(message)) {
    const senderUrlAllowed =
      !('url' in sender) ||
      (typeof sender.url === 'string' &&
        sender.url.startsWith(chrome.runtime.getURL('')))
    if (sender.id !== chrome.runtime.id || !senderUrlAllowed) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void closeExtensionSessionDocument()
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(sessionLockFailureResponse))
    return true
  }

  if (isExtensionSessionExpiryMessage(message)) {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.endsWith(`/${extensionSessionDocument}`)
    ) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void closeExtensionSessionDocument().then(() =>
      sendResponse(successResponse),
    )
    return true
  }

  if (hasPairingApprovedType(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void importPairingAfterCompanionReady(message).then(sendResponse)
    return true
  }

  if (isExtensionLocalEventLogUpdatedMessage(message)) {
    if (sender.id !== chrome.runtime.id || !isNokeySender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    const importArgs: Parameters<typeof importLocalEventLogUpdate>[0] = {
      vaultStoreId: message.payload.vaultStoreId,
      eventLogRecords: message.payload.eventLogRecords,
    }
    void importLocalEventLogUpdate(importArgs).then(sendResponse)
    return true
  }

  if (isQueryActiveTabLoginDetectionMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void queryActiveTabLoginDetection()
      .then(sendResponse)
      .catch(() => {
        const response = {
          ok: true,
          status: LoginDetectionStatus.Unavailable,
        } satisfies LoginDetectionResponse
        return sendResponse(response)
      })
    return true
  }

  if (isOpenSimpleVaultMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    openSimpleVault()
    sendResponse(successResponse)
    return false
  }

  if (isOpenCompanionLauncherMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openCompanionLauncher(message.payload?.intent)
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(launcherFailureResponse))
    return true
  }

  if (isBeginExtensionPairingMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openExtensionPairing(message.payload)
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(pairingLaunchFailureResponse))
    return true
  }

  return ExtensionLifecycleRoutingResult.Unhandled
}
