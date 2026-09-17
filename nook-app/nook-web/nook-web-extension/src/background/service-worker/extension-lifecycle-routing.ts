import { err, ok, type Result } from 'neverthrow'
import type { ExtensionSessionTransportFailure } from './session-document'
import * as RuntimeMessages from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  NormalizedOpenCompanionLauncherMessage as NormalizedOpenCompanionLauncherMessageSchema,
} from '../../../../nook-web-shared/src/extension/companion-launcher-message'
import {
  ExternalSenderTrustPolicy,
  isExtensionRuntimeSender,
} from './routing-trust'
import type * as PairingState from '../../lib/pairing-state'
import type * as PairingIdentity from './pairing-identity'
import type * as PairingImport from './pairing-import'
import { LocalEventLogUpdateFailure } from './pairing-import'
import type * as PairingStateQuery from './pairing-state-query'
import type * as SessionLifecycle from './session-lifecycle'
import type * as SessionRuntimeMessages from './session-runtime-messages'
import type { ExtensionSessionRuntimeMessageValue } from './session-runtime-messages'
import type * as AccountPickers from './account-pickers'
import { AccountPickerCleanupMarkerStatus } from './account-pickers'
import type * as AuthenticatorOperations from './authenticator-operations'
import { CleanupEvidence } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../../lib/concrete-decoder'

type ChromeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]

type ExtensionLifecycleRoutingArgs = {
  dependencies: ExtensionLifecycleRoutingDependencies
  message: ExtensionSessionRuntimeMessageValue
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
  decodePairingApprovedMessage: typeof RuntimeMessages.ExtensionPairingApprovedMessage.decode
  importLocalEventLogUpdate: typeof PairingImport.importLocalEventLogUpdate
  importPairingAfterCompanionReady: typeof PairingImport.importPairingAfterCompanionReady
  decodeExtensionAuthenticationSurfacesRefreshMessage: typeof SessionRuntimeMessages.decodeExtensionAuthenticationSurfacesRefreshMessage
  decodeExtensionPairingStateQueryMessage: typeof PairingState.ExtensionPairingStateQueryMessage.decode
  decodeExtensionSessionEnsureMessage: typeof SessionRuntimeMessages.decodeExtensionSessionEnsureMessage
  decodeExtensionSessionExpiryMessage: typeof SessionRuntimeMessages.decodeExtensionSessionExpiryMessage
  decodeExtensionSessionLockMessage: typeof SessionRuntimeMessages.decodeExtensionSessionLockMessage
  decodeExtensionLocalEventLogUpdatedMessage: typeof RuntimeMessages.ExtensionLocalEventLogUpdatedMessage.decode
  decodeOpenSimpleVaultMessage: typeof RuntimeMessages.OpenSimpleVaultMessage.decode
  decodeBeginExtensionPairingMessage: typeof RuntimeMessages.BeginExtensionPairingMessage.decode
  decodeOpenCompanionLauncherMessage: typeof NormalizedOpenCompanionLauncherMessageSchema.decode
  openCompanionLauncher: typeof SessionLifecycle.extensionSessionLifecycle.openCompanionLauncher
  openExtensionPairing: typeof PairingIdentity.extensionPairingIdentity.openExtensionPairing
  openSimpleVault: typeof SessionLifecycle.extensionSessionLifecycle.openSimpleVault
  releaseAccountPickerAuthorizationCleanup: typeof AccountPickers.releaseAccountPickerAuthorizationCleanup
  refreshAuthenticationSurfaces: typeof SessionLifecycle.extensionSessionLifecycle.refreshAuthenticationSurfaces
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

class AuthorizationCleanupLifecycle {
  constructor(private readonly request: ClearAuthorizationStateArgs) {}

  async clear(): Promise<AuthorizationCleanupResult> {
    const {
      beginAccountPickerAuthorizationCleanup,
      clearPendingAccountPickers,
      clearStagedAuthenticatorEnrollments,
      closeExtensionSessionDocument,
      completeAccountPickerAuthorizationCleanup,
      releaseAccountPickerAuthorizationCleanup,
      closeSession,
      cleanupStart,
    } = this.request
    const cleanupOperation =
      cleanupStart.kind === AuthorizationCleanupStartKind.Existing
        ? Promise.resolve(cleanupStart.cleanup)
        : beginAccountPickerAuthorizationCleanup()
    const closeOperation = closeSession
      ? closeExtensionSessionDocument()
      : Promise.resolve(ok())
    let startedCleanup: AccountPickers.AccountPickerAuthorizationCleanupStart
    try {
      startedCleanup = await cleanupOperation
    } catch {
      return err([AuthorizationCleanupFailureKind.Rejected])
    }
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
    let outcome: Awaited<
      ReturnType<typeof completeAccountPickerAuthorizationCleanup>
    >
    try {
      outcome = await completeAccountPickerAuthorizationCleanup(
        authorizationGeneration,
        CleanupEvidence.Full,
      )
    } catch {
      releaseAccountPickerAuthorizationCleanup(authorizationGeneration)
      return err([AuthorizationCleanupFailureKind.Rejected])
    }
    return 'error' in outcome
      ? err([AuthorizationCleanupFailureKind.Rejected])
      : ok()
  }
}

export async function recoverInterruptedAuthorizationCleanup(
  dependencies: ExtensionLifecycleRoutingDependencies,
): Promise<AuthorizationCleanupResult> {
  const pendingLookup = dependencies
    .accountPickerAuthorizationCleanupPending()
    .then(
      (pending) => ({ kind: 'resolved' as const, pending }),
      () => ({ kind: 'rejected' as const }),
    )
  let cleanup: AccountPickers.AccountPickerAuthorizationCleanupStart
  try {
    cleanup = await dependencies.beginAccountPickerAuthorizationCleanup()
  } catch {
    return err([AuthorizationCleanupFailureKind.Rejected])
  }
  const lookup = await pendingLookup
  if (lookup.kind === 'rejected') {
    dependencies.releaseAccountPickerAuthorizationCleanup(
      cleanup.authorizationGeneration,
    )
    return err([AuthorizationCleanupFailureKind.MarkerLookupFailed])
  }
  if (!lookup.pending) {
    const outcome =
      await dependencies.completeAccountPickerAuthorizationCleanup(
        cleanup.authorizationGeneration,
        CleanupEvidence.Partial,
      )
    return 'error' in outcome
      ? err([AuthorizationCleanupFailureKind.Rejected])
      : ok()
  }
  const cleanupArgs: ClearAuthorizationStateArgs = {
    ...dependencies,
    closeSession: true,
    cleanupStart: {
      kind: AuthorizationCleanupStartKind.Existing,
      cleanup,
    },
  }
  return new AuthorizationCleanupLifecycle(cleanupArgs).clear()
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
    decodePairingApprovedMessage,
    importLocalEventLogUpdate,
    importPairingAfterCompanionReady,
    decodeExtensionAuthenticationSurfacesRefreshMessage,
    decodeExtensionPairingStateQueryMessage,
    decodeExtensionSessionEnsureMessage,
    decodeExtensionSessionExpiryMessage,
    decodeExtensionSessionLockMessage,
    decodeExtensionLocalEventLogUpdatedMessage,
    decodeOpenSimpleVaultMessage,
    decodeBeginExtensionPairingMessage,
    decodeOpenCompanionLauncherMessage,
    openCompanionLauncher,
    openExtensionPairing,
    openSimpleVault,
    releaseAccountPickerAuthorizationCleanup,
    rebindStagedAuthenticatorEnrollmentsAuthorization,
    refreshAuthenticationSurfaces,
  } = dependencies
  const pairingStateQuery = runConcreteDecoder(
    decodeExtensionPairingStateQueryMessage,
    message,
  )
  if (pairingStateQuery.kind === ConcreteDecoderResultKind.Decoded) {
    const queryContext: Parameters<typeof handlePairingStateQuery>[0] = {
      sender,
      sendResponse,
    }
    return handlePairingStateQuery(queryContext)
  }

  const sessionEnsure = runConcreteDecoder(decodeExtensionSessionEnsureMessage, message)
  if (sessionEnsure.kind === ConcreteDecoderResultKind.Decoded) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void ensureExtensionSessionDocument().then((opened) =>
      sendResponse(
        opened.isOk() ? successResponse : sessionRuntimeFailureResponse,
      ),
    )
    return true
  }

  const refreshAuthenticationSurfacesMessage = runConcreteDecoder(
    decodeExtensionAuthenticationSurfacesRefreshMessage,
    message,
  )
  if (
    refreshAuthenticationSurfacesMessage.kind ===
    ConcreteDecoderResultKind.Decoded
  ) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void refreshAuthenticationSurfaces()
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(sessionRuntimeFailureResponse))
    return true
  }

  const sessionLock = runConcreteDecoder(decodeExtensionSessionLockMessage, message)
  if (sessionLock.kind === ConcreteDecoderResultKind.Decoded) {
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
    void new AuthorizationCleanupLifecycle(cleanupArgs)
      .clear()
      .then((cleanup) =>
        sendResponse(
          cleanup.isOk() ? successResponse : sessionLockFailureResponse,
        ),
      )
      .catch(() => sendResponse(sessionLockFailureResponse))
    return true
  }

  const sessionExpiry = runConcreteDecoder(decodeExtensionSessionExpiryMessage, message)
  if (sessionExpiry.kind === ConcreteDecoderResultKind.Decoded) {
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
    void new AuthorizationCleanupLifecycle(cleanupArgs)
      .clear()
      .then((cleanup) =>
        sendResponse(
          cleanup.isOk() ? successResponse : sessionLockFailureResponse,
        ),
      )
      .catch(() => sendResponse(sessionLockFailureResponse))
    return true
  }

  const pairingApproval = runConcreteDecoder(decodePairingApprovedMessage, message)
  if (pairingApproval.kind === ConcreteDecoderResultKind.Decoded) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void importPairingAfterCompanionReady(pairingApproval.value)
      .then(async (response) => {
        if (response.ok) await refreshAuthenticationSurfaces()
        return response
      })
      .then(sendResponse)
    return true
  }

  const localEventLogUpdate = runConcreteDecoder(
    decodeExtensionLocalEventLogUpdatedMessage,
    message,
  )
  if (localEventLogUpdate.kind === ConcreteDecoderResultKind.Decoded) {
    const decodedMessage = localEventLogUpdate.value
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void ExternalSenderTrustPolicy.admits(sender)
      .then(async (trusted) => {
        if (!trusted) {
          sendResponse(forbiddenSenderResponse)
          return
        }
        const importArgs: Parameters<typeof importLocalEventLogUpdate>[0] = {
          vaultStoreId: decodedMessage.payload.vaultStoreId,
          eventLogRecords: decodedMessage.payload.eventLogRecords,
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
                  const cleanup = await new AuthorizationCleanupLifecycle(
                    cleanupArgs,
                  ).clear()
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
                const cleanup = await new AuthorizationCleanupLifecycle(
                  cleanupArgs,
                ).clear()
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

  const openSimpleVault = runConcreteDecoder(decodeOpenSimpleVaultMessage, message)
  if (openSimpleVault.kind === ConcreteDecoderResultKind.Decoded) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openSimpleVault()
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(launcherFailureResponse))
    return true
  }

  const launcherMessage = runConcreteDecoder(
    decodeOpenCompanionLauncherMessage,
    message,
  )
  if (launcherMessage.kind === ConcreteDecoderResultKind.Decoded) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openCompanionLauncher(launcherMessage.value.intent)
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(launcherFailureResponse))
    return true
  }

  const beginExtensionPairing = runConcreteDecoder(
    decodeBeginExtensionPairingMessage,
    message,
  )
  if (beginExtensionPairing.kind === ConcreteDecoderResultKind.Decoded) {
    if (!isExtensionRuntimeSender(sender)) {
      sendResponse(forbiddenSenderResponse)
      return false
    }
    void openExtensionPairing(beginExtensionPairing.value.payload)
      .then(() => sendResponse(successResponse))
      .catch(() => sendResponse(pairingLaunchFailureResponse))
    return true
  }

  return ExtensionLifecycleRoutingResult.Unhandled
}
