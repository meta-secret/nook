import type { ExternalValue } from '../lib/external-value'
import {
  isBeginExtensionPairingMessage,
  isExtensionIdentityHandoffRequestMessage,
  isExtensionLocalEventLogUpdatedMessage,
  isExtensionPairedVaultIdentityDiscoveryMessage,
  isExtensionPairedVaultIdentityHandoffRequestMessage,
  isExtensionPairedVaultUnlockRequestMessage,
  isExtensionPairingApprovedMessage,
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
import { setupStorageKey } from './pairing-grants'
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
  getPairingStorage,
  hasPairingApprovedType,
  isAuthorizedWebsiteSender,
  isNokeySender,
  openExtensionPairing,
  requestPairedVaultUnlock,
} from './service-worker/pairing-identity'
import {
  importApprovedPairing,
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

chrome.runtime.onMessage.addListener((runtimeMessage, sender, sendResponse) => {
  const message = runtimeMessage as ExternalValue
  if (isExtensionPairingStateQueryMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void getPairingStorage(setupStorageKey)
      .then((stored) =>
        sendResponse({ ok: true, setup: stored[setupStorageKey] }),
      )
      .catch(() =>
        sendResponse({ ok: false, reason: 'pairing-state-read-failed' }),
      )
    return true
  }

  if (isWebsiteLoginPickerOpenMessage(message)) {
    void openWebsiteLoginPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'login-picker-open-failed' }),
      )
    return true
  }

  if (isLoginPickerQueryMessage(message)) {
    void queryLoginPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          ok: false,
          reason: 'login-picker-query-failed',
        }),
      )
    return true
  }

  if (isLoginPickerSelectMessage(message)) {
    void selectLoginPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          ok: false,
          reason: 'login-picker-select-failed',
        }),
      )
    return true
  }

  if (isLoginPickerCancelMessage(message)) {
    void cancelLoginPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          ok: false,
          reason: 'login-picker-cancel-failed',
        }),
      )
    return true
  }

  if (isWebsiteAuthenticatorPickerOpenMessage(message)) {
    void openWebsiteAuthenticatorPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-picker-open-failed' }),
      )
    return true
  }

  if (isAuthenticatorPickerQueryMessage(message)) {
    void queryAuthenticatorPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          ok: false,
          reason: 'authenticator-picker-query-failed',
        }),
      )
    return true
  }

  if (isAuthenticatorPickerSelectMessage(message)) {
    void selectAuthenticatorPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          ok: false,
          reason: 'authenticator-picker-select-failed',
        }),
      )
    return true
  }

  if (isAuthenticatorPickerCancelMessage(message)) {
    void cancelAuthenticatorPicker(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          ok: false,
          reason: 'authenticator-picker-cancel-failed',
        }),
      )
    return true
  }

  if (isAuthenticationWorkflowSnapshotMessage(message)) {
    if (!isAuthorizedWebsiteSender(sender, message.payload.origin)) {
      sendResponse({ ok: false, reason: 'workflow-forbidden-origin' })
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
      .then((result) =>
        sendResponse(
          result.kind === AuthenticationWorkflowSnapshotKind.Matched
            ? { ok: true, snapshot: result.snapshot }
            : { ok: true },
        ),
      )
      .catch(() =>
        sendResponse({ ok: false, reason: 'workflow-snapshot-failed' }),
      )
    return true
  }

  if (isAuthenticationOutcomeClassifyMessage(message)) {
    void classifyAuthenticationOutcome(
      message.payload.observation,
      message.payload.timeoutMs,
    )
      .then((verdict) => sendResponse({ ok: true, verdict }))
      .catch(() =>
        sendResponse({ ok: false, reason: 'outcome-classify-failed' }),
      )
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
    if (
      !isAuthorizedWebsiteSender(
        sender,
        (message.payload as { origin: string }).origin,
      )
    ) {
      sendResponse({ ok: false, reason: 'generate-password-forbidden-origin' })
      return false
    }
    void generateSuggestedPassword()
      .then((password) => sendResponse({ ok: true, password }))
      .catch(() =>
        sendResponse({ ok: false, reason: 'generate-password-failed' }),
      )
    return true
  }

  if (isWebsitePasskeyOptionsMessage(message)) {
    void websitePasskeyOptions(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'passkey-options-failed' }),
      )
    return true
  }

  if (isWebsitePasskeyPerformMessage(message)) {
    void performWebsitePasskey(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'passkey-ceremony-failed' }),
      )
    return true
  }

  if (isWebsitePasskeyCancelMessage(message)) {
    void cancelWebsitePasskey(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: 'passkey-cancel-failed' }))
    return true
  }

  if (isWebsiteLoginOptionsMessage(message)) {
    void websiteLoginOptions(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: 'login-options-failed' }))
    return true
  }

  if (isWebsiteLoginRevealMessage(message)) {
    void websiteLoginFill(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: 'login-fill-failed' }))
    return true
  }

  if (isWebsiteLoginSaveOfferMessage(message)) {
    void websiteLoginSaveOffer(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'login-save-offer-failed' }),
      )
    return true
  }

  if (isWebsiteLoginSavePendingMessage(message)) {
    void websiteLoginSavePending(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'login-save-pending-failed' }),
      )
    return true
  }

  if (isWebsiteLoginSaveCommitMessage(message)) {
    void websiteLoginSaveCommit(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'login-save-commit-failed' }),
      )
    return true
  }

  if (isWebsiteLoginSaveDismissMessage(message)) {
    void websiteLoginSaveDismiss(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'login-save-dismiss-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorOptionsMessage(message)) {
    void websiteAuthenticatorOptions(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-options-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorFillMessage(message)) {
    void websiteAuthenticatorFill(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-fill-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollPreviewMessage(message)) {
    void websiteAuthenticatorEnrollPreview(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-preview-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollStageMessage(message)) {
    void websiteAuthenticatorEnrollStage(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-stage-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollCodeMessage(message)) {
    void websiteAuthenticatorEnrollCode(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-code-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollConfirmMessage(message)) {
    void websiteAuthenticatorEnrollConfirm(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-enroll-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollDismissMessage(message)) {
    void websiteAuthenticatorEnrollDismiss(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-dismiss-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorEnrollPendingMessage(message)) {
    void websiteAuthenticatorEnrollPending(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-pending-failed' }),
      )
    return true
  }

  if (isWebsiteAuthenticatorBackupAttachMessage(message)) {
    void websiteAuthenticatorBackupAttach(message, sender)
      .then(sendResponse)
      .catch(() =>
        sendResponse({ ok: false, reason: 'authenticator-backup-failed' }),
      )
    return true
  }

  if (isExtensionSessionEnsureMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void ensureExtensionSessionDocument()
      .then(() => sendResponse({ ok: true }))
      .catch(() =>
        sendResponse({ ok: false, reason: 'session-runtime-failed' }),
      )
    return true
  }

  if (isExtensionSessionLockMessage(message)) {
    const senderUrlAllowed =
      !('url' in sender) ||
      (typeof sender.url === 'string' &&
        sender.url.startsWith(chrome.runtime.getURL('')))
    const extensionSender = sender.id === chrome.runtime.id && senderUrlAllowed
    if (!extensionSender) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void closeExtensionSessionDocument()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, reason: 'session-lock-failed' }))
    return true
  }

  if (isExtensionSessionExpiryMessage(message)) {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.endsWith(`/${extensionSessionDocument}`)
    ) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void closeExtensionSessionDocument().then(() => sendResponse({ ok: true }))
    return true
  }

  if (
    hasPairingApprovedType(message) &&
    !isExtensionPairingApprovedMessage(message)
  ) {
    sendResponse({ ok: false, reason: 'invalid-pairing-grant' })
    return false
  }

  if (isExtensionPairingApprovedMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }

    void importApprovedPairing(message).then(sendResponse)
    return true
  }

  if (isExtensionLocalEventLogUpdatedMessage(message)) {
    if (sender.id !== chrome.runtime.id || !isNokeySender(sender)) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void importLocalEventLogUpdate(
      message.payload.vaultStoreId,
      message.payload.eventLogRecords,
    ).then(sendResponse)
    return true
  }

  if (isQueryActiveTabLoginDetectionMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void queryActiveTabLoginDetection()
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          ok: true,
          status: LoginDetectionStatus.Unavailable,
        } satisfies LoginDetectionResponse),
      )
    return true
  }

  if (isOpenSimpleVaultMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    openSimpleVault()
    sendResponse({ ok: true })
    return false
  }

  if (isOpenCompanionLauncherMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void openCompanionLauncher(message.payload?.intent)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, reason: 'launcher-failed' }))
    return true
  }

  if (isBeginExtensionPairingMessage(message)) {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: 'forbidden-sender' })
      return false
    }
    void openExtensionPairing(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, reason: 'pairing-launch-failed' }))
    return true
  }

  return false
})

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    if (isOpenCompanionLauncherMessage(message)) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void openCompanionLauncher(message.payload?.intent)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, reason: 'launcher-failed' }))
      return true
    }

    if (
      isExtensionPairedVaultIdentityDiscoveryMessage(message)
    ) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void discoverPairedVaultIdentity(message).then(sendResponse)
      return true
    }

    if (isExtensionPairedVaultUnlockRequestMessage(message)) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void requestPairedVaultUnlock(message)
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            ok: false,
            requestId: message.payload.requestId,
            vaultStoreId: message.payload.vaultStoreId,
            reason: 'unlock-launch-failed',
          }),
        )
      return true
    }

    if (isExtensionIdentityHandoffRequestMessage(message)) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void createIdentityHandoff(message).then(sendResponse)
      return true
    }

    if (
      isExtensionPairedVaultIdentityHandoffRequestMessage(
        message,
      )
    ) {
      if (!isNokeySender(sender)) {
        sendResponse({ ok: false, reason: 'forbidden-sender' })
        return false
      }
      void createIdentityHandoff(message).then(sendResponse)
      return true
    }

    if (
      !isExtensionPairingApprovedMessage(message) ||
      !isNokeySender(sender)
    ) {
      sendResponse({ ok: false, reason: 'invalid-pairing-grant' })
      return false
    }

    void importApprovedPairing(message).then(sendResponse)
    return true
  },
)
