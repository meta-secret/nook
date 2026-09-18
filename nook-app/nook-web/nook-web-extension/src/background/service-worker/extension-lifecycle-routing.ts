import { Effect, Either } from 'effect'
import type { ExtensionSessionTransportFailure } from './session-document'
import * as RuntimeMessages from '../../../../nook-web-shared/src/extension/runtime-messages'
import { NormalizedOpenCompanionLauncherMessage as NormalizedOpenCompanionLauncherMessageSchema } from '../../../../nook-web-shared/src/extension/companion-launcher-message'
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

export type InterruptedAuthorizationCleanupRecoveryDependencies = Pick<
  ExtensionLifecycleRoutingDependencies,
  | 'accountPickerAuthorizationCleanupPending'
  | 'beginAccountPickerAuthorizationCleanup'
  | 'clearPendingAccountPickers'
  | 'clearStagedAuthenticatorEnrollments'
  | 'closeExtensionSessionDocument'
  | 'completeAccountPickerAuthorizationCleanup'
  | 'releaseAccountPickerAuthorizationCleanup'
>

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
  sessionDisposition: AuthorizationCleanupSessionDisposition
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

enum AuthorizationCleanupSessionDisposition {
  Close = 'close-session',
  Preserve = 'preserve-session',
}

export enum AuthorizationCleanupFailureKind {
  MarkerUnavailable = 'authorization-cleanup-marker-unavailable',
  PendingPickerRemovalFailed = 'authorization-cleanup-picker-removal-failed',
  Rejected = 'authorization-cleanup-rejected',
  MarkerLookupFailed = 'authorization-cleanup-marker-lookup-failed',
}

type AuthorizationCleanupFailure =
  AuthorizationCleanupFailureKind | ExtensionSessionTransportFailure

export enum AuthorizationCleanupSuccessKind {
  Cleared = 'authorization-cleanup-cleared',
}

export type AuthorizationCleanupSuccess = {
  kind: AuthorizationCleanupSuccessKind.Cleared
  authorizationGeneration: AccountPickers.AccountPickerAuthorizationCleanupStart['authorizationGeneration']
}

type AuthorizationCleanupEffect = Effect.Effect<
  AuthorizationCleanupSuccess,
  readonly AuthorizationCleanupFailure[]
>

enum AuthorizationCleanupCloseKind {
  Skipped = 'skipped',
  Closed = 'closed',
}

type AuthorizationCleanupClose =
  | { kind: AuthorizationCleanupCloseKind.Skipped }
  | { kind: AuthorizationCleanupCloseKind.Closed }

class AuthorizationCleanupLifecycle {
  constructor(private readonly request: ClearAuthorizationStateArgs) {}

  clear(): AuthorizationCleanupEffect {
    const {
      beginAccountPickerAuthorizationCleanup,
      clearPendingAccountPickers,
      clearStagedAuthenticatorEnrollments,
      closeExtensionSessionDocument,
      completeAccountPickerAuthorizationCleanup,
      releaseAccountPickerAuthorizationCleanup,
      sessionDisposition,
      cleanupStart,
    } = this.request
    return Effect.gen(function* () {
      type ModuleTryPromiseRequest = {
        readonly try: (
          signal: AbortSignal,
        ) => PromiseLike<AccountPickers.AccountPickerAuthorizationCleanupStart>
        readonly catch: (error: unknown) => AuthorizationCleanupFailureKind
      }
      const moduleTryPromiseRequest: ModuleTryPromiseRequest = {
        try: () => beginAccountPickerAuthorizationCleanup(),
        catch: () => AuthorizationCleanupFailureKind.Rejected,
      }
      const cleanupOperation =
        cleanupStart.kind === AuthorizationCleanupStartKind.Existing
          ? Effect.succeed(cleanupStart.cleanup)
          : Effect.tryPromise(moduleTryPromiseRequest)
      type CloseOperationSucceedRequest = {
        kind: AuthorizationCleanupCloseKind.Closed
      }
      const closeOperationSucceedRequest: CloseOperationSucceedRequest = {
        kind: AuthorizationCleanupCloseKind.Closed,
      }
      type ModuleTryPromiseRequest2 = {
        readonly try: (
          signal: AbortSignal,
        ) => ReturnType<typeof closeExtensionSessionDocument>
        readonly catch: (error: unknown) => AuthorizationCleanupFailureKind
      }
      const moduleTryPromiseRequest2: ModuleTryPromiseRequest2 = {
        try: () => closeExtensionSessionDocument(),
        catch: () => AuthorizationCleanupFailureKind.Rejected,
      }
      type ModuleSucceedRequest = {
        kind: AuthorizationCleanupCloseKind.Skipped
      }
      const moduleSucceedRequest: ModuleSucceedRequest = {
        kind: AuthorizationCleanupCloseKind.Skipped,
      }
      const closeOperation: Effect.Effect<
        AuthorizationCleanupClose,
        AuthorizationCleanupFailure
      > =
        sessionDisposition === AuthorizationCleanupSessionDisposition.Close
          ? Effect.tryPromise(moduleTryPromiseRequest2).pipe(
              Effect.flatMap((closed) =>
                closed.isErr()
                  ? Effect.fail(closed.error)
                  : Effect.succeed(closeOperationSucceedRequest),
              ),
            )
          : Effect.succeed(moduleSucceedRequest)
      type ModuleAllRequest = { concurrency: 'unbounded' }
      const moduleAllRequest: ModuleAllRequest = { concurrency: 'unbounded' }
      const [cleanupResult, closeResult] = yield* Effect.all(
        [Effect.either(cleanupOperation), Effect.either(closeOperation)],
        moduleAllRequest,
      )
      if (Either.isLeft(cleanupResult)) {
        return yield* Effect.fail([cleanupResult.left])
      }
      const { authorizationGeneration, markerStatus } = cleanupResult.right
      const failures: AuthorizationCleanupFailure[] = []
      if (markerStatus === AccountPickerCleanupMarkerStatus.Unavailable) {
        failures.push(AuthorizationCleanupFailureKind.MarkerUnavailable)
      }
      if (Either.isLeft(closeResult)) failures.push(closeResult.left)
      type ModuleTryRequest = {
        readonly try: () => void
        readonly catch: (error: unknown) => AuthorizationCleanupFailureKind
      }
      const moduleTryRequest: ModuleTryRequest = {
        try: () => clearStagedAuthenticatorEnrollments(),
        catch: () => AuthorizationCleanupFailureKind.Rejected,
      }
      const firstStagedCleanup = yield* Effect.either(
        Effect.try(moduleTryRequest),
      )
      if (Either.isLeft(firstStagedCleanup))
        failures.push(firstStagedCleanup.left)
      type ModuleTryPromiseRequest3 = {
        readonly try: (signal: AbortSignal) => PromiseLike<void>
        readonly catch: (error: unknown) => AuthorizationCleanupFailureKind
      }
      const moduleTryPromiseRequest3: ModuleTryPromiseRequest3 = {
        try: () => clearPendingAccountPickers(),
        catch: () => AuthorizationCleanupFailureKind.PendingPickerRemovalFailed,
      }
      const firstPickerCleanup = yield* Effect.either(
        Effect.tryPromise(moduleTryPromiseRequest3),
      )
      if (Either.isLeft(firstPickerCleanup))
        failures.push(firstPickerCleanup.left)
      type ModuleTryPromiseRequest4 = {
        readonly try: (signal: AbortSignal) => PromiseLike<void>
        readonly catch: (error: unknown) => AuthorizationCleanupFailureKind
      }
      const moduleTryPromiseRequest4: ModuleTryPromiseRequest4 = {
        try: () => clearPendingAccountPickers(),
        catch: () => AuthorizationCleanupFailureKind.PendingPickerRemovalFailed,
      }
      const secondPickerCleanup = yield* Effect.either(
        Effect.tryPromise(moduleTryPromiseRequest4),
      )
      if (Either.isLeft(secondPickerCleanup))
        failures.push(secondPickerCleanup.left)
      type ModuleTryRequest2 = {
        readonly try: () => void
        readonly catch: (error: unknown) => AuthorizationCleanupFailureKind
      }
      const moduleTryRequest2: ModuleTryRequest2 = {
        try: () => clearStagedAuthenticatorEnrollments(),
        catch: () => AuthorizationCleanupFailureKind.Rejected,
      }
      const secondStagedCleanup = yield* Effect.either(
        Effect.try(moduleTryRequest2),
      )
      if (Either.isLeft(secondStagedCleanup))
        failures.push(secondStagedCleanup.left)
      if (failures.length > 0) {
        releaseAccountPickerAuthorizationCleanup(authorizationGeneration)
        return yield* Effect.fail(failures)
      }
      type ModuleTryPromiseRequest5 = {
        readonly try: (
          signal: AbortSignal,
        ) => ReturnType<typeof completeAccountPickerAuthorizationCleanup>
        readonly catch: (error: unknown) => AuthorizationCleanupFailureKind
      }
      const completionRequest: Parameters<
        typeof completeAccountPickerAuthorizationCleanup
      >[0] = {
        authorizationGeneration,
        evidence: CleanupEvidence.Full,
      }
      const moduleTryPromiseRequest5: ModuleTryPromiseRequest5 = {
        try: () => completeAccountPickerAuthorizationCleanup(completionRequest),
        catch: () => AuthorizationCleanupFailureKind.Rejected,
      }
      const completion = yield* Effect.either(
        Effect.tryPromise(moduleTryPromiseRequest5),
      )
      if (Either.isLeft(completion)) {
        releaseAccountPickerAuthorizationCleanup(authorizationGeneration)
        return yield* Effect.fail([completion.left])
      }
      const outcome = completion.right
      if ('error' in outcome) {
        return yield* Effect.fail([AuthorizationCleanupFailureKind.Rejected])
      }
      return {
        kind: AuthorizationCleanupSuccessKind.Cleared,
        authorizationGeneration,
      }
    })
  }
}

export function recoverInterruptedAuthorizationCleanup(
  dependencies: InterruptedAuthorizationCleanupRecoveryDependencies,
): AuthorizationCleanupEffect {
  return Effect.gen(function* () {
    type ModuleTryPromiseRequest6 = {
      readonly try: (signal: AbortSignal) => PromiseLike<boolean>
      readonly catch: (error: unknown) => AuthorizationCleanupFailureKind
    }
    const moduleTryPromiseRequest6: ModuleTryPromiseRequest6 = {
      try: () => dependencies.accountPickerAuthorizationCleanupPending(),
      catch: () => AuthorizationCleanupFailureKind.MarkerLookupFailed,
    }
    const pendingLookup = Effect.tryPromise(moduleTryPromiseRequest6)
    type ModuleTryPromiseRequest7 = {
      readonly try: (
        signal: AbortSignal,
      ) => PromiseLike<AccountPickers.AccountPickerAuthorizationCleanupStart>
      readonly catch: (error: unknown) => AuthorizationCleanupFailureKind
    }
    const moduleTryPromiseRequest7: ModuleTryPromiseRequest7 = {
      try: () => dependencies.beginAccountPickerAuthorizationCleanup(),
      catch: () => AuthorizationCleanupFailureKind.Rejected,
    }
    const cleanupStart = Effect.tryPromise(moduleTryPromiseRequest7)
    type ModuleAllRequest2 = { concurrency: 'unbounded' }
    const moduleAllRequest2: ModuleAllRequest2 = { concurrency: 'unbounded' }
    const [lookupResult, cleanupResult] = yield* Effect.all(
      [Effect.either(pendingLookup), Effect.either(cleanupStart)],
      moduleAllRequest2,
    )
    if (Either.isLeft(cleanupResult)) {
      return yield* Effect.fail([cleanupResult.left])
    }
    const cleanup = cleanupResult.right
    if (Either.isLeft(lookupResult)) {
      dependencies.releaseAccountPickerAuthorizationCleanup(
        cleanup.authorizationGeneration,
      )
      return yield* Effect.fail([lookupResult.left])
    }
    if (!lookupResult.right) {
      const completionRequest: Parameters<
        typeof dependencies.completeAccountPickerAuthorizationCleanup
      >[0] = {
        authorizationGeneration: cleanup.authorizationGeneration,
        evidence: CleanupEvidence.Partial,
      }
      type ModuleTryPromiseRequest8 = {
        readonly try: (
          signal: AbortSignal,
        ) => ReturnType<
          typeof dependencies.completeAccountPickerAuthorizationCleanup
        >
        readonly catch: (
          error: unknown,
        ) => readonly AuthorizationCleanupFailure[]
      }
      const moduleTryPromiseRequest8: ModuleTryPromiseRequest8 = {
        try: () =>
          dependencies.completeAccountPickerAuthorizationCleanup(
            completionRequest,
          ),
        catch: (): readonly AuthorizationCleanupFailure[] => [
          AuthorizationCleanupFailureKind.Rejected,
        ],
      }
      const outcome = yield* Effect.tryPromise(moduleTryPromiseRequest8)
      if ('error' in outcome) {
        return yield* Effect.fail([AuthorizationCleanupFailureKind.Rejected])
      }
      return {
        kind: AuthorizationCleanupSuccessKind.Cleared,
        authorizationGeneration: cleanup.authorizationGeneration,
      }
    }
    const cleanupArgs: ClearAuthorizationStateArgs = {
      ...dependencies,
      sessionDisposition: AuthorizationCleanupSessionDisposition.Close,
      cleanupStart: {
        kind: AuthorizationCleanupStartKind.Existing,
        cleanup,
      },
    }
    return yield* new AuthorizationCleanupLifecycle(cleanupArgs).clear()
  })
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

  const sessionEnsure = runConcreteDecoder(
    decodeExtensionSessionEnsureMessage,
    message,
  )
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

  const sessionLock = runConcreteDecoder(
    decodeExtensionSessionLockMessage,
    message,
  )
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
      sessionDisposition: AuthorizationCleanupSessionDisposition.Close,
      cleanupStart: { kind: AuthorizationCleanupStartKind.Begin },
    }
    void Effect.runPromise(
      Effect.either(new AuthorizationCleanupLifecycle(cleanupArgs).clear()),
    )
      .then((cleanup) =>
        sendResponse(
          Either.isRight(cleanup)
            ? successResponse
            : sessionLockFailureResponse,
        ),
      )
      .catch(() => sendResponse(sessionLockFailureResponse))
    return true
  }

  const sessionExpiry = runConcreteDecoder(
    decodeExtensionSessionExpiryMessage,
    message,
  )
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
      sessionDisposition: AuthorizationCleanupSessionDisposition.Close,
      cleanupStart: { kind: AuthorizationCleanupStartKind.Begin },
    }
    void Effect.runPromise(
      Effect.either(new AuthorizationCleanupLifecycle(cleanupArgs).clear()),
    )
      .then((cleanup) =>
        sendResponse(
          Either.isRight(cleanup)
            ? successResponse
            : sessionLockFailureResponse,
        ),
      )
      .catch(() => sendResponse(sessionLockFailureResponse))
    return true
  }

  const pairingApproval = runConcreteDecoder(
    decodePairingApprovedMessage,
    message,
  )
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
              sessionDisposition: AuthorizationCleanupSessionDisposition.Close,
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
                  const cleanup = await Effect.runPromise(
                    Effect.either(
                      new AuthorizationCleanupLifecycle(cleanupArgs).clear(),
                    ),
                  )
                  if (Either.isLeft(cleanup))
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
                const completionRequest: Parameters<
                  typeof completeAccountPickerAuthorizationCleanup
                >[0] = {
                  authorizationGeneration: cleanupStart.authorizationGeneration,
                  evidence: CleanupEvidence.Partial,
                }
                const outcome =
                  await completeAccountPickerAuthorizationCleanup(
                    completionRequest,
                  )
                // Preserve the import outcome without refreshing a rejected generation.
                if ('error' in outcome) return response
                if (response.ok) await refreshAuthenticationSurfaces()
              }
              return response
            } catch {
              try {
                const cleanup = await Effect.runPromise(
                  Effect.either(
                    new AuthorizationCleanupLifecycle(cleanupArgs).clear(),
                  ),
                )
                if (Either.isLeft(cleanup))
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

  const openSimpleVaultMessage = runConcreteDecoder(
    decodeOpenSimpleVaultMessage,
    message,
  )
  if (openSimpleVaultMessage.kind === ConcreteDecoderResultKind.Decoded) {
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
