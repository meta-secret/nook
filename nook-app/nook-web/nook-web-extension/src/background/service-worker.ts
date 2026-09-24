/* eslint-disable nook-typed-api/no-raw-object-arguments, @typescript-eslint/no-unsafe-type-assertion -- Chrome runtime messages are narrowed at this external transport boundary. */
import {
  GeneratePasswordRequestType,
  ExtensionIdentityHandoffRequestMessage as ExtensionIdentityHandoffRequestMessageSchema,
  ExtensionPairingApprovedMessage as ExtensionPairingApprovedMessageSchema,
  ExtensionPairedVaultIdentityDiscoveryMessage as ExtensionPairedVaultIdentityDiscoveryMessageSchema,
  ExtensionPairedVaultIdentityHandoffRequestMessage as ExtensionPairedVaultIdentityHandoffRequestMessageSchema,
  ExtensionPairedVaultUnlockRequestMessage as ExtensionPairedVaultUnlockRequestMessageSchema,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import { NormalizedOpenCompanionLauncherMessage as NormalizedOpenCompanionLauncherMessageSchema } from '../../../nook-web-shared/src/extension/companion-launcher-message'
import {
  BeginExtensionPairingMessage as BeginExtensionPairingMessageSchema,
  ExtensionLocalEventLogUpdatedMessage as ExtensionLocalEventLogUpdatedMessageSchema,
  OpenSimpleVaultMessage as OpenSimpleVaultMessageSchema,
} from '../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
  type BrowserRuntimeMessageValue,
} from '../lib/browser-runtime-message'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../lib/concrete-decoder'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import { OpenCompanionLauncherIntent } from '../../../nook-web-shared/src/extension/companion-launcher-message'
import {
  AuthenticationWorkflowSnapshotIngress,
  AuthenticationWorkflowSnapshotMessageType,
} from '../lib/auth-workflow-messages'
import {
  AuthenticatorPickerCancelMessage as AuthenticatorPickerCancelMessageSchema,
  AuthenticatorPickerQueryMessage as AuthenticatorPickerQueryMessageSchema,
  AuthenticatorPickerSelectMessage as AuthenticatorPickerSelectMessageSchema,
  WebsiteAuthenticatorPickerOpenMessage as WebsiteAuthenticatorPickerOpenMessageSchema,
} from '../lib/authenticator-picker-messages'
import {
  WebsiteAuthenticatorBackupAttachMessage as WebsiteAuthenticatorBackupAttachMessageSchema,
  WebsiteAuthenticatorEnrollCodeMessage as WebsiteAuthenticatorEnrollCodeMessageSchema,
  WebsiteAuthenticatorEnrollConfirmMessage as WebsiteAuthenticatorEnrollConfirmMessageSchema,
  WebsiteAuthenticatorEnrollDismissMessage as WebsiteAuthenticatorEnrollDismissMessageSchema,
  WebsiteAuthenticatorEnrollPendingMessage as WebsiteAuthenticatorEnrollPendingMessageSchema,
  WebsiteAuthenticatorEnrollPreviewMessage as WebsiteAuthenticatorEnrollPreviewMessageSchema,
  WebsiteAuthenticatorEnrollStageMessage as WebsiteAuthenticatorEnrollStageMessageSchema,
} from '../lib/enrollment-messages'
import {
  WebsiteAuthenticatorFillMessage as WebsiteAuthenticatorFillMessageSchema,
  WebsiteAuthenticatorOptionsMessage as WebsiteAuthenticatorOptionsMessageSchema,
  WebsiteLoginOptionsMessage as WebsiteLoginOptionsMessageSchema,
  WebsiteLoginRevealMessage as WebsiteLoginRevealMessageSchema,
} from '../lib/login-fill-messages'
import {
  LoginPickerCancelMessage as LoginPickerCancelMessageSchema,
  LoginPickerQueryMessage as LoginPickerQueryMessageSchema,
  LoginPickerSelectMessage as LoginPickerSelectMessageSchema,
  WebsiteLoginPickerOpenMessage as WebsiteLoginPickerOpenMessageSchema,
} from '../lib/login-picker-messages'
import {
  WebsiteLoginSaveCommitMessage as WebsiteLoginSaveCommitMessageSchema,
  WebsiteLoginSaveDismissMessage as WebsiteLoginSaveDismissMessageSchema,
  WebsiteLoginSaveOfferMessage as WebsiteLoginSaveOfferMessageSchema,
  WebsiteLoginSavePendingMessage as WebsiteLoginSavePendingMessageSchema,
} from '../lib/login-save-messages'
import { AuthenticationOutcomeClassifyMessage as AuthenticationOutcomeClassifyMessageSchema } from '../lib/outcome-evidence-messages'
import {
  WebsitePasskeyCancelMessage as WebsitePasskeyCancelMessageSchema,
  WebsitePasskeyOptionsMessage as WebsitePasskeyOptionsMessageSchema,
  WebsitePasskeyPerformMessage as WebsitePasskeyPerformMessageSchema,
} from '../lib/webauthn-messages'
import {
  accountPickerAuthorizationCleanupPending,
  beginAccountPickerAuthorizationCleanup,
  completeAccountPickerAuthorizationCleanup,
  releaseAccountPickerAuthorizationCleanup,
  accountPickerSessions,
} from './service-worker/account-pickers'
import { authenticatorEnrollmentOperations } from './service-worker/authenticator-operations'
import {
  cancelLoginPicker,
  openWebsiteLoginPicker,
  queryLoginPicker,
  selectLoginPicker,
  websiteLoginFill,
  websiteLoginSaveCommit,
  websiteLoginSaveDismiss,
  websiteLoginSaveOffer,
  websiteLoginSavePending,
} from './service-worker/login-operations'
import { extensionPairingIdentity } from './service-worker/pairing-identity'
import {
  importLocalEventLogUpdate,
  importPairingAfterCompanionReady,
} from './service-worker/pairing-import'
import { handlePairingStateQuery } from './service-worker/pairing-state-query'
import { ExtensionPairingStateQueryMessage as ExtensionPairingStateQueryMessageSchema } from '../lib/pairing-state'
import { websitePasskeyRequests } from './service-worker/passkey-operations'
import {
  ExtensionLifecycleRoutingResult,
  recoverInterruptedAuthorizationCleanup,
  routeExtensionLifecycleMessage,
} from './service-worker/extension-lifecycle-routing'
import {
  ExternalCompanionRouter,
  type ExternalCompanionMessage,
  type ExternalCompanionRoutingRequest,
} from './service-worker/external-companion-routing'
import {
  authenticationPasskeyEvidenceIsSafe,
  authenticationWorkflowMessageResponse,
  authenticationWorkflowPilotPresentationCapability,
  authenticationWorkflowRequiresLoginMatchAvailability,
  authenticationWorkflowSavedLoginCapability,
} from './service-worker/authentication-workflow-routing'
import {
  extensionSessionDocument,
  extensionSessionLifecycle,
} from './service-worker/session-lifecycle'
import {
  decodeExtensionAuthenticationSurfacesRefreshMessage,
  decodeExtensionSessionEnsureMessage,
  decodeExtensionSessionExpiryMessage,
  decodeExtensionSessionLockMessage,
} from './service-worker/session-runtime-messages'
import {
  OrderedBackgroundRuntimeMessageRouter,
  RuntimeMessageResponseChannel,
  RuntimeMessageRouteKind,
  SchemaRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoutingRequest as AdmittedRuntimeMessageRoutingRequest,
  type BackgroundRuntimeMessageRoutes,
} from './service-worker/schema-runtime-message-route'
import { backgroundVaultRuntime } from './vault-runtime'
import { Effect, Either } from 'effect'
import {
  isCompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
  type CompanionWasmSessionMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'

const extensionLifecycleRoutingDependencies: Parameters<
  typeof routeExtensionLifecycleMessage
>[0]['dependencies'] = {
  accountPickerAuthorizationCleanupPending,
  beginAccountPickerAuthorizationCleanup,
  clearPendingAccountPickers:
    accountPickerSessions.clearPendingAccountPickers.bind(
      accountPickerSessions,
    ),
  clearStagedAuthenticatorEnrollments:
    authenticatorEnrollmentOperations.clearStagedAuthenticatorEnrollments.bind(
      authenticatorEnrollmentOperations,
    ),
  rebindStagedAuthenticatorEnrollmentsAuthorization:
    authenticatorEnrollmentOperations.rebindStagedAuthenticatorEnrollmentsAuthorization.bind(
      authenticatorEnrollmentOperations,
    ),
  closeExtensionSessionDocument:
    extensionSessionLifecycle.closeExtensionSessionDocument.bind(
      extensionSessionLifecycle,
    ),
  completeAccountPickerAuthorizationCleanup,
  ensureExtensionSessionDocument:
    extensionSessionLifecycle.ensureExtensionSessionDocument.bind(
      extensionSessionLifecycle,
    ),
  extensionSessionDocument,
  handlePairingStateQuery,
  decodePairingApprovedMessage: ExtensionPairingApprovedMessageSchema.decode,
  importLocalEventLogUpdate,
  importPairingAfterCompanionReady,
  decodeExtensionAuthenticationSurfacesRefreshMessage,
  decodeExtensionPairingStateQueryMessage:
    ExtensionPairingStateQueryMessageSchema.decode,
  decodeExtensionSessionEnsureMessage,
  decodeExtensionSessionExpiryMessage,
  decodeExtensionSessionLockMessage,
  decodeExtensionLocalEventLogUpdatedMessage:
    ExtensionLocalEventLogUpdatedMessageSchema.decode,
  decodeOpenSimpleVaultMessage: OpenSimpleVaultMessageSchema.decode,
  decodeBeginExtensionPairingMessage: BeginExtensionPairingMessageSchema.decode,
  decodeOpenCompanionLauncherMessage:
    NormalizedOpenCompanionLauncherMessageSchema.decode,
  openCompanionLauncher: extensionSessionLifecycle.openCompanionLauncher.bind(
    extensionSessionLifecycle,
  ),
  openExtensionPairing: extensionPairingIdentity.openExtensionPairing.bind(
    extensionPairingIdentity,
  ),
  openSimpleVault: extensionSessionLifecycle.openSimpleVault.bind(
    extensionSessionLifecycle,
  ),
  releaseAccountPickerAuthorizationCleanup,
  refreshAuthenticationSurfaces:
    extensionSessionLifecycle.refreshAuthenticationSurfaces.bind(
      extensionSessionLifecycle,
    ),
}

void Effect.runPromise(
  Effect.either(
    recoverInterruptedAuthorizationCleanup(
      extensionLifecycleRoutingDependencies,
    ),
  ),
).then((cleanup) => {
  if (Either.isLeft(cleanup))
    console.warn(
      'Extension authorization cleanup remains pending',
      cleanup.left,
    )
})

const externalCompanionRoutingDependencies: ExternalCompanionRoutingRequest['dependencies'] =
  {
    createIdentityHandoff: extensionPairingIdentity.createIdentityHandoff.bind(
      extensionPairingIdentity,
    ),
    createPairedIdentityHandoff:
      extensionPairingIdentity.createPairedIdentityHandoff.bind(
        extensionPairingIdentity,
      ),
    discoverPairedVaultIdentity:
      extensionPairingIdentity.discoverPairedVaultIdentity.bind(
        extensionPairingIdentity,
      ),
    decodePairingApprovedMessage: ExtensionPairingApprovedMessageSchema.decode,
    importPairingAfterCompanionReady,
    decodeExtensionIdentityHandoffRequestMessage:
      ExtensionIdentityHandoffRequestMessageSchema.decode,
    decodeExtensionPairedVaultIdentityDiscoveryMessage:
      ExtensionPairedVaultIdentityDiscoveryMessageSchema.decode,
    decodeExtensionPairedVaultIdentityHandoffRequestMessage:
      ExtensionPairedVaultIdentityHandoffRequestMessageSchema.decode,
    decodeExtensionPairedVaultUnlockRequestMessage:
      ExtensionPairedVaultUnlockRequestMessageSchema.decode,
    decodeOpenCompanionLauncherMessage:
      NormalizedOpenCompanionLauncherMessageSchema.decode,
    openCompanionLauncher: extensionSessionLifecycle.openCompanionLauncher.bind(
      extensionSessionLifecycle,
    ),
    refreshAuthenticationSurfaces:
      extensionSessionLifecycle.refreshAuthenticationSurfaces.bind(
        extensionSessionLifecycle,
      ),
    requestPairedVaultUnlock:
      extensionPairingIdentity.requestPairedVaultUnlock.bind(
        extensionPairingIdentity,
      ),
  }

const schemaRuntimeMessageRoutes: BackgroundRuntimeMessageRoutes = [
  SchemaRuntimeMessageRoute.matching(WebsiteLoginPickerOpenMessageSchema)
    .respondWith(openWebsiteLoginPicker)
    .onRejected(() => ({ ok: false, reason: 'login-picker-open-failed' })),
  SchemaRuntimeMessageRoute.matching(LoginPickerQueryMessageSchema)
    .respondWith(queryLoginPicker)
    .onRejected(() => ({ ok: false, reason: 'login-picker-query-failed' })),
  SchemaRuntimeMessageRoute.matching(LoginPickerSelectMessageSchema)
    .respondWith(selectLoginPicker)
    .onRejected(() => ({ ok: false, reason: 'login-picker-select-failed' })),
  SchemaRuntimeMessageRoute.matching(LoginPickerCancelMessageSchema)
    .respondWith(cancelLoginPicker)
    .onRejected(() => ({ ok: false, reason: 'login-picker-cancel-failed' })),
  SchemaRuntimeMessageRoute.matching(
    WebsiteAuthenticatorPickerOpenMessageSchema,
  )
    .respondWith(
      authenticatorEnrollmentOperations.openWebsiteAuthenticatorPicker.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({
      ok: false,
      reason: 'authenticator-picker-open-failed',
    })),
  SchemaRuntimeMessageRoute.matching(AuthenticatorPickerQueryMessageSchema)
    .respondWith(
      authenticatorEnrollmentOperations.queryAuthenticatorPicker.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({
      ok: false,
      reason: 'authenticator-picker-query-failed',
    })),
  SchemaRuntimeMessageRoute.matching(AuthenticatorPickerSelectMessageSchema)
    .respondWith(
      authenticatorEnrollmentOperations.selectAuthenticatorPicker.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({
      ok: false,
      reason: 'authenticator-picker-select-failed',
    })),
  SchemaRuntimeMessageRoute.matching(AuthenticatorPickerCancelMessageSchema)
    .respondWith(
      authenticatorEnrollmentOperations.cancelAuthenticatorPicker.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({
      ok: false,
      reason: 'authenticator-picker-cancel-failed',
    })),
  SchemaRuntimeMessageRoute.matching(WebsitePasskeyOptionsMessageSchema)
    .respondWith(
      websitePasskeyRequests.websitePasskeyOptions.bind(websitePasskeyRequests),
    )
    .onRejected(() => ({ ok: false, reason: 'passkey-options-failed' })),
  SchemaRuntimeMessageRoute.matching(WebsitePasskeyPerformMessageSchema)
    .respondWith(
      websitePasskeyRequests.performWebsitePasskey.bind(websitePasskeyRequests),
    )
    .onRejected(() => ({ ok: false, reason: 'passkey-ceremony-failed' })),
  SchemaRuntimeMessageRoute.matching(WebsitePasskeyCancelMessageSchema)
    .respondWith(
      websitePasskeyRequests.cancelWebsitePasskey.bind(websitePasskeyRequests),
    )
    .onRejected(() => ({ ok: false, reason: 'passkey-cancel-failed' })),
  SchemaRuntimeMessageRoute.matching(WebsiteLoginOptionsMessageSchema)
    .respondWith(
      accountPickerSessions.websiteLoginOptions.bind(accountPickerSessions),
    )
    .onRejected(() => ({ ok: false, reason: 'login-options-failed' })),
  SchemaRuntimeMessageRoute.matching(WebsiteLoginRevealMessageSchema)
    .respondWith(websiteLoginFill)
    .onRejected(() => ({ ok: false, reason: 'login-fill-failed' })),
  SchemaRuntimeMessageRoute.matching(WebsiteLoginSaveOfferMessageSchema)
    .respondWith(websiteLoginSaveOffer)
    .onRejected(() => ({
      kind: 'rejected',
      reason: 'login-save-offer-failed',
    })),
  SchemaRuntimeMessageRoute.matching(WebsiteLoginSavePendingMessageSchema)
    .respondWith(websiteLoginSavePending)
    .onRejected(() => ({ ok: false, reason: 'login-save-pending-failed' })),
  SchemaRuntimeMessageRoute.matching(WebsiteLoginSaveCommitMessageSchema)
    .respondWith(websiteLoginSaveCommit)
    .onRejected(() => ({
      kind: 'rejected',
      reason: 'login-save-commit-failed',
    })),
  SchemaRuntimeMessageRoute.matching(WebsiteLoginSaveDismissMessageSchema)
    .respondWith(websiteLoginSaveDismiss)
    .onRejected(() => ({
      kind: 'rejected',
      reason: 'login-save-dismiss-failed',
    })),
  SchemaRuntimeMessageRoute.matching(WebsiteAuthenticatorOptionsMessageSchema)
    .respondWith(
      authenticatorEnrollmentOperations.websiteAuthenticatorOptions.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({ ok: false, reason: 'authenticator-options-failed' })),
  SchemaRuntimeMessageRoute.matching(WebsiteAuthenticatorFillMessageSchema)
    .respondWith(
      authenticatorEnrollmentOperations.websiteAuthenticatorFill.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({ ok: false, reason: 'authenticator-fill-failed' })),
  SchemaRuntimeMessageRoute.matching(
    WebsiteAuthenticatorEnrollPreviewMessageSchema,
  )
    .respondWith(
      authenticatorEnrollmentOperations.websiteAuthenticatorEnrollPreview.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({ ok: false, reason: 'authenticator-preview-failed' })),
  SchemaRuntimeMessageRoute.matching(
    WebsiteAuthenticatorEnrollStageMessageSchema,
  )
    .respondWith(
      authenticatorEnrollmentOperations.websiteAuthenticatorEnrollStage.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({ ok: false, reason: 'authenticator-stage-failed' })),
  SchemaRuntimeMessageRoute.matching(
    WebsiteAuthenticatorEnrollCodeMessageSchema,
  )
    .respondWith(
      authenticatorEnrollmentOperations.websiteAuthenticatorEnrollCode.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({ ok: false, reason: 'authenticator-code-failed' })),
  SchemaRuntimeMessageRoute.matching(
    WebsiteAuthenticatorEnrollConfirmMessageSchema,
  )
    .respondWith(
      authenticatorEnrollmentOperations.websiteAuthenticatorEnrollConfirm.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({ ok: false, reason: 'authenticator-enroll-failed' })),
  SchemaRuntimeMessageRoute.matching(
    WebsiteAuthenticatorEnrollDismissMessageSchema,
  )
    .respondWith(
      authenticatorEnrollmentOperations.websiteAuthenticatorEnrollDismiss.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({ ok: false, reason: 'authenticator-dismiss-failed' })),
  SchemaRuntimeMessageRoute.matching(
    WebsiteAuthenticatorEnrollPendingMessageSchema,
  )
    .respondWith(
      authenticatorEnrollmentOperations.websiteAuthenticatorEnrollPending.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({ ok: false, reason: 'authenticator-pending-failed' })),
  SchemaRuntimeMessageRoute.matching(
    WebsiteAuthenticatorBackupAttachMessageSchema,
  )
    .respondWith(
      authenticatorEnrollmentOperations.websiteAuthenticatorBackupAttach.bind(
        authenticatorEnrollmentOperations,
      ),
    )
    .onRejected(() => ({ ok: false, reason: 'authenticator-backup-failed' })),
]

const orderedSchemaRuntimeMessageRouter =
  new OrderedBackgroundRuntimeMessageRouter(schemaRuntimeMessageRoutes)

type BackgroundRuntimeMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]
type BackgroundRuntimeMessageListenerArguments = [
  runtimeMessage: BrowserRuntimeMessageValue,
  sender: chrome.runtime.MessageSender,
  sendResponse: Parameters<BackgroundRuntimeMessageListener>[2],
]

type BackgroundRuntimeMessageRoutingRequest = {
  readonly runtimeMessage: BrowserRuntimeMessage
  readonly sender: chrome.runtime.MessageSender
  readonly sendResponse: Parameters<BackgroundRuntimeMessageListener>[2]
}

class BackgroundRuntimeMessageRouter {
  constructor(
    private readonly request: BackgroundRuntimeMessageRoutingRequest,
  ) {}

  /** Chrome's listener contract uses a boolean to keep sendResponse open. */
  route(): boolean {
    const { runtimeMessage, sender, sendResponse } = this.request
    const message = runtimeMessage
    const lifecycleRoutingArgs: Parameters<
      typeof routeExtensionLifecycleMessage
    >[0] = {
      dependencies: extensionLifecycleRoutingDependencies,
      message,
      sender,
      sendResponse,
    }
    const lifecycleResult = routeExtensionLifecycleMessage(lifecycleRoutingArgs)
    if (lifecycleResult !== ExtensionLifecycleRoutingResult.Unhandled) {
      return lifecycleResult
    }

    const schemaRoutingRequest: AdmittedRuntimeMessageRoutingRequest = {
      message,
      sender,
      sendResponse,
    }
    const schemaOutcome =
      orderedSchemaRuntimeMessageRouter.route(schemaRoutingRequest)
    if (schemaOutcome.kind === RuntimeMessageRouteKind.Handled) {
      return (
        schemaOutcome.responseChannel === RuntimeMessageResponseChannel.Open
      )
    }

    if (
      'type' in message &&
      typeof message.type === 'string' &&
      isCompanionWasmSessionMessageType(message.type)
    ) {
      if (
        !('origin' in message) ||
        typeof message.origin !== 'string' ||
        !extensionPairingIdentity.isAuthorizedWebsiteSender({
          sender,
          origin: message.origin,
        })
      ) {
        sendResponse({ ok: false, reason: 'companion-wasm-forbidden-origin' })
        return false
      }
      const sessionMessage = message as CompanionWasmRuntimeMessage
      void extensionPairingIdentity
        .sendSessionMessage(sessionMessage as CompanionWasmSessionMessage)
        .then((delivery) => {
          if (delivery.isErr()) {
            sendResponse({ ok: false, reason: 'companion-wasm-unavailable' })
            return
          }
          sendResponse({ ok: true, result: delivery.value })
        })
        .catch(() => {
          sendResponse({ ok: false, reason: 'companion-wasm-failed' })
        })
      return true
    }

    if (
      'type' in message &&
      message.type ===
        AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot
    ) {
      type ModuleSendResponseRequest2 = { ok: boolean; reason: string }
      const moduleSendResponseRequest2: ModuleSendResponseRequest2 = {
        ok: false,
        reason: 'workflow-invalid-observation',
      }
      void companionWasmReady
        .then(async () => {
          const admission = AuthenticationWorkflowSnapshotIngress.admit(message)
          if (admission.kind !== 'accepted') {
            type ModuleSendResponseRequest = { ok: boolean; reason: string }
            const moduleSendResponseRequest: ModuleSendResponseRequest = {
              ok: false,
              reason: 'workflow-invalid-observation',
            }
            sendResponse(moduleSendResponseRequest)
            return
          }
          const decoded = admission.message
          const nookTypedArgs0_1: Parameters<
            typeof extensionPairingIdentity.isAuthorizedWebsiteSender
          >[0] = {
            sender,
            origin: decoded.payload.origin,
          }
          if (
            !extensionPairingIdentity.isAuthorizedWebsiteSender(
              nookTypedArgs0_1,
            )
          ) {
            const nookTypedArgs0_2: Parameters<typeof sendResponse>[0] = {
              ok: false,
              reason: 'workflow-forbidden-origin',
            }
            sendResponse(nookTypedArgs0_2)
            return
          }
          const workflowDependencies: Parameters<
            typeof authenticationWorkflowMessageResponse
          >[0]['dependencies'] = {
            companionWasmReady,
            authenticationPasskeyEvidenceIsSafe,
            authenticationWorkflowSnapshot:
              backgroundVaultRuntime.authenticationWorkflowSnapshot.bind(
                backgroundVaultRuntime,
              ),
            authenticationWorkflowRequiresLoginMatchAvailability,
            authenticationWorkflowPilotPresentationCapability,
            authenticationWorkflowSavedLoginCapability,
            matchingPasskeyAvailabilityForOriginSafe:
              websitePasskeyRequests.matchingPasskeyAvailabilityForOriginSafe.bind(
                websitePasskeyRequests,
              ),
            websiteLoginMatchAvailability:
              accountPickerSessions.websiteLoginMatchAvailability.bind(
                accountPickerSessions,
              ),
          }
          const workflowRequest: Parameters<
            typeof authenticationWorkflowMessageResponse
          >[0] = {
            message: decoded,
            sender,
            dependencies: workflowDependencies,
          }
          sendResponse(
            await authenticationWorkflowMessageResponse(workflowRequest),
          )
        })
        .catch(() => sendResponse(moduleSendResponseRequest2))
      return true
    }

    const outcomeClassify = runConcreteDecoder(
      AuthenticationOutcomeClassifyMessageSchema.decode,
      message,
    )
    if (outcomeClassify.kind === ConcreteDecoderResultKind.Decoded) {
      const outcomeMessage = outcomeClassify.value
      const nookTypedArgs0_3: Parameters<
        typeof backgroundVaultRuntime.classifyAuthenticationOutcome
      >[0] = {
        observation: outcomeMessage.payload.observation,
        timeoutMs: outcomeMessage.payload.timeoutMs,
      }
      void backgroundVaultRuntime
        .classifyAuthenticationOutcome(nookTypedArgs0_3)
        .then((verdict) => {
          const nookArrowArgs11: Parameters<typeof sendResponse>[0] = {
            ok: true,
            verdict,
          }
          return sendResponse(nookArrowArgs11)
        })
        .catch(() => {
          const nookArrowArgs12: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'outcome-classify-failed',
          }
          return sendResponse(nookArrowArgs12)
        })
      return true
    }

    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type ===
        GeneratePasswordRequestType.NookWebsiteGeneratePassword &&
      'payload' in message &&
      typeof message.payload === 'object' &&
      message.payload &&
      'origin' in message.payload &&
      typeof message.payload.origin === 'string'
    ) {
      const nookTypedArgs0_4: Parameters<
        typeof extensionPairingIdentity.isAuthorizedWebsiteSender
      >[0] = {
        sender,
        origin: message.payload.origin,
      }
      if (
        !extensionPairingIdentity.isAuthorizedWebsiteSender(nookTypedArgs0_4)
      ) {
        const nookTypedArgs0_5: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'generate-password-forbidden-origin',
        }
        sendResponse(nookTypedArgs0_5)
        return false
      }
      void backgroundVaultRuntime
        .generateSuggestedPassword()
        .then((password) => {
          const nookArrowArgs13: Parameters<typeof sendResponse>[0] = {
            ok: true,
            password,
          }
          return sendResponse(nookArrowArgs13)
        })
        .catch(() => {
          const nookArrowArgs14: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'generate-password-failed',
          }
          return sendResponse(nookArrowArgs14)
        })
      return true
    }

    return false
  }
}

const backgroundRuntimeMessageListener: BackgroundRuntimeMessageListener = (
  ...listenerArguments: BackgroundRuntimeMessageListenerArguments
) => {
  const [runtimeMessage, sender, sendResponse] = listenerArguments
  const admission = BrowserRuntimeMessage.from(runtimeMessage)
  if (admission.kind === BrowserRuntimeMessageAdmissionKind.Rejected)
    return false
  const routingRequest: BackgroundRuntimeMessageRoutingRequest = {
    runtimeMessage: admission.message,
    sender,
    sendResponse,
  }
  return new BackgroundRuntimeMessageRouter(routingRequest).route()
}

chrome.runtime.onMessage.addListener(backgroundRuntimeMessageListener)

chrome.action.onClicked.addListener((tab) => {
  extensionSessionLifecycle.openCompanionLauncherBestEffort(
    OpenCompanionLauncherIntent.Default,
    tab,
  )
})

type ExternalRuntimeMessageListener = Parameters<
  typeof chrome.runtime.onMessageExternal.addListener
>[0]
type ExternalRuntimeMessageListenerArguments = [
  externalMessage: ExternalCompanionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: Parameters<ExternalRuntimeMessageListener>[2],
]

const externalRuntimeMessageListener: ExternalRuntimeMessageListener = (
  ...listenerArguments: ExternalRuntimeMessageListenerArguments
) => {
  const [externalMessage, sender, sendResponse] = listenerArguments
  const externalRoutingArgs: ExternalCompanionRoutingRequest = {
    dependencies: externalCompanionRoutingDependencies,
    message: externalMessage,
    sender,
    sendResponse,
  }
  type ModuleSendResponseRequest3 = { ok: boolean; reason: string }
  const moduleSendResponseRequest3: ModuleSendResponseRequest3 = {
    ok: false,
    reason: 'forbidden-sender',
  }
  void new ExternalCompanionRouter(externalRoutingArgs)
    .route()
    .catch(() => sendResponse(moduleSendResponseRequest3))
  return true
}

chrome.runtime.onMessageExternal.addListener(externalRuntimeMessageListener)
