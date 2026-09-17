import {
  GeneratePasswordRequestType,
  ExtensionPairingApprovedMessage as ExtensionPairingApprovedMessageSchema,
  ExtensionIdentityHandoffRequestMessage as ExtensionIdentityHandoffRequestMessageSchema,
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
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
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
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../lib/concrete-decoder'
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
import { backgroundVaultRuntime } from './vault-runtime'

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

void recoverInterruptedAuthorizationCleanup(
  extensionLifecycleRoutingDependencies,
)
  .then((cleanup) => {
    if (cleanup.isErr())
      console.warn(
        'Extension authorization cleanup remains pending',
        cleanup.error,
      )
  })
  .catch(() => {
    console.warn('Extension authorization cleanup initialization failed')
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

type RuntimeMessageObject = {
  [key: string]:
    string | number | boolean | RuntimeMessageObject | RuntimeMessageObject[]
}
type RuntimeMessageInput =
  RuntimeMessageObject | RuntimeMessageObject[] | string | number | boolean

chrome.runtime.onMessage.addListener(
  // eslint-disable-next-line max-params -- Chrome owns the runtime listener callback signature.
  (runtimeMessage: RuntimeMessageInput, sender, sendResponse) => {
    if (!runtimeMessage || typeof runtimeMessage !== 'object') return false
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

    const WebsiteLoginPickerOpenMessageDecoded = runConcreteDecoder(WebsiteLoginPickerOpenMessageSchema.decode, message)
    if (WebsiteLoginPickerOpenMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteLoginPickerOpenMessageDecoded.value
      const nookTypedArgs0_0: Parameters<typeof openWebsiteLoginPicker>[0] = {
        message,
        sender,
      }
      void openWebsiteLoginPicker(nookTypedArgs0_0)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs2: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'login-picker-open-failed',
          }
          return sendResponse(nookArrowArgs2)
        })
      return true
    }

    const LoginPickerQueryMessageDecoded = runConcreteDecoder(LoginPickerQueryMessageSchema.decode, message)
    if (LoginPickerQueryMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = LoginPickerQueryMessageDecoded.value
      const nookTypedArgs0_1: Parameters<typeof queryLoginPicker>[0] = {
        message,
        sender,
      }
      void queryLoginPicker(nookTypedArgs0_1)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs3: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'login-picker-query-failed',
          }
          return sendResponse(nookArrowArgs3)
        })
      return true
    }

    const LoginPickerSelectMessageDecoded = runConcreteDecoder(LoginPickerSelectMessageSchema.decode, message)
    if (LoginPickerSelectMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = LoginPickerSelectMessageDecoded.value
      const nookTypedArgs0_2: Parameters<typeof selectLoginPicker>[0] = {
        message,
        sender,
      }
      void selectLoginPicker(nookTypedArgs0_2)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs4: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'login-picker-select-failed',
          }
          return sendResponse(nookArrowArgs4)
        })
      return true
    }

    const LoginPickerCancelMessageDecoded = runConcreteDecoder(LoginPickerCancelMessageSchema.decode, message)
    if (LoginPickerCancelMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = LoginPickerCancelMessageDecoded.value
      const nookTypedArgs0_3: Parameters<typeof cancelLoginPicker>[0] = {
        message,
        sender,
      }
      void cancelLoginPicker(nookTypedArgs0_3)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs5: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'login-picker-cancel-failed',
          }
          return sendResponse(nookArrowArgs5)
        })
      return true
    }

    const WebsiteAuthenticatorPickerOpenMessageDecoded = runConcreteDecoder(WebsiteAuthenticatorPickerOpenMessageSchema.decode, message)
    if (WebsiteAuthenticatorPickerOpenMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteAuthenticatorPickerOpenMessageDecoded.value
      const nookTypedArgs0_4: Parameters<
        typeof authenticatorEnrollmentOperations.openWebsiteAuthenticatorPicker
      >[0] = { message, sender }
      void authenticatorEnrollmentOperations
        .openWebsiteAuthenticatorPicker(nookTypedArgs0_4)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs6: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-picker-open-failed',
          }
          return sendResponse(nookArrowArgs6)
        })
      return true
    }

    const AuthenticatorPickerQueryMessageDecoded = runConcreteDecoder(AuthenticatorPickerQueryMessageSchema.decode, message)
    if (AuthenticatorPickerQueryMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = AuthenticatorPickerQueryMessageDecoded.value
      const nookTypedArgs0_5: Parameters<
        typeof authenticatorEnrollmentOperations.queryAuthenticatorPicker
      >[0] = {
        message,
        sender,
      }
      void authenticatorEnrollmentOperations
        .queryAuthenticatorPicker(nookTypedArgs0_5)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs7: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-picker-query-failed',
          }
          return sendResponse(nookArrowArgs7)
        })
      return true
    }

    const AuthenticatorPickerSelectMessageDecoded = runConcreteDecoder(AuthenticatorPickerSelectMessageSchema.decode, message)
    if (AuthenticatorPickerSelectMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = AuthenticatorPickerSelectMessageDecoded.value
      const nookTypedArgs0_6: Parameters<
        typeof authenticatorEnrollmentOperations.selectAuthenticatorPicker
      >[0] = {
        message,
        sender,
      }
      void authenticatorEnrollmentOperations
        .selectAuthenticatorPicker(nookTypedArgs0_6)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs8: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-picker-select-failed',
          }
          return sendResponse(nookArrowArgs8)
        })
      return true
    }

    const AuthenticatorPickerCancelMessageDecoded = runConcreteDecoder(AuthenticatorPickerCancelMessageSchema.decode, message)
    if (AuthenticatorPickerCancelMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = AuthenticatorPickerCancelMessageDecoded.value
      const nookTypedArgs0_7: Parameters<
        typeof authenticatorEnrollmentOperations.cancelAuthenticatorPicker
      >[0] = {
        message,
        sender,
      }
      void authenticatorEnrollmentOperations
        .cancelAuthenticatorPicker(nookTypedArgs0_7)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs9: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-picker-cancel-failed',
          }
          return sendResponse(nookArrowArgs9)
        })
      return true
    }

    if (
      'type' in message &&
      message.type ===
        AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot
    ) {
      void companionWasmReady
        .then(async () => {
          const admission = AuthenticationWorkflowSnapshotIngress.admit(message)
          if (admission.kind !== 'accepted') {
            // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
            sendResponse({ ok: false, reason: 'workflow-invalid-observation' })
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
        .catch(() =>
          // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
          sendResponse({ ok: false, reason: 'workflow-invalid-observation' }),
        )
      return true
    }

    const AuthenticationOutcomeClassifyMessageDecoded = runConcreteDecoder(AuthenticationOutcomeClassifyMessageSchema.decode, message)
    if (AuthenticationOutcomeClassifyMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = AuthenticationOutcomeClassifyMessageDecoded.value
      const nookTypedArgs0_3: Parameters<
        typeof backgroundVaultRuntime.classifyAuthenticationOutcome
      >[0] = {
        observation: message.payload.observation,
        timeoutMs: message.payload.timeoutMs,
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

    const WebsitePasskeyOptionsMessageDecoded = runConcreteDecoder(WebsitePasskeyOptionsMessageSchema.decode, message)
    if (WebsitePasskeyOptionsMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsitePasskeyOptionsMessageDecoded.value
      const nookTypedArgs0_8: Parameters<
        typeof websitePasskeyRequests.websitePasskeyOptions
      >[0] = {
        message,
        sender,
      }
      void websitePasskeyRequests
        .websitePasskeyOptions(nookTypedArgs0_8)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs15: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'passkey-options-failed',
          }
          return sendResponse(nookArrowArgs15)
        })
      return true
    }

    const WebsitePasskeyPerformMessageDecoded = runConcreteDecoder(WebsitePasskeyPerformMessageSchema.decode, message)
    if (WebsitePasskeyPerformMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsitePasskeyPerformMessageDecoded.value
      const nookTypedArgs0_9: Parameters<
        typeof websitePasskeyRequests.performWebsitePasskey
      >[0] = {
        message,
        sender,
      }
      void websitePasskeyRequests
        .performWebsitePasskey(nookTypedArgs0_9)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs16: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'passkey-ceremony-failed',
          }
          return sendResponse(nookArrowArgs16)
        })
      return true
    }

    const WebsitePasskeyCancelMessageDecoded = runConcreteDecoder(WebsitePasskeyCancelMessageSchema.decode, message)
    if (WebsitePasskeyCancelMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsitePasskeyCancelMessageDecoded.value
      const nookTypedArgs0_10: Parameters<
        typeof websitePasskeyRequests.cancelWebsitePasskey
      >[0] = {
        message,
        sender,
      }
      void websitePasskeyRequests
        .cancelWebsitePasskey(nookTypedArgs0_10)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs17: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'passkey-cancel-failed',
          }
          return sendResponse(nookArrowArgs17)
        })
      return true
    }

    const WebsiteLoginOptionsMessageDecoded = runConcreteDecoder(WebsiteLoginOptionsMessageSchema.decode, message)
    if (WebsiteLoginOptionsMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteLoginOptionsMessageDecoded.value
      const nookTypedArgs0_11: Parameters<
        typeof accountPickerSessions.websiteLoginOptions
      >[0] = {
        message,
        sender,
      }
      void accountPickerSessions
        .websiteLoginOptions(nookTypedArgs0_11)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs18: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'login-options-failed',
          }
          return sendResponse(nookArrowArgs18)
        })
      return true
    }

    const WebsiteLoginRevealMessageDecoded = runConcreteDecoder(WebsiteLoginRevealMessageSchema.decode, message)
    if (WebsiteLoginRevealMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteLoginRevealMessageDecoded.value
      const nookTypedArgs0_12: Parameters<typeof websiteLoginFill>[0] = {
        message,
        sender,
      }
      void websiteLoginFill(nookTypedArgs0_12)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs19: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'login-fill-failed',
          }
          return sendResponse(nookArrowArgs19)
        })
      return true
    }

    const WebsiteLoginSaveOfferMessageDecoded = runConcreteDecoder(WebsiteLoginSaveOfferMessageSchema.decode, message)
    if (WebsiteLoginSaveOfferMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteLoginSaveOfferMessageDecoded.value
      const nookTypedArgs0_13: Parameters<typeof websiteLoginSaveOffer>[0] = {
        message,
        sender,
      }
      void websiteLoginSaveOffer(nookTypedArgs0_13)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs20: Parameters<typeof sendResponse>[0] = {
            kind: 'rejected',
            reason: 'login-save-offer-failed',
          }
          return sendResponse(nookArrowArgs20)
        })
      return true
    }

    const WebsiteLoginSavePendingMessageDecoded = runConcreteDecoder(WebsiteLoginSavePendingMessageSchema.decode, message)
    if (WebsiteLoginSavePendingMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteLoginSavePendingMessageDecoded.value
      const nookTypedArgs0_14: Parameters<typeof websiteLoginSavePending>[0] = {
        message,
        sender,
      }
      void websiteLoginSavePending(nookTypedArgs0_14)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs21: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'login-save-pending-failed',
          }
          return sendResponse(nookArrowArgs21)
        })
      return true
    }

    const WebsiteLoginSaveCommitMessageDecoded = runConcreteDecoder(WebsiteLoginSaveCommitMessageSchema.decode, message)
    if (WebsiteLoginSaveCommitMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteLoginSaveCommitMessageDecoded.value
      const nookTypedArgs0_15: Parameters<typeof websiteLoginSaveCommit>[0] = {
        message,
        sender,
      }
      void websiteLoginSaveCommit(nookTypedArgs0_15)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs22: Parameters<typeof sendResponse>[0] = {
            kind: 'rejected',
            reason: 'login-save-commit-failed',
          }
          return sendResponse(nookArrowArgs22)
        })
      return true
    }

    const WebsiteLoginSaveDismissMessageDecoded = runConcreteDecoder(WebsiteLoginSaveDismissMessageSchema.decode, message)
    if (WebsiteLoginSaveDismissMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteLoginSaveDismissMessageDecoded.value
      const nookTypedArgs0_16: Parameters<typeof websiteLoginSaveDismiss>[0] = {
        message,
        sender,
      }
      void websiteLoginSaveDismiss(nookTypedArgs0_16)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs23: Parameters<typeof sendResponse>[0] = {
            kind: 'rejected',
            reason: 'login-save-dismiss-failed',
          }
          return sendResponse(nookArrowArgs23)
        })
      return true
    }

    const WebsiteAuthenticatorOptionsMessageDecoded = runConcreteDecoder(WebsiteAuthenticatorOptionsMessageSchema.decode, message)
    if (WebsiteAuthenticatorOptionsMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteAuthenticatorOptionsMessageDecoded.value
      const nookTypedArgs0_17: Parameters<
        typeof authenticatorEnrollmentOperations.websiteAuthenticatorOptions
      >[0] = { message, sender }
      void authenticatorEnrollmentOperations
        .websiteAuthenticatorOptions(nookTypedArgs0_17)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs24: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-options-failed',
          }
          return sendResponse(nookArrowArgs24)
        })
      return true
    }

    const WebsiteAuthenticatorFillMessageDecoded = runConcreteDecoder(WebsiteAuthenticatorFillMessageSchema.decode, message)
    if (WebsiteAuthenticatorFillMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteAuthenticatorFillMessageDecoded.value
      const nookTypedArgs0_18: Parameters<
        typeof authenticatorEnrollmentOperations.websiteAuthenticatorFill
      >[0] = {
        message,
        sender,
      }
      void authenticatorEnrollmentOperations
        .websiteAuthenticatorFill(nookTypedArgs0_18)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs25: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-fill-failed',
          }
          return sendResponse(nookArrowArgs25)
        })
      return true
    }

    const WebsiteAuthenticatorEnrollPreviewMessageDecoded = runConcreteDecoder(WebsiteAuthenticatorEnrollPreviewMessageSchema.decode, message)
    if (WebsiteAuthenticatorEnrollPreviewMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteAuthenticatorEnrollPreviewMessageDecoded.value
      const nookTypedArgs0_19: Parameters<
        typeof authenticatorEnrollmentOperations.websiteAuthenticatorEnrollPreview
      >[0] = { message, sender }
      void authenticatorEnrollmentOperations
        .websiteAuthenticatorEnrollPreview(nookTypedArgs0_19)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs26: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-preview-failed',
          }
          return sendResponse(nookArrowArgs26)
        })
      return true
    }

    const WebsiteAuthenticatorEnrollStageMessageDecoded = runConcreteDecoder(WebsiteAuthenticatorEnrollStageMessageSchema.decode, message)
    if (WebsiteAuthenticatorEnrollStageMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteAuthenticatorEnrollStageMessageDecoded.value
      const nookTypedArgs0_20: Parameters<
        typeof authenticatorEnrollmentOperations.websiteAuthenticatorEnrollStage
      >[0] = { message, sender }
      void authenticatorEnrollmentOperations
        .websiteAuthenticatorEnrollStage(nookTypedArgs0_20)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs27: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-stage-failed',
          }
          return sendResponse(nookArrowArgs27)
        })
      return true
    }

    const WebsiteAuthenticatorEnrollCodeMessageDecoded = runConcreteDecoder(WebsiteAuthenticatorEnrollCodeMessageSchema.decode, message)
    if (WebsiteAuthenticatorEnrollCodeMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteAuthenticatorEnrollCodeMessageDecoded.value
      const nookTypedArgs0_21: Parameters<
        typeof authenticatorEnrollmentOperations.websiteAuthenticatorEnrollCode
      >[0] = { message, sender }
      void authenticatorEnrollmentOperations
        .websiteAuthenticatorEnrollCode(nookTypedArgs0_21)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs28: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-code-failed',
          }
          return sendResponse(nookArrowArgs28)
        })
      return true
    }

    const WebsiteAuthenticatorEnrollConfirmMessageDecoded = runConcreteDecoder(WebsiteAuthenticatorEnrollConfirmMessageSchema.decode, message)
    if (WebsiteAuthenticatorEnrollConfirmMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteAuthenticatorEnrollConfirmMessageDecoded.value
      const nookTypedArgs0_22: Parameters<
        typeof authenticatorEnrollmentOperations.websiteAuthenticatorEnrollConfirm
      >[0] = { message, sender }
      void authenticatorEnrollmentOperations
        .websiteAuthenticatorEnrollConfirm(nookTypedArgs0_22)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs29: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-enroll-failed',
          }
          return sendResponse(nookArrowArgs29)
        })
      return true
    }

    const WebsiteAuthenticatorEnrollDismissMessageDecoded = runConcreteDecoder(WebsiteAuthenticatorEnrollDismissMessageSchema.decode, message)
    if (WebsiteAuthenticatorEnrollDismissMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteAuthenticatorEnrollDismissMessageDecoded.value
      const nookTypedArgs0_23: Parameters<
        typeof authenticatorEnrollmentOperations.websiteAuthenticatorEnrollDismiss
      >[0] = { message, sender }
      void authenticatorEnrollmentOperations
        .websiteAuthenticatorEnrollDismiss(nookTypedArgs0_23)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs30: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-dismiss-failed',
          }
          return sendResponse(nookArrowArgs30)
        })
      return true
    }

    const WebsiteAuthenticatorEnrollPendingMessageDecoded = runConcreteDecoder(WebsiteAuthenticatorEnrollPendingMessageSchema.decode, message)
    if (WebsiteAuthenticatorEnrollPendingMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteAuthenticatorEnrollPendingMessageDecoded.value
      const nookTypedArgs0_24: Parameters<
        typeof authenticatorEnrollmentOperations.websiteAuthenticatorEnrollPending
      >[0] = { message, sender }
      void authenticatorEnrollmentOperations
        .websiteAuthenticatorEnrollPending(nookTypedArgs0_24)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs31: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-pending-failed',
          }
          return sendResponse(nookArrowArgs31)
        })
      return true
    }

    const WebsiteAuthenticatorBackupAttachMessageDecoded = runConcreteDecoder(WebsiteAuthenticatorBackupAttachMessageSchema.decode, message)
    if (WebsiteAuthenticatorBackupAttachMessageDecoded.kind === ConcreteDecoderResultKind.Decoded) {
      const message = WebsiteAuthenticatorBackupAttachMessageDecoded.value
      const nookTypedArgs0_25: Parameters<
        typeof authenticatorEnrollmentOperations.websiteAuthenticatorBackupAttach
      >[0] = { message, sender }
      void authenticatorEnrollmentOperations
        .websiteAuthenticatorBackupAttach(nookTypedArgs0_25)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs32: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'authenticator-backup-failed',
          }
          return sendResponse(nookArrowArgs32)
        })
      return true
    }

    return false
  },
)

chrome.runtime.onMessageExternal.addListener(
  // eslint-disable-next-line max-params -- Chrome owns the external listener callback signature.
  (runtimeMessage: ExternalCompanionMessage, sender, sendResponse) => {
    if (!runtimeMessage || typeof runtimeMessage !== 'object') return false
    const message = runtimeMessage
    const externalRoutingArgs: ExternalCompanionRoutingRequest = {
      dependencies: externalCompanionRoutingDependencies,
      message,
      sender,
      sendResponse,
    }
    void new ExternalCompanionRouter(externalRoutingArgs).route().catch(() =>
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      sendResponse({ ok: false, reason: 'forbidden-sender' }),
    )
    return true
  },
)
