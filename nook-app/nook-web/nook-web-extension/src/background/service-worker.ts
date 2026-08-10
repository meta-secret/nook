import {
  isBeginExtensionPairingMessage,
  isExtensionIdentityHandoffRequestMessage,
  isExtensionLocalEventLogUpdatedMessage,
  isExtensionPairedVaultIdentityDiscoveryMessage,
  isExtensionPairedVaultIdentityHandoffRequestMessage,
  isExtensionPairedVaultUnlockRequestMessage,
  isOpenCompanionLauncherMessage,
  isOpenSimpleVaultMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import { isAuthenticationWorkflowSnapshotMessage } from '../lib/auth-workflow-messages'
import {
  isAuthenticatorPickerCancelMessage,
  isAuthenticatorPickerQueryMessage,
  isAuthenticatorPickerSelectMessage,
  isWebsiteAuthenticatorPickerOpenMessage,
} from '../lib/authenticator-picker-messages'
import {
  isWebsiteAuthenticatorBackupAttachMessage,
  isWebsiteAuthenticatorEnrollCodeMessage,
  isWebsiteAuthenticatorEnrollConfirmMessage,
  isWebsiteAuthenticatorEnrollDismissMessage,
  isWebsiteAuthenticatorEnrollPendingMessage,
  isWebsiteAuthenticatorEnrollPreviewMessage,
  isWebsiteAuthenticatorEnrollStageMessage,
} from '../lib/enrollment-messages'
import {
  isQueryActiveTabLoginDetectionMessage,
  LoginDetectionStatus,
  type LoginDetectionResponse,
} from '../lib/login-detection-messages'
import {
  isWebsiteAuthenticatorFillMessage,
  isWebsiteAuthenticatorOptionsMessage,
  isWebsiteLoginOptionsMessage,
  isWebsiteLoginRevealMessage,
} from '../lib/login-fill-messages'
import {
  isLoginPickerCancelMessage,
  isLoginPickerQueryMessage,
  isLoginPickerSelectMessage,
  isWebsiteLoginPickerOpenMessage,
} from '../lib/login-picker-messages'
import {
  isWebsiteLoginSaveCommitMessage,
  isWebsiteLoginSaveDismissMessage,
  isWebsiteLoginSaveOfferMessage,
  isWebsiteLoginSavePendingMessage,
} from '../lib/login-save-messages'
import { isAuthenticationOutcomeClassifyMessage } from '../lib/outcome-evidence-messages'
import { isExtensionPairingStateQueryMessage } from '../lib/pairing-state'
import {
  isWebsitePasskeyCancelMessage,
  isWebsitePasskeyOptionsMessage,
  isWebsitePasskeyPerformMessage,
} from '../lib/webauthn-messages'
import { websiteLoginOptions } from './service-worker/account-pickers'
import {
  cancelAuthenticatorPicker,
  openWebsiteAuthenticatorPicker,
  queryAuthenticatorPicker,
  selectAuthenticatorPicker,
  websiteAuthenticatorBackupAttach,
  websiteAuthenticatorEnrollCode,
  websiteAuthenticatorEnrollConfirm,
  websiteAuthenticatorEnrollDismiss,
  websiteAuthenticatorEnrollPending,
  websiteAuthenticatorEnrollPreview,
  websiteAuthenticatorEnrollStage,
  websiteAuthenticatorFill,
  websiteAuthenticatorOptions,
} from './service-worker/authenticator-operations'
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
import {
  createIdentityHandoff,
  discoverPairedVaultIdentity,
  hasPairingApprovedType,
  isAuthorizedWebsiteSender,
  isNokeySender,
  openExtensionPairing,
  requestPairedVaultUnlock,
} from './service-worker/pairing-identity'
import { handlePairingStateQuery } from './service-worker/pairing-state-query'
import {
  importPairingAfterCompanionReady,
  importLocalEventLogUpdate,
} from './service-worker/pairing-import'
import {
  cancelWebsitePasskey,
  matchingPasskeyAccountCountForOriginSafe,
  performWebsitePasskey,
  websitePasskeyOptions,
} from './service-worker/passkey-operations'
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
} from './service-worker/session-lifecycle'
import {
  AuthenticationWorkflowSnapshotKind,
  authenticationWorkflowSnapshot,
  classifyAuthenticationOutcome,
  generateSuggestedPassword,
} from './vault-runtime'

// eslint-disable-next-line max-params -- Chrome owns the runtime listener callback signature.
chrome.runtime.onMessage.addListener((runtimeMessage, sender, sendResponse) => {
  if (!runtimeMessage || typeof runtimeMessage !== 'object') return false
  const message = runtimeMessage as object
  if (isExtensionPairingStateQueryMessage(message)) {
    const queryContext: Parameters<typeof handlePairingStateQuery>[0] = {
      sender,
      sendResponse,
    }
    return handlePairingStateQuery(queryContext)
  }

  if (isWebsiteLoginPickerOpenMessage(message)) {
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

  if (isLoginPickerQueryMessage(message)) {
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

  if (isLoginPickerSelectMessage(message)) {
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

  if (isLoginPickerCancelMessage(message)) {
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

  if (isWebsiteAuthenticatorPickerOpenMessage(message)) {
    const nookTypedArgs0_4: Parameters<
      typeof openWebsiteAuthenticatorPicker
    >[0] = { message, sender }
    void openWebsiteAuthenticatorPicker(nookTypedArgs0_4)
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

  if (isAuthenticatorPickerQueryMessage(message)) {
    const nookTypedArgs0_5: Parameters<typeof queryAuthenticatorPicker>[0] = {
      message,
      sender,
    }
    void queryAuthenticatorPicker(nookTypedArgs0_5)
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

  if (isAuthenticatorPickerSelectMessage(message)) {
    const nookTypedArgs0_6: Parameters<typeof selectAuthenticatorPicker>[0] = {
      message,
      sender,
    }
    void selectAuthenticatorPicker(nookTypedArgs0_6)
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

  if (isAuthenticatorPickerCancelMessage(message)) {
    const nookTypedArgs0_7: Parameters<typeof cancelAuthenticatorPicker>[0] = {
      message,
      sender,
    }
    void cancelAuthenticatorPicker(nookTypedArgs0_7)
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

  if (isAuthenticationWorkflowSnapshotMessage(message)) {
    const nookTypedArgs0_1: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
      sender,
      origin: message.payload.origin,
    }
    if (!isAuthorizedWebsiteSender(nookTypedArgs0_1)) {
      const nookTypedArgs0_2: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'workflow-forbidden-origin',
      }
      sendResponse(nookTypedArgs0_2)
      return false
    }
    const needsPasskeyLookup = message.payload.observations.some(
      (observation) => observation.passkeyControlPresent,
    )
    void (
      needsPasskeyLookup
        ? matchingPasskeyAccountCountForOriginSafe(message.payload.origin)
        : Promise.resolve(0)
    )
      .then((matchingPasskeyAccountCount) =>
        authenticationWorkflowSnapshot(
          message.payload.observations.map((observation) => ({
            ...observation,
            matchingPasskeyAccountCount: observation.passkeyControlPresent
              ? matchingPasskeyAccountCount
              : 0,
          })),
        ),
      )
      .then((result) => {
        const matchedResponse: Parameters<typeof sendResponse>[0] = {
          ok: true,
          ...(result.kind === AuthenticationWorkflowSnapshotKind.Matched
            ? { snapshot: result.snapshot }
            : {}),
        }
        return sendResponse(matchedResponse)
      })
      .catch(() => {
        const nookArrowArgs10: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'workflow-snapshot-failed',
        }
        return sendResponse(nookArrowArgs10)
      })
    return true
  }

  if (isAuthenticationOutcomeClassifyMessage(message)) {
    const nookTypedArgs0_3: Parameters<
      typeof classifyAuthenticationOutcome
    >[0] = {
      observation: message.payload.observation,
      timeoutMs: message.payload.timeoutMs,
    }
    void classifyAuthenticationOutcome(nookTypedArgs0_3)
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
    message.type === 'nook:website-generate-password' &&
    'payload' in message &&
    typeof message.payload === 'object' &&
    message.payload &&
    'origin' in message.payload &&
    typeof message.payload.origin === 'string'
  ) {
    const nookTypedArgs0_4: Parameters<typeof isAuthorizedWebsiteSender>[0] = {
      sender,
      origin: (message.payload as { origin: string }).origin,
    }
    if (!isAuthorizedWebsiteSender(nookTypedArgs0_4)) {
      const nookTypedArgs0_5: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'generate-password-forbidden-origin',
      }
      sendResponse(nookTypedArgs0_5)
      return false
    }
    void generateSuggestedPassword()
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

  if (isWebsitePasskeyOptionsMessage(message)) {
    const nookTypedArgs0_8: Parameters<typeof websitePasskeyOptions>[0] = {
      message,
      sender,
    }
    void websitePasskeyOptions(nookTypedArgs0_8)
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

  if (isWebsitePasskeyPerformMessage(message)) {
    const nookTypedArgs0_9: Parameters<typeof performWebsitePasskey>[0] = {
      message,
      sender,
    }
    void performWebsitePasskey(nookTypedArgs0_9)
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

  if (isWebsitePasskeyCancelMessage(message)) {
    const nookTypedArgs0_10: Parameters<typeof cancelWebsitePasskey>[0] = {
      message,
      sender,
    }
    void cancelWebsitePasskey(nookTypedArgs0_10)
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

  if (isWebsiteLoginOptionsMessage(message)) {
    const nookTypedArgs0_11: Parameters<typeof websiteLoginOptions>[0] = {
      message,
      sender,
    }
    void websiteLoginOptions(nookTypedArgs0_11)
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

  if (isWebsiteLoginRevealMessage(message)) {
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

  if (isWebsiteLoginSaveOfferMessage(message)) {
    const nookTypedArgs0_13: Parameters<typeof websiteLoginSaveOffer>[0] = {
      message,
      sender,
    }
    void websiteLoginSaveOffer(nookTypedArgs0_13)
      .then(sendResponse)
      .catch(() => {
        const nookArrowArgs20: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'login-save-offer-failed',
        }
        return sendResponse(nookArrowArgs20)
      })
    return true
  }

  if (isWebsiteLoginSavePendingMessage(message)) {
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

  if (isWebsiteLoginSaveCommitMessage(message)) {
    const nookTypedArgs0_15: Parameters<typeof websiteLoginSaveCommit>[0] = {
      message,
      sender,
    }
    void websiteLoginSaveCommit(nookTypedArgs0_15)
      .then(sendResponse)
      .catch(() => {
        const nookArrowArgs22: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'login-save-commit-failed',
        }
        return sendResponse(nookArrowArgs22)
      })
    return true
  }

  if (isWebsiteLoginSaveDismissMessage(message)) {
    const nookTypedArgs0_16: Parameters<typeof websiteLoginSaveDismiss>[0] = {
      message,
      sender,
    }
    void websiteLoginSaveDismiss(nookTypedArgs0_16)
      .then(sendResponse)
      .catch(() => {
        const nookArrowArgs23: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'login-save-dismiss-failed',
        }
        return sendResponse(nookArrowArgs23)
      })
    return true
  }

  if (isWebsiteAuthenticatorOptionsMessage(message)) {
    const nookTypedArgs0_17: Parameters<typeof websiteAuthenticatorOptions>[0] =
      { message, sender }
    void websiteAuthenticatorOptions(nookTypedArgs0_17)
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

  if (isWebsiteAuthenticatorFillMessage(message)) {
    const nookTypedArgs0_18: Parameters<typeof websiteAuthenticatorFill>[0] = {
      message,
      sender,
    }
    void websiteAuthenticatorFill(nookTypedArgs0_18)
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

  if (isWebsiteAuthenticatorEnrollPreviewMessage(message)) {
    const nookTypedArgs0_19: Parameters<
      typeof websiteAuthenticatorEnrollPreview
    >[0] = { message, sender }
    void websiteAuthenticatorEnrollPreview(nookTypedArgs0_19)
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

  if (isWebsiteAuthenticatorEnrollStageMessage(message)) {
    const nookTypedArgs0_20: Parameters<
      typeof websiteAuthenticatorEnrollStage
    >[0] = { message, sender }
    void websiteAuthenticatorEnrollStage(nookTypedArgs0_20)
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

  if (isWebsiteAuthenticatorEnrollCodeMessage(message)) {
    const nookTypedArgs0_21: Parameters<
      typeof websiteAuthenticatorEnrollCode
    >[0] = { message, sender }
    void websiteAuthenticatorEnrollCode(nookTypedArgs0_21)
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

  if (isWebsiteAuthenticatorEnrollConfirmMessage(message)) {
    const nookTypedArgs0_22: Parameters<
      typeof websiteAuthenticatorEnrollConfirm
    >[0] = { message, sender }
    void websiteAuthenticatorEnrollConfirm(nookTypedArgs0_22)
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

  if (isWebsiteAuthenticatorEnrollDismissMessage(message)) {
    const nookTypedArgs0_23: Parameters<
      typeof websiteAuthenticatorEnrollDismiss
    >[0] = { message, sender }
    void websiteAuthenticatorEnrollDismiss(nookTypedArgs0_23)
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

  if (isWebsiteAuthenticatorEnrollPendingMessage(message)) {
    const nookTypedArgs0_24: Parameters<
      typeof websiteAuthenticatorEnrollPending
    >[0] = { message, sender }
    void websiteAuthenticatorEnrollPending(nookTypedArgs0_24)
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

  if (isWebsiteAuthenticatorBackupAttachMessage(message)) {
    const nookTypedArgs0_25: Parameters<
      typeof websiteAuthenticatorBackupAttach
    >[0] = { message, sender }
    void websiteAuthenticatorBackupAttach(nookTypedArgs0_25)
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

  if (isExtensionSessionEnsureMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      const nookTypedArgs0_6: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'forbidden-sender',
      }
      sendResponse(nookTypedArgs0_6)
      return false
    }
    void ensureExtensionSessionDocument()
      .then(() => {
        const nookArrowArgs33: Parameters<typeof sendResponse>[0] = { ok: true }
        return sendResponse(nookArrowArgs33)
      })
      .catch(() => {
        const nookArrowArgs34: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'session-runtime-failed',
        }
        return sendResponse(nookArrowArgs34)
      })
    return true
  }

  if (isExtensionSessionLockMessage(message)) {
    const senderUrlAllowed =
      !('url' in sender) ||
      (typeof sender.url === 'string' &&
        sender.url.startsWith(chrome.runtime.getURL('')))
    const extensionSender = sender.id === chrome.runtime.id && senderUrlAllowed
    if (!extensionSender) {
      const nookTypedArgs0_7: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'forbidden-sender',
      }
      sendResponse(nookTypedArgs0_7)
      return false
    }
    void closeExtensionSessionDocument()
      .then(() => {
        const nookArrowArgs35: Parameters<typeof sendResponse>[0] = { ok: true }
        return sendResponse(nookArrowArgs35)
      })
      .catch(() => {
        const nookArrowArgs36: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'session-lock-failed',
        }
        return sendResponse(nookArrowArgs36)
      })
    return true
  }

  if (isExtensionSessionExpiryMessage(message)) {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.endsWith(`/${extensionSessionDocument}`)
    ) {
      const nookTypedArgs0_8: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'forbidden-sender',
      }
      sendResponse(nookTypedArgs0_8)
      return false
    }
    void closeExtensionSessionDocument().then(() => {
      const nookArrowArgs37: Parameters<typeof sendResponse>[0] = { ok: true }
      return sendResponse(nookArrowArgs37)
    })
    return true
  }

  if (hasPairingApprovedType(message)) {
    if (sender.id !== chrome.runtime.id) {
      const nookTypedArgs0_10: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'forbidden-sender',
      }
      sendResponse(nookTypedArgs0_10)
      return false
    }

    void importPairingAfterCompanionReady(message).then(sendResponse)
    return true
  }

  if (isExtensionLocalEventLogUpdatedMessage(message)) {
    if (sender.id !== chrome.runtime.id || !isNokeySender(sender)) {
      const nookTypedArgs0_11: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'forbidden-sender',
      }
      sendResponse(nookTypedArgs0_11)
      return false
    }
    const nookTypedArgs0_12: Parameters<typeof importLocalEventLogUpdate>[0] = {
      vaultStoreId: message.payload.vaultStoreId,
      eventLogRecords: message.payload.eventLogRecords,
    }
    void importLocalEventLogUpdate(nookTypedArgs0_12).then(sendResponse)
    return true
  }

  if (isQueryActiveTabLoginDetectionMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      const nookTypedArgs0_13: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'forbidden-sender',
      }
      sendResponse(nookTypedArgs0_13)
      return false
    }
    void queryActiveTabLoginDetection()
      .then(sendResponse)
      .catch(() => {
        const nookArrowArgs38: Parameters<typeof sendResponse>[0] = {
          ok: true,
          status: LoginDetectionStatus.Unavailable,
        } satisfies LoginDetectionResponse
        return sendResponse(nookArrowArgs38)
      })
    return true
  }

  if (isOpenSimpleVaultMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      const nookTypedArgs0_14: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'forbidden-sender',
      }
      sendResponse(nookTypedArgs0_14)
      return false
    }
    openSimpleVault()
    const nookTypedArgs0_15: Parameters<typeof sendResponse>[0] = { ok: true }
    sendResponse(nookTypedArgs0_15)
    return false
  }

  if (isOpenCompanionLauncherMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      const nookTypedArgs0_16: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'forbidden-sender',
      }
      sendResponse(nookTypedArgs0_16)
      return false
    }
    void openCompanionLauncher(message.payload?.intent)
      .then(() => {
        const nookArrowArgs39: Parameters<typeof sendResponse>[0] = { ok: true }
        return sendResponse(nookArrowArgs39)
      })
      .catch(() => {
        const nookArrowArgs40: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'launcher-failed',
        }
        return sendResponse(nookArrowArgs40)
      })
    return true
  }

  if (isBeginExtensionPairingMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      const nookTypedArgs0_17: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'forbidden-sender',
      }
      sendResponse(nookTypedArgs0_17)
      return false
    }
    void openExtensionPairing(message.payload)
      .then(() => {
        const nookArrowArgs41: Parameters<typeof sendResponse>[0] = { ok: true }
        return sendResponse(nookArrowArgs41)
      })
      .catch(() => {
        const nookArrowArgs42: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'pairing-launch-failed',
        }
        return sendResponse(nookArrowArgs42)
      })
    return true
  }

  return false
})

chrome.runtime.onMessageExternal.addListener(
  // eslint-disable-next-line max-params -- Chrome owns the external listener callback signature.
  (runtimeMessage, sender, sendResponse) => {
    if (!runtimeMessage || typeof runtimeMessage !== 'object') return false
    const message = runtimeMessage as object
    if (isOpenCompanionLauncherMessage(message)) {
      if (!isNokeySender(sender)) {
        const nookTypedArgs0_18: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'forbidden-sender',
        }
        sendResponse(nookTypedArgs0_18)
        return false
      }
      void openCompanionLauncher(message.payload?.intent)
        .then(() => {
          const nookArrowArgs43: Parameters<typeof sendResponse>[0] = {
            ok: true,
          }
          return sendResponse(nookArrowArgs43)
        })
        .catch(() => {
          const nookArrowArgs44: Parameters<typeof sendResponse>[0] = {
            ok: false,
            reason: 'launcher-failed',
          }
          return sendResponse(nookArrowArgs44)
        })
      return true
    }

    if (isExtensionPairedVaultIdentityDiscoveryMessage(message)) {
      if (!isNokeySender(sender)) {
        const nookTypedArgs0_19: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'forbidden-sender',
        }
        sendResponse(nookTypedArgs0_19)
        return false
      }
      void discoverPairedVaultIdentity(message).then(sendResponse)
      return true
    }

    if (isExtensionPairedVaultUnlockRequestMessage(message)) {
      if (!isNokeySender(sender)) {
        const nookTypedArgs0_20: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'forbidden-sender',
        }
        sendResponse(nookTypedArgs0_20)
        return false
      }
      void requestPairedVaultUnlock(message)
        .then(sendResponse)
        .catch(() => {
          const nookArrowArgs45: Parameters<typeof sendResponse>[0] = {
            ok: false,
            requestId: message.payload.requestId,
            vaultStoreId: message.payload.vaultStoreId,
            reason: 'unlock-launch-failed',
          }
          return sendResponse(nookArrowArgs45)
        })
      return true
    }

    if (isExtensionIdentityHandoffRequestMessage(message)) {
      if (!isNokeySender(sender)) {
        const nookTypedArgs0_21: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'forbidden-sender',
        }
        sendResponse(nookTypedArgs0_21)
        return false
      }
      void createIdentityHandoff(message).then(sendResponse)
      return true
    }

    if (isExtensionPairedVaultIdentityHandoffRequestMessage(message)) {
      if (!isNokeySender(sender)) {
        const nookTypedArgs0_22: Parameters<typeof sendResponse>[0] = {
          ok: false,
          reason: 'forbidden-sender',
        }
        sendResponse(nookTypedArgs0_22)
        return false
      }
      void createIdentityHandoff(message).then(sendResponse)
      return true
    }

    if (!hasPairingApprovedType(message) || !isNokeySender(sender)) {
      const nookTypedArgs0_23: Parameters<typeof sendResponse>[0] = {
        ok: false,
        reason: 'invalid-pairing-grant',
      }
      sendResponse(nookTypedArgs0_23)
      return false
    }

    void importPairingAfterCompanionReady(message).then(sendResponse)
    return true
  },
)
