import { err, ok, type Result } from 'neverthrow'
import type { ExtensionSessionTransportFailure } from './session-document'
import {
  BeginExtensionPairingMessage as BeginExtensionPairingMessageSchema,
  ExtensionLocalEventLogUpdatedMessage as ExtensionLocalEventLogUpdatedMessageSchema,
  OpenSimpleVaultMessage as OpenSimpleVaultMessageSchema,
} from '../../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import {
  OpenCompanionLauncherNormalizationKind,
  NormalizedOpenCompanionLauncherMessage as NormalizedOpenCompanionLauncherMessageSchema,
} from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import { isExtensionRuntimeSender, isNokeySender } from './routing-trust'
import type * as PairingState from '../../lib/pairing-state'
import type * as PairingIdentity from './pairing-identity'
import type * as PairingImport from './pairing-import'
import { LocalEventLogUpdateFailure } from './pairing-import'
import type * as PairingStateQuery from './pairing-state-query'
import type * as SessionLifecycle from './session-lifecycle'
import type * as SessionRuntimeMessages from './session-runtime-messages'
import type * as AccountPickers from './account-pickers'
import { AccountPickerCleanupMarkerStatus } from './account-pickers'
import type * as AuthenticatorOperations from './authenticator-operations'
import { CleanupEvidence } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

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
  clearPendingAccountPickers: typeof AccountPickers.accountPickerSessions.clearPendingAccountPickers
  clearStagedAuthenticatorEnrollments: typeof AuthenticatorOperations.authenticatorEnrollmentOperations.clearStagedAuthenticatorEnrollments
  rebindStagedAuthenticatorEnrollmentsAuthorization: typeof AuthenticatorOperations.authenticatorEnrollmentOperations.rebindStagedAuthenticatorEnrollmentsAuthorization
  closeExtensionSessionDocument: typeof SessionLifecycle.extensionSessionLifecycle.closeExtensionSessionDocument
  completeAccountPickerAuthorizationCleanup: typeof AccountPickers.completeAccountPickerAuthorizationCleanup
  ensureExtensionSessionDocument: typeof SessionLifecycle.extensionSessionLifecycle.ensureExtensionSessionDocument
  extensionSessionDocument: typeof SessionLifecycle.extensionSessionDocument
  handlePairingStateQuery: typeof PairingStateQuery.handlePairingStateQuery
  hasPairingApprovedType: typeof PairingIdentity.extensionPairingIdentity.hasPairingApprovedType
  importLocalEventLogUpdate: typeof PairingImport.importLocalEventLogUpdate
  importPairingAfterCompanionReady: typeof PairingImport.importPairingAfterCompanionReady
  isExtensionAuthenticationSurfacesRefreshMessage: typeof SessionRuntimeMessages.isExtensionAuthenticationSurfacesRefreshMessage
  isExtensionPairingStateQueryMessage: typeof PairingState.ExtensionPairingStateQueryMessage.is
  isExtensionSessionEnsureMessage: typeof SessionRuntimeMessages.isExtensionSessionEnsureMessage
  isExtensionSessionExpiryMessage: typeof SessionRuntimeMessages.isExtensionSessionExpiryMessage
  isExtensionSessionLockMessage: typeof SessionRuntimeMessages.isExtensionSessionLockMessage
  openCompanionLauncher: typeof SessionLifecycle.extensionSessionLifecycle.openCompanionLauncher
  openExtensionPairing: typeof PairingIdentity.extensionPairingIdentity.openExtensionPairing
  openSimpleVault: typeof SessionLifecycle.extensionSessionLifecycle.openSimpleVault
  releaseAccountPickerAuthorizationCleanup: typeof AccountPickers.releaseAccountPickerAuthorizationCleanup
  refreshAuthenticationSurfaces: typeof SessionLifecycle.extensionSessionLifecycle.refreshAuthenticationSurfaces
}

type MessageResponse = Parameters<ExtensionLifecycleRoutingArgs['sendResponse']>[0]

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
  clearPendingAccountPickers: typeof AccountPickers.accountPickerSessions.clearPendingAccountPickers
  clearStagedAuthenticatorEnrollments: typeof AuthenticatorOperations.authenticatorEnrollmentOperations.clearStagedAuthenticatorEnrollments
  closeExtensionSessionDocument: typeof SessionLifecycle.extensionSessionLifecycle.closeExtensionSessionDocument
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

export enum AuthorizationCleanupFailureKind {
  MarkerUnavailable = 'authorization-cleanup-marker-unavailable',
  PendingPickerRemovalFailed = 'authorization-cleanup-picker-removal-failed',
  Rejected = 'authorization-cleanup-rejected',
  MarkerLookupFailed = 'authorization-cleanup-marker-lookup-failed',
}

type AuthorizationCleanupFailure =
  AuthorizationCleanupFailureKind | ExtensionSessionTransportFailure
type AuthorizationCleanupResult = Result<
  void,
  readonly AuthorizationCleanupFailure[]
>

async function clearAuthorizationState({
  beginAccountPickerAuthorizationCleanup,
  clearPendingAccountPickers,
  clearStagedAuthenticatorEnrollments,
  closeExtensionSessionDocument,
  completeAccountPickerAuthorizationCleanup,
  releaseAccountPickerAuthorizationCleanup,
  closeSession,
  cleanupStart,
}: ClearAuthorizationStateArgs): Promise<AuthorizationCleanupResult> {
  const cleanupOperation =
    cleanupStart.kind === AuthorizationCleanupStartKind.Existing
      ? Promise.resolve(cleanupStart.cleanup)
      : beginAccountPickerAuthorizationCleanup()
  const closeOperation = closeSession
    ? closeExtensionSessionDocument()
    : Promise.resolve(ok(undefined))
  const startedCleanup = await cleanupOperation
  const { authorizationGeneration, markerStatus } = startedCleanup
  const failures: AuthorizationCleanupFailure[] = []
  if (markerStatus === AccountPickerCleanupMarkerStatus.Unavailable)
    failures.push(AuthorizationCleanupFailureKind.MarkerUnavailable)
  const closed = await closeOperation
  if (closed.isErr()) failures.push(closed.error)
  clearStagedAuthenticatorEnrollments()
  try {
    await clearPendingAccountPickers()
  } catch {
    failures.push(AuthorizationCleanupFailureKind.PendingPickerRemovalFailed)
  }
  try {
    await clearPendingAccountPickers()
  } catch {
    failures.push(AuthorizationCleanupFailureKind.PendingPickerRemovalFailed)
  }
  clearStagedAuthenticatorEnrollments()
  if (failures.length > 0) {
    releaseAccountPickerAuthorizationCleanup(authorizationGeneration)
    return err(failures)
  }
  const outcome = await completeAccountPickerAuthorizationCleanup(
    authorizationGeneration,
    CleanupEvidence.Full,
  )
  return 'error' in outcome
    ? err([AuthorizationCleanupFailureKind.Rejected])
    : ok(undefined)
}

export async function recoverInterruptedAuthorizationCleanup(
  dependencies: ExtensionLifecycleRoutingDependencies,
): Promise<AuthorizationCleanupResult> {
  const pendingLookup = dependencies.accountPickerAuthorizationCleanupPending().then(
    (pending) => ({ kind: 'resolved' as const, pending }),
    () => ({ kind: 'rejected' as const }),
  )
  const cleanup = await dependencies.beginAccountPickerAuthorizationCleanup()
  const lookup = await pendingLookup
  if (lookup.kind === 'rejected') {
    dependencies.releaseAccountPickerAuthorizationCleanup(
      cleanup.authorizationGeneration,
    )
    return err([AuthorizationCleanupFailureKind.MarkerLookupFailed])
  }
  if (!lookup.pending) {
    const outcome = await dependencies.completeAccountPickerAuthorizationCleanup(
      cleanup.authorizationGeneration,
      CleanupEvidence.Partial,
    )
    return 'error' in outcome
      ? err([AuthorizationCleanupFailureKind.Rejected])
      : ok(undefined)
  }
  const cleanupArgs: ClearAuthorizationStateArgs = {
    ...dependencies,
    closeSession: true,
    cleanupStart: {
      kind: AuthorizationCleanupStartKind.Existing,
      cleanup,
    },
  }
  return clearAuthorizationState(cleanupArgs)
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
    clearStagedAuthenticatorEnrollments,
    closeExtensionSessionDocument,
    completeAccountPickerAuthorizationCleanup,
    ensureExtensionSessionDocument,
    extensionSessionDocument,
    handlePairingStateQuery,
    hasPairingApprovedType,
    importLocalEventLogUpdate,
    importPairingAfterCompanionReady,
    isExtensionAuthenticationSurfacesRefreshMessage,
    isExtensionPairingStateQueryMessage,
    isExtensionSessionEnsureMessage,
    isExtensionSessionExpiryMessage,
    isExtensionSessionLockMessage,
    openCompanionLauncher,
    openExtensionPairing,
    openSimpleVault,
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
    void ensureExtensionSessionDocument().then((opened) =>
      sendResponse(opened.isOk() ? successResponse : sessionRuntimeFailureResponse),
    )
    return true
  }

  if (isExtensionAuthenticationSurfacesRefreshMessage(message)) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
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
    const cleanupArgs: ClearAuthorizationStateArgs = {
      beginAccountPickerAuthorizationCleanup,
      clearPendingAccountPickers,
      clearStagedAuthenticatorEnrollments,
      closeExtensionSessionDocument,
      completeAccountPickerAuthorizationCleanup,
      releaseAccountPickerAuthorizationCleanup,
      closeSession: true,
      cleanupStart: { kind: AuthorizationCleanupStartKind.Begin },
    }
    void clearAuthorizationState(cleanupArgs)
      .then((cleanup) =>
        sendResponse(cleanup.isOk() ? successResponse : sessionLockFailureResponse),
      )
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
    const cleanupArgs: ClearAuthorizationStateArgs = {
      beginAccountPickerAuthorizationCleanup,
      clearPendingAccountPickers,
      clearStagedAuthenticatorEnrollments,
      closeExtensionSessionDocument,
      completeAccountPickerAuthorizationCleanup,
      releaseAccountPickerAuthorizationCleanup,
      closeSession: true,
      cleanupStart: { kind: AuthorizationCleanupStartKind.Begin },
    }
    void clearAuthorizationState(cleanupArgs)
      .then((cleanup) =>
        sendResponse(cleanup.isOk() ? successResponse : sessionLockFailureResponse),
      )
      .catch(() => sendResponse(sessionLockFailureResponse))
    return true
  }

  if (hasPairingApprovedType(message)) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void importPairingAfterCompanionReady(message)
      .then(async (response) => {
        if (response.ok) await refreshAuthenticationSurfaces()
        return response
      })
      .then(sendResponse)
    return true
  }

  if (ExtensionLocalEventLogUpdatedMessageSchema.is(message)) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void isNokeySender(sender)
      .then(async (trusted) => {
        if (!trusted) {
          sendResponse(forbiddenSenderResponse)
          return
        }
        const importArgs: Parameters<typeof importLocalEventLogUpdate>[0] = {
          vaultStoreId: message.payload.vaultStoreId,
          eventLogRecords: message.payload.eventLogRecords,
        }
        void beginAccountPickerAuthorizationCleanup()
          .then(async (cleanupStart) => {
            const cleanupArgs: ClearAuthorizationStateArgs = {
              beginAccountPickerAuthorizationCleanup,
              clearPendingAccountPickers,
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
              const response = await importLocalEventLogUpdate(importArgs)
              if (
                !response.ok &&
                response.reason !== LocalEventLogUpdateFailure.VaultNotPaired
              ) {
                try {
                  const cleanup = await clearAuthorizationState(cleanupArgs)
                  if (cleanup.isErr())
                    return {
                      ok: false,
                      reason: LocalEventLogUpdateFailure.EventLogImportFailed,
                    }
                } catch {
                  // Authorization remains invalid while browser cleanup is retried.
                }
              } else {
                rebindStagedAuthenticatorEnrollmentsAuthorization(
                  cleanupStart.authorizationGeneration,
                )
                const outcome = await completeAccountPickerAuthorizationCleanup(
                  cleanupStart.authorizationGeneration,
                  CleanupEvidence.Partial,
                )
                // Preserve the import outcome without refreshing a rejected generation.
                if ('error' in outcome) return response
                if (response.ok) await refreshAuthenticationSurfaces()
              }
              return response
            } catch {
              try {
                const cleanup = await clearAuthorizationState(cleanupArgs)
                if (cleanup.isErr())
                  return {
                    ok: false,
                    reason: LocalEventLogUpdateFailure.EventLogImportFailed,
                  }
              } catch {
                // The persisted marker keeps authorization invalid if cleanup fails.
              }
              return {
                ok: false,
                reason: LocalEventLogUpdateFailure.EventLogImportFailed,
              }
            }
          })
          .then(sendResponse)
      })
      .catch(() => sendResponse(forbiddenSenderResponse))
    return true
  }

  if (OpenSimpleVaultMessageSchema.is(message)) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openSimpleVault()
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(launcherFailureResponse))
    return true
  }

  const launcherMessage =
    NormalizedOpenCompanionLauncherMessageSchema.normalizeOpenCompanionLauncherMessage(
      message,
    )
  if (launcherMessage.kind === OpenCompanionLauncherNormalizationKind.Normalized) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openCompanionLauncher(launcherMessage.message.intent)
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(launcherFailureResponse))
    return true
  }

  if (BeginExtensionPairingMessageSchema.is(message)) {
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
