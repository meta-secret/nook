import {
  isBeginExtensionPairingMessage,
  isExtensionLocalEventLogUpdatedMessage,
  isOpenSimpleVaultMessage,
} from '../../../../nook-web-shared/src/extension/lifecycle-runtime-message-adapter'
import { isOpenCompanionLauncherMessage } from '../../../../nook-web-shared/src/extension/companion-launcher-message-adapter'
import { isExtensionRuntimeSender, isNokeySender } from './routing-trust'
import type * as PairingState from '../../lib/pairing-state'
import type * as PairingIdentity from './pairing-identity'
import type * as PairingImport from './pairing-import'
import type * as PairingStateQuery from './pairing-state-query'
import type * as SessionLifecycle from './session-lifecycle'
import type * as SessionRuntimeMessages from './session-runtime-messages'
import {
  LoginDetectionStatus,
  isQueryActiveTabLoginDetectionMessage,
  type LoginDetectionResponse,
} from '../../lib/login-detection-messages'

type ChromeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]

type ExtensionLifecycleRoutingArgs = {
  dependencies: ExtensionLifecycleRoutingDependencies
  message: Parameters<ChromeMessageListener>[0]
  sender: chrome.runtime.MessageSender
  sendResponse: Parameters<ChromeMessageListener>[2]
}

export type ExtensionLifecycleRoutingDependencies = {
  closeExtensionSessionDocument: typeof SessionLifecycle.closeExtensionSessionDocument
  ensureExtensionSessionDocument: typeof SessionLifecycle.ensureExtensionSessionDocument
  extensionSessionDocument: typeof SessionLifecycle.extensionSessionDocument
  handlePairingStateQuery: typeof PairingStateQuery.handlePairingStateQuery
  hasPairingApprovedType: typeof PairingIdentity.hasPairingApprovedType
  importLocalEventLogUpdate: typeof PairingImport.importLocalEventLogUpdate
  importPairingAfterCompanionReady: typeof PairingImport.importPairingAfterCompanionReady
  isExtensionPairingStateQueryMessage: typeof PairingState.isExtensionPairingStateQueryMessage
  isExtensionSessionEnsureMessage: typeof SessionRuntimeMessages.isExtensionSessionEnsureMessage
  isExtensionSessionExpiryMessage: typeof SessionRuntimeMessages.isExtensionSessionExpiryMessage
  isExtensionSessionLockMessage: typeof SessionRuntimeMessages.isExtensionSessionLockMessage
  openCompanionLauncher: typeof SessionLifecycle.openCompanionLauncher
  openExtensionPairing: typeof PairingIdentity.openExtensionPairing
  openSimpleVault: typeof SessionLifecycle.openSimpleVault
  queryActiveTabLoginDetection: typeof SessionLifecycle.queryActiveTabLoginDetection
}

type MessageResponse = Parameters<
  ExtensionLifecycleRoutingArgs['sendResponse']
>[0]

const forbiddenSenderResponse: MessageResponse = {
  ok: false,
  reason: 'forbidden-sender',
}
const successResponse: MessageResponse = { ok: true }
const sessionRuntimeFailureResponse: MessageResponse = {
  ok: false,
  reason: 'session-runtime-failed',
}
const sessionLockFailureResponse: MessageResponse = {
  ok: false,
  reason: 'session-lock-failed',
}
const launcherFailureResponse: MessageResponse = {
  ok: false,
  reason: 'launcher-failed',
}
const pairingLaunchFailureResponse: MessageResponse = {
  ok: false,
  reason: 'pairing-launch-failed',
}

export enum ExtensionLifecycleRoutingResult {
  Unhandled = 'unhandled',
}

export function routeExtensionLifecycleMessage({
  dependencies,
  message,
  sender,
  sendResponse,
}: ExtensionLifecycleRoutingArgs): boolean | ExtensionLifecycleRoutingResult {
  const {
    closeExtensionSessionDocument,
    ensureExtensionSessionDocument,
    extensionSessionDocument,
    handlePairingStateQuery,
    hasPairingApprovedType,
    importLocalEventLogUpdate,
    importPairingAfterCompanionReady,
    isExtensionPairingStateQueryMessage,
    isExtensionSessionEnsureMessage,
    isExtensionSessionExpiryMessage,
    isExtensionSessionLockMessage,
    openCompanionLauncher,
    openExtensionPairing,
    openSimpleVault,
    queryActiveTabLoginDetection,
  } = dependencies
  if (isExtensionPairingStateQueryMessage(message)) {
    const queryContext: Parameters<typeof handlePairingStateQuery>[0] = {
      sender,
      sendResponse,
    }
    return handlePairingStateQuery(queryContext)
  }

  if (isExtensionSessionEnsureMessage(message)) {
    if (!isExtensionRuntimeSender(sender)) {
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
    if (!isExtensionRuntimeSender(sender) || !senderUrlAllowed) {
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
      !isExtensionRuntimeSender(sender) ||
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
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void importPairingAfterCompanionReady(message).then(sendResponse)
    return true
  }

  if (isExtensionLocalEventLogUpdatedMessage(message)) {
    if (!isExtensionRuntimeSender(sender) || !isNokeySender(sender)) {
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
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void queryActiveTabLoginDetection()
      .then(sendResponse)
      .catch(() => {
        const response: LoginDetectionResponse = {
          ok: true,
          status: LoginDetectionStatus.Unavailable,
        }
        return sendResponse(response)
      })
    return true
  }

  if (isOpenSimpleVaultMessage(message)) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    openSimpleVault()
    sendResponse(successResponse)
    return false
  }

  if (isOpenCompanionLauncherMessage(message)) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openCompanionLauncher(message.payload?.intent)
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(launcherFailureResponse))
    return true
  }

  if (isBeginExtensionPairingMessage(message)) {
    if (!isExtensionRuntimeSender(sender)) {
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
