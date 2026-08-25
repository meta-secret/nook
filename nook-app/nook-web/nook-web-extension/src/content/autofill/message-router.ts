import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import { ExtensionRuntimeRequestType } from '../../lib/extension-runtime-request-type'
import {
  isWebsiteAuthenticatorCanceledMessage,
  isWebsiteAuthenticatorSelectedMessage,
} from '../../lib/authenticator-picker-messages'
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
  WidgetHostKind,
  WidgetWorkflowRootKind,
  authenticationActionState,
  pickerState,
  scanState,
  widgetState,
} from './state'
import { removeWidget, translatedMessage } from './workflow-ui'

export function removeScannedWidget(): void {
  cancelPendingAuthenticatorPickerRequest()
  cancelPendingLoginPickerRequest()
  removeWidget()
}

// eslint-disable-next-line max-params -- Chrome owns the runtime listener callback signature.
chrome.runtime.onMessage.addListener((runtimeMessage, sender, sendResponse) => {
  if (!runtimeMessage || typeof runtimeMessage !== 'object') return false
  const message = runtimeMessage
  if (
    sender.id === chrome.runtime.id &&
    'type' in message &&
    message.type === ExtensionRuntimeRequestType.ClearAuthenticationSurface
  ) {
    scanState.invalidateCurrentResult()
    authenticationActionState.invalidate()
    widgetState.busy = false
    removeScannedWidget()
    const response: Parameters<typeof sendResponse>[0] = { ok: true }
    sendResponse(response)
    return false
  }
  if (
    sender.id === chrome.runtime.id &&
    'type' in message &&
    message.type === ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
  ) {
    scanState.invalidateCurrentResult()
    authenticationActionState.invalidate()
    widgetState.busy = false
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
    if (
      widgetState.host.kind === WidgetHostKind.Attached &&
      widgetState.renderedWorkflowRoot.kind === WidgetWorkflowRootKind.Assigned
    ) {
      widgetState.host.element.inert = true
    }
    scanState.schedule()
    const response: Parameters<typeof sendResponse>[0] = { ok: true }
    sendResponse(response)
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
    const nookTypedArgs0_0: Parameters<typeof setStatus>[0] = {
      description: pending.description,
      continueButton: pending.continueButton,
      text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetLoginPickerCanceled),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_0)
    if (pending.continueButton.isConnected && !pending.continueButton.hidden) {
      pending.continueButton.disabled = false
    }
    const nookTypedArgs0_1: Parameters<typeof sendResponse>[0] = { ok: true }
    sendResponse(nookTypedArgs0_1)
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
    const nookTypedArgs0_2: Parameters<typeof sendResponse>[0] = { ok: true }
    sendResponse(nookTypedArgs0_2)
    widgetState.busy = true
    const actionGeneration = authenticationActionState.begin()
    pending.continueButton.disabled = true
    const nookTypedArgs0_1: Parameters<typeof fillAndSubmitAccount>[0] = {
      account: message.payload.account,
      workflow: pending.workflow,
      step: pending.step,
      title: pending.title,
      description: pending.description,
      continueButton: pending.continueButton,
      actionGeneration,
    }
    void fillAndSubmitAccount(nookTypedArgs0_1).finally(() => {
      if (!authenticationActionState.isCurrent(actionGeneration)) return
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
    const nookTypedArgs0_2: Parameters<typeof setStatus>[0] = {
      description: pending.description,
      continueButton: pending.continueButton,
      text: translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorPickerCanceled,
      ),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_2)
    if (pending.continueButton.isConnected && !pending.continueButton.hidden) {
      pending.continueButton.disabled = false
    }
    const nookTypedArgs0_3: Parameters<typeof sendResponse>[0] = { ok: true }
    sendResponse(nookTypedArgs0_3)
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
  const nookTypedArgs0_4: Parameters<typeof sendResponse>[0] = { ok: true }
  sendResponse(nookTypedArgs0_4)
  widgetState.busy = true
  const actionGeneration = authenticationActionState.begin()
  pending.continueButton.disabled = true
  const nookTypedArgs0_3: Parameters<typeof fillAuthenticatorCode>[0] = {
    account: message.payload.account,
    workflow: pending.workflow,
    step: pending.step,
    title: pending.title,
    description: pending.description,
    continueButton: pending.continueButton,
    actionGeneration,
  }
  void fillAuthenticatorCode(nookTypedArgs0_3).finally(() => {
    if (!authenticationActionState.isCurrent(actionGeneration)) return
    widgetState.busy = false
    if (pending.continueButton.isConnected && !pending.continueButton.hidden) {
      pending.continueButton.disabled = false
    }
  })
  return false
})
