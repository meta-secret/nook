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
import type * as SessionLifecycle from './session-lifecycle'
import type * as SessionRuntimeMessages from './session-runtime-messages'
import type * as AccountPickers from './account-pickers'
import { AccountPickerCleanupMarkerStatus } from './account-pickers'
import type * as AuthenticatorOperations from './authenticator-operations'
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
  accountPickerAuthorizationCleanupPending: typeof AccountPickers.accountPickerAuthorizationCleanupPending
  beginAccountPickerAuthorizationCleanup: typeof AccountPickers.beginAccountPickerAuthorizationCleanup
  clearPendingAccountPickers: typeof AccountPickers.clearPendingAccountPickers
  clearMountedAuthenticationSurfaces: typeof SessionLifecycle.clearMountedAuthenticationSurfaces
  clearStagedAuthenticatorEnrollments: typeof AuthenticatorOperations.clearStagedAuthenticatorEnrollments
  rebindStagedAuthenticatorEnrollmentsAuthorization: typeof AuthenticatorOperations.rebindStagedAuthenticatorEnrollmentsAuthorization
  closeExtensionSessionDocument: typeof SessionLifecycle.closeExtensionSessionDocument
  completeAccountPickerAuthorizationCleanup: typeof AccountPickers.completeAccountPickerAuthorizationCleanup
  ensureExtensionSessionDocument: typeof SessionLifecycle.ensureExtensionSessionDocument
  extensionSessionDocument: typeof SessionLifecycle.extensionSessionDocument
  handlePairingStateQuery: typeof PairingStateQuery.handlePairingStateQuery
  hasPairingApprovedType: typeof PairingIdentity.hasPairingApprovedType
  importLocalEventLogUpdate: typeof PairingImport.importLocalEventLogUpdate
  importPairingAfterCompanionReady: typeof PairingImport.importPairingAfterCompanionReady
  invalidateAllLoginMatchAvailability: typeof AccountPickers.invalidateAllLoginMatchAvailability
  isExtensionAuthenticationSurfacesRefreshMessage: typeof SessionRuntimeMessages.isExtensionAuthenticationSurfacesRefreshMessage
  isExtensionPairingStateQueryMessage: typeof PairingState.isExtensionPairingStateQueryMessage
  isExtensionSessionEnsureMessage: typeof SessionRuntimeMessages.isExtensionSessionEnsureMessage
  isExtensionSessionExpiryMessage: typeof SessionRuntimeMessages.isExtensionSessionExpiryMessage
  isExtensionSessionLockMessage: typeof SessionRuntimeMessages.isExtensionSessionLockMessage
  openCompanionLauncher: typeof SessionLifecycle.openCompanionLauncher
  openExtensionPairing: typeof PairingIdentity.openExtensionPairing
  openSimpleVault: typeof SessionLifecycle.openSimpleVault
  queryActiveTabLoginDetection: typeof SessionLifecycle.queryActiveTabLoginDetection
  releaseAccountPickerAuthorizationCleanup: typeof AccountPickers.releaseAccountPickerAuthorizationCleanup
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

type ClearAuthorizationStateArgs = {
  beginAccountPickerAuthorizationCleanup: typeof AccountPickers.beginAccountPickerAuthorizationCleanup
  clearPendingAccountPickers: typeof AccountPickers.clearPendingAccountPickers
  clearMountedAuthenticationSurfaces: typeof SessionLifecycle.clearMountedAuthenticationSurfaces
  clearStagedAuthenticatorEnrollments: typeof AuthenticatorOperations.clearStagedAuthenticatorEnrollments
  closeExtensionSessionDocument: typeof SessionLifecycle.closeExtensionSessionDocument
  completeAccountPickerAuthorizationCleanup: typeof AccountPickers.completeAccountPickerAuthorizationCleanup
  releaseAccountPickerAuthorizationCleanup: typeof AccountPickers.releaseAccountPickerAuthorizationCleanup
  closeSession: boolean
  cleanupStart: AuthorizationCleanupStart
}

enum AuthorizationCleanupStartKind {
  Begin = 'begin',
  Existing = 'existing',
}

type AuthorizationCleanupStart =
  | { kind: AuthorizationCleanupStartKind.Begin }
  | {
      kind: AuthorizationCleanupStartKind.Existing
      cleanup: AccountPickers.AccountPickerAuthorizationCleanupStart
    }

async function clearAuthorizationState({
  beginAccountPickerAuthorizationCleanup,
  clearPendingAccountPickers,
  clearMountedAuthenticationSurfaces,
  clearStagedAuthenticatorEnrollments,
  closeExtensionSessionDocument,
  completeAccountPickerAuthorizationCleanup,
  releaseAccountPickerAuthorizationCleanup,
  closeSession,
  cleanupStart,
}: ClearAuthorizationStateArgs): Promise<void> {
  const startedCleanup =
    cleanupStart.kind === AuthorizationCleanupStartKind.Existing
      ? cleanupStart.cleanup
      : await beginAccountPickerAuthorizationCleanup()
  const { authorizationGeneration, markerStatus } = startedCleanup
  let failed = markerStatus === AccountPickerCleanupMarkerStatus.Unavailable
  clearStagedAuthenticatorEnrollments()
  if (closeSession) {
    try {
      await closeExtensionSessionDocument()
    } catch {
      failed = true
    }
  }
  try {
    await clearPendingAccountPickers()
  } catch {
    failed = true
  }
  try {
    await clearMountedAuthenticationSurfaces()
  } catch {
    failed = true
  }
  try {
    await clearPendingAccountPickers()
  } catch {
    failed = true
  }
  clearStagedAuthenticatorEnrollments()
  if (failed) {
    releaseAccountPickerAuthorizationCleanup(authorizationGeneration)
    throw new Error('authorization cleanup failed')
  }
  await completeAccountPickerAuthorizationCleanup(authorizationGeneration)
}

export async function recoverInterruptedAuthorizationCleanup(
  dependencies: ExtensionLifecycleRoutingDependencies,
): Promise<void> {
  const pendingLookup = dependencies
    .accountPickerAuthorizationCleanupPending()
    .then(
      (pending) => ({ kind: 'resolved' as const, pending }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    )
  const cleanup = await dependencies.beginAccountPickerAuthorizationCleanup()
  const lookup = await pendingLookup
  if (lookup.kind === 'rejected') throw lookup.error
  if (!lookup.pending) {
    await dependencies.completeAccountPickerAuthorizationCleanup(
      cleanup.authorizationGeneration,
    )
    return
  }
  const cleanupArgs: ClearAuthorizationStateArgs = {
    ...dependencies,
    closeSession: true,
    cleanupStart: {
      kind: AuthorizationCleanupStartKind.Existing,
      cleanup,
    },
  }
  await clearAuthorizationState(cleanupArgs)
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
    beginAccountPickerAuthorizationCleanup,
    clearPendingAccountPickers,
    clearMountedAuthenticationSurfaces,
    clearStagedAuthenticatorEnrollments,
    closeExtensionSessionDocument,
    completeAccountPickerAuthorizationCleanup,
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
    queryActiveTabLoginDetection,
    releaseAccountPickerAuthorizationCleanup,
    rebindStagedAuthenticatorEnrollmentsAuthorization,
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
    const cleanupArgs: ClearAuthorizationStateArgs = {
      beginAccountPickerAuthorizationCleanup,
      clearPendingAccountPickers,
      clearMountedAuthenticationSurfaces,
      clearStagedAuthenticatorEnrollments,
      closeExtensionSessionDocument,
      completeAccountPickerAuthorizationCleanup,
      releaseAccountPickerAuthorizationCleanup,
      closeSession: true,
      cleanupStart: { kind: AuthorizationCleanupStartKind.Begin },
    }
    void clearAuthorizationState(cleanupArgs)
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
    const cleanupArgs: ClearAuthorizationStateArgs = {
      beginAccountPickerAuthorizationCleanup,
      clearPendingAccountPickers,
      clearMountedAuthenticationSurfaces,
      clearStagedAuthenticatorEnrollments,
      closeExtensionSessionDocument,
      completeAccountPickerAuthorizationCleanup,
      releaseAccountPickerAuthorizationCleanup,
      closeSession: true,
      cleanupStart: { kind: AuthorizationCleanupStartKind.Begin },
    }
    void clearAuthorizationState(cleanupArgs)
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
    void importPairingAfterCompanionReady(message)
      .then(async (response) => {
        invalidateAllLoginMatchAvailability()
        if (response.ok) await refreshAuthenticationSurfaces()
      })
      .then(sendResponse)
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
    void beginAccountPickerAuthorizationCleanup()
      .then(async (cleanupStart) => {
        try {
          const response = await importLocalEventLogUpdate(importArgs)
          invalidateAllLoginMatchAvailability()
          if (!response.ok && response.reason === 'event-log-access-revoked') {
            const cleanupArgs: ClearAuthorizationStateArgs = {
              beginAccountPickerAuthorizationCleanup,
              clearPendingAccountPickers,
              clearMountedAuthenticationSurfaces,
              clearStagedAuthenticatorEnrollments,
              closeExtensionSessionDocument,
              completeAccountPickerAuthorizationCleanup,
              releaseAccountPickerAuthorizationCleanup,
              closeSession: true,
              cleanupStart: {
                kind: AuthorizationCleanupStartKind.Existing,
                cleanup: cleanupStart,
              },
            }
            try {
              await clearAuthorizationState(cleanupArgs)
            } catch {
              // Authorization remains invalid while browser cleanup is retried.
            }
          } else {
            rebindStagedAuthenticatorEnrollmentsAuthorization(
              cleanupStart.authorizationGeneration,
            )
            if (response.ok) await refreshAuthenticationSurfaces()
            else await clearMountedAuthenticationSurfaces()
            await completeAccountPickerAuthorizationCleanup(
              cleanupStart.authorizationGeneration,
            )
          }
          return response
        } catch (error) {
          releaseAccountPickerAuthorizationCleanup(
            cleanupStart.authorizationGeneration,
          )
          throw error
        }
      })
      .then(sendResponse)
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
