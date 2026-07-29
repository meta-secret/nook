import { summarizeAuthenticationWorkflowForms } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  isWebsiteAuthenticatorCanceledMessage,
  isWebsiteAuthenticatorSelectedMessage,
} from '../../lib/authenticator-picker-messages'
import {
  isQueryLoginDetectionMessage,
  LoginDetectionStatus,
} from '../../lib/login-detection-messages'
import {
  isWebsiteLoginCanceledMessage,
  isWebsiteLoginSelectedMessage,
} from '../../lib/login-picker-messages'
import {
  cancelPendingAuthenticatorPickerRequest,
  fillAuthenticatorCode,
} from './authenticator-actions'
import {
  cancelPendingLoginPickerRequest,
  fillAndSubmitAccount,
  setStatus,
} from './login-passkey-actions'
import {
  AuthenticatorPickerKind,
  LoginPickerKind,
  pickerState,
  widgetState,
} from './state'
import { removeWidget, translatedMessage } from './workflow-ui'

export function removeScannedWidget(): void {
  cancelPendingAuthenticatorPickerRequest()
  cancelPendingLoginPickerRequest()
  removeWidget()
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    sender.id === chrome.runtime.id &&
    isQueryLoginDetectionMessage(message)
  ) {
    const detected = summarizeAuthenticationWorkflowForms().length > 0
    sendResponse({
      ok: true,
      status: detected
        ? LoginDetectionStatus.Detected
        : LoginDetectionStatus.NotDetected,
    })
    return false
  }
  if (
    sender.id === chrome.runtime.id &&
    isWebsiteLoginCanceledMessage(message) &&
    message.payload.origin === location.origin &&
    pickerState.login.kind === LoginPickerKind.Open &&
    message.payload.requestId === pickerState.login.request.requestId
  ) {
    const pending = pickerState.login.request
    pickerState.clearPendingLogin()
    window.clearTimeout(pending.timeoutId)
    setStatus(
      pending.description,
      pending.continueButton,
      translatedMessage('widgetLoginPickerCanceled'),
      true,
    )
    if (pending.continueButton.isConnected && !pending.continueButton.hidden) {
      pending.continueButton.disabled = false
    }
    sendResponse({ ok: true })
    return false
  }
  if (
    sender.id === chrome.runtime.id &&
    isWebsiteLoginSelectedMessage(message) &&
    message.payload.origin === location.origin &&
    pickerState.login.kind === LoginPickerKind.Open &&
    message.payload.requestId === pickerState.login.request.requestId
  ) {
    const pending = pickerState.login.request
    pickerState.clearPendingLogin()
    window.clearTimeout(pending.timeoutId)
    sendResponse({ ok: true })
    widgetState.busy = true
    pending.continueButton.disabled = true
    void fillAndSubmitAccount(
      message.payload.account,
      pending.workflow,
      pending.step,
      pending.title,
      pending.description,
      pending.continueButton,
    ).finally(() => {
      widgetState.busy = false
      if (
        pending.continueButton.isConnected &&
        !pending.continueButton.hidden
      ) {
        pending.continueButton.disabled = false
      }
    })
    return false
  }
  if (
    sender.id === chrome.runtime.id &&
    isWebsiteAuthenticatorCanceledMessage(message) &&
    message.payload.origin === location.origin &&
    pickerState.authenticator.kind === AuthenticatorPickerKind.Open &&
    message.payload.requestId === pickerState.authenticator.request.requestId
  ) {
    const pending = pickerState.authenticator.request
    pickerState.clearPendingAuthenticator()
    window.clearTimeout(pending.timeoutId)
    setStatus(
      pending.description,
      pending.continueButton,
      translatedMessage('widgetAuthenticatorPickerCanceled'),
      true,
    )
    if (pending.continueButton.isConnected && !pending.continueButton.hidden) {
      pending.continueButton.disabled = false
    }
    sendResponse({ ok: true })
    return false
  }
  if (
    sender.id !== chrome.runtime.id ||
    !isWebsiteAuthenticatorSelectedMessage(message) ||
    message.payload.origin !== location.origin ||
    pickerState.authenticator.kind !== AuthenticatorPickerKind.Open ||
    message.payload.requestId !== pickerState.authenticator.request.requestId
  ) {
    return false
  }
  const pending = pickerState.authenticator.request
  pickerState.clearPendingAuthenticator()
  window.clearTimeout(pending.timeoutId)
  sendResponse({ ok: true })
  widgetState.busy = true
  pending.continueButton.disabled = true
  void fillAuthenticatorCode(
    message.payload.account,
    pending.workflow,
    pending.step,
    pending.title,
    pending.description,
    pending.continueButton,
  ).finally(() => {
    widgetState.busy = false
    if (pending.continueButton.isConnected && !pending.continueButton.hidden) {
      pending.continueButton.disabled = false
    }
  })
  return false
})
