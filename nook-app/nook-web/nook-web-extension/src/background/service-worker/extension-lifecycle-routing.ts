import {
  isBeginExtensionPairingMessage,
  isExtensionLocalEventLogUpdatedMessage,
  isOpenSimpleVaultMessage,
} from '../../../../nook-web-shared/src/extension/lifecycle-runtime-message-adapter'
import {
  normalizeOpenCompanionLauncherMessage,
  OpenCompanionLauncherNormalizationKind,
} from '../../../../nook-web-shared/src/extension/companion-launcher-message-adapter'
import { isExtensionRuntimeSender, isNokeySender } from './routing-trust'
import type * as PairingState from '../../lib/pairing-state'
import type * as PairingIdentity from './pairing-identity'
import type * as PairingImport from './pairing-import'
import type * as PairingStateQuery from './pairing-state-query'
import type * as AccountPickers from './account-pickers'
import type * as SessionLifecycle from './session-lifecycle'
import type * as SessionRuntimeMessages from './session-runtime-messages'

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
  clearMountedAuthenticationSurfaces: typeof SessionLifecycle.clearMountedAuthenticationSurfaces
  closeExtensionSessionDocument: typeof SessionLifecycle.closeExtensionSessionDocument
  ensureExtensionSessionDocument: typeof SessionLifecycle.ensureExtensionSessionDocument
  extensionSessionDocument: typeof SessionLifecycle.extensionSessionDocument
  handlePairingStateQuery: typeof PairingStateQuery.handlePairingStateQuery
  hasPairingApprovedType: typeof PairingIdentity.hasPairingApprovedType
  importLocalEventLogUpdate: typeof PairingImport.importLocalEventLogUpdate
  importPairingAfterCompanionReady: typeof PairingImport.importPairingAfterCompanionReady
  invalidateAllLoginMatchAvailability: typeof AccountPickers.invalidateAllLoginMatchAvailability
  isExtensionPairingStateQueryMessage: typeof PairingState.isExtensionPairingStateQueryMessage
  isExtensionAuthenticationSurfacesRefreshMessage: typeof SessionRuntimeMessages.isExtensionAuthenticationSurfacesRefreshMessage
  isExtensionSessionEnsureMessage: typeof SessionRuntimeMessages.isExtensionSessionEnsureMessage
  isExtensionSessionExpiryMessage: typeof SessionRuntimeMessages.isExtensionSessionExpiryMessage
  isExtensionSessionLockMessage: typeof SessionRuntimeMessages.isExtensionSessionLockMessage
  openCompanionLauncher: typeof SessionLifecycle.openCompanionLauncher
  openExtensionPairing: typeof PairingIdentity.openExtensionPairing
  openSimpleVault: typeof SessionLifecycle.openSimpleVault
  refreshAuthenticationSurfaces: typeof SessionLifecycle.refreshAuthenticationSurfaces
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
    clearMountedAuthenticationSurfaces,
    closeExtensionSessionDocument,
    ensureExtensionSessionDocument,
    extensionSessionDocument,
    handlePairingStateQuery,
    hasPairingApprovedType,
    importLocalEventLogUpdate,
    importPairingAfterCompanionReady,
    invalidateAllLoginMatchAvailability,
    isExtensionAuthenticationSurfacesRefreshMessage,
    isExtensionPairingStateQueryMessage,
    isExtensionSessionEnsureMessage,
    isExtensionSessionExpiryMessage,
    isExtensionSessionLockMessage,
    openCompanionLauncher,
    openExtensionPairing,
    openSimpleVault,
    refreshAuthenticationSurfaces,
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

  if (isExtensionAuthenticationSurfacesRefreshMessage(message)) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    invalidateAllLoginMatchAvailability()
    void refreshAuthenticationSurfaces()
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
    invalidateAllLoginMatchAvailability()
    void Promise.all([
      closeExtensionSessionDocument(),
      clearMountedAuthenticationSurfaces(),
    ])
      .finally(invalidateAllLoginMatchAvailability)
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
    invalidateAllLoginMatchAvailability()
    void Promise.all([
      closeExtensionSessionDocument(),
      clearMountedAuthenticationSurfaces(),
    ])
      .finally(invalidateAllLoginMatchAvailability)
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(sessionLockFailureResponse))
    return true
  }

  if (hasPairingApprovedType(message)) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    invalidateAllLoginMatchAvailability()
    void importPairingAfterCompanionReady(message).then(sendResponse)
    return true
  }

  if (isExtensionLocalEventLogUpdatedMessage(message)) {
    if (!isExtensionRuntimeSender(sender) || !isNokeySender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    invalidateAllLoginMatchAvailability()
    const importArgs: Parameters<typeof importLocalEventLogUpdate>[0] = {
      vaultStoreId: message.payload.vaultStoreId,
      eventLogRecords: message.payload.eventLogRecords,
    }
    void importLocalEventLogUpdate(importArgs)
      .then(async (response) => {
        invalidateAllLoginMatchAvailability()
        if (response.ok) {
          await refreshAuthenticationSurfaces()
        } else {
          await clearMountedAuthenticationSurfaces()
        }
        return response
      })
      .then(sendResponse)
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

  const launcherMessage = normalizeOpenCompanionLauncherMessage(message)
  if (
    launcherMessage.kind === OpenCompanionLauncherNormalizationKind.Normalized
  ) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openCompanionLauncher(launcherMessage.message.intent)
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
