import {
  FocusedPickerOwnership,
  focusedCredentialInteraction,
} from './focused-credential-interaction'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import { Schema } from 'effect'
import { LoginPickerPageVerification } from '../../lib/inline-login-picker'
import { LoginPickerPageVerificationReceiver } from './login-picker-page-verification'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../../lib/concrete-decoder'
import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import { ExtensionRuntimeRequestType } from '../../lib/extension-runtime-request-type'
import {
  WebsiteAuthenticatorCanceledMessage as WebsiteAuthenticatorCanceledMessageSchema,
  WebsiteAuthenticatorSelectedMessage as WebsiteAuthenticatorSelectedMessageSchema,
} from '../../lib/authenticator-picker-messages'
import {
  WebsiteLoginCanceledMessage as WebsiteLoginCanceledMessageSchema,
  WebsiteLoginSelectedMessage as WebsiteLoginSelectedMessageSchema,
} from '../../lib/login-picker-messages'
import { authenticatorInteraction } from './authenticator-actions'
import {
  loginPasskeyInteraction,
  authenticationWorkflowUi,
} from './login-passkey-actions'
import { loginSaveInteraction } from './login-save'
import {
  PendingPickerTakeKind,
  pickerState,
  scanState,
  widgetState,
} from './state'
import { workflowUi } from './workflow-ui'

export function removeScannedWidget(): void {
  authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
  loginPasskeyInteraction.cancelPendingLoginPickerRequest()
  workflowUi.removeWidget()
}

async function clearAuthenticationSurface(): Promise<void> {
  focusedCredentialInteraction.clear()
  const dismissal = loginSaveInteraction.dismissPendingSaveOffer()
  removeScannedWidget()
  await dismissal
}

type AutofillMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]
type AutofillMessageDelivery = [
  runtimeMessage: BrowserRuntimeMessageValue,
  sender: chrome.runtime.MessageSender,
  sendResponse: Parameters<AutofillMessageListener>[2],
]

export const routeAutofillMessage: AutofillMessageListener = (
  ...[runtimeMessage, sender, sendResponse]: AutofillMessageDelivery
) => {
  if (!runtimeMessage || typeof runtimeMessage !== 'object') return false
  const message = runtimeMessage
  const verification = Schema.decodeUnknownExit(LoginPickerPageVerification)(
    message,
  )
  switch (verification._tag) {
    case 'Failure':
      break
    case 'Success': {
      const delivery: Parameters<
        LoginPickerPageVerificationReceiver['receive']
      >[0] = { message: verification.value, sender, sendResponse }
      return new LoginPickerPageVerificationReceiver().receive(delivery)
    }
  }
  if (
    sender.id === chrome.runtime.id &&
    'type' in message &&
    message.type === ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces
  ) {
    scanState.sequence += 1
    widgetState.busy = false
    void clearAuthenticationSurface()
      .then(() => {
        scanState.schedule()
        const response: Parameters<typeof sendResponse>[0] = { ok: true }
        sendResponse(response)
      })
      .catch(() => {
        const response: Parameters<typeof sendResponse>[0] = { ok: false }
        sendResponse(response)
      })
    return true
  }
  const loginCanceled = runConcreteDecoder(
    WebsiteLoginCanceledMessageSchema.decode,
    message,
  )
  if (
    sender.id === chrome.runtime.id &&
    loginCanceled.kind === ConcreteDecoderResultKind.Decoded &&
    loginCanceled.value.payload.origin === location.origin
  ) {
    const message = loginCanceled.value
    switch (
      focusedCredentialInteraction.ownsPicker(message.payload.requestId)
    ) {
      case FocusedPickerOwnership.Owned: {
        focusedCredentialInteraction.cancelPicker()
        const response: Parameters<typeof sendResponse>[0] = { ok: true }
        sendResponse(response)
        return false
      }
      case FocusedPickerOwnership.Unowned:
        break
    }
    const taken = pickerState.takeLogin(message.payload.requestId)
    if (taken.kind !== PendingPickerTakeKind.Taken) return false
    const pending = taken.request
    window.clearTimeout(pending.timeoutId)
    const nookTypedArgs0_0: Parameters<
      typeof authenticationWorkflowUi.setStatus
    >[0] = {
      description: pending.description,
      continueButton: pending.continueButton,
      text: workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetLoginPickerCanceled,
      ),
      enableContinue: true,
    }
    authenticationWorkflowUi.setStatus(nookTypedArgs0_0)
    if (pending.continueButton.isConnected && !pending.continueButton.hidden) {
      pending.continueButton.disabled = false
    }
    const nookTypedArgs0_1: Parameters<typeof sendResponse>[0] = { ok: true }
    sendResponse(nookTypedArgs0_1)
    return false
  }
  const loginSelected = runConcreteDecoder(
    WebsiteLoginSelectedMessageSchema.decode,
    message,
  )
  if (
    sender.id === chrome.runtime.id &&
    loginSelected.kind === ConcreteDecoderResultKind.Decoded &&
    loginSelected.value.payload.origin === location.origin
  ) {
    const message = loginSelected.value
    switch (
      focusedCredentialInteraction.ownsPicker(message.payload.requestId)
    ) {
      case FocusedPickerOwnership.Owned: {
        void focusedCredentialInteraction.select(message)
        const response: Parameters<typeof sendResponse>[0] = { ok: true }
        sendResponse(response)
        return false
      }
      case FocusedPickerOwnership.Unowned:
        break
    }
    const taken = pickerState.takeLogin(message.payload.requestId)
    if (taken.kind !== PendingPickerTakeKind.Taken) return false
    const pending = taken.request
    window.clearTimeout(pending.timeoutId)
    const nookTypedArgs0_2: Parameters<typeof sendResponse>[0] = { ok: true }
    sendResponse(nookTypedArgs0_2)
    widgetState.busy = true
    pending.continueButton.disabled = true
    const nookTypedArgs0_1: Parameters<
      typeof loginPasskeyInteraction.fillAndSubmitAccount
    >[0] = {
      account: message.payload.account,
      workflow: pending.workflow,
      approval: pending.approval,
      step: pending.step,
      title: pending.title,
      description: pending.description,
      continueButton: pending.continueButton,
    }
    void loginPasskeyInteraction
      .fillAndSubmitAccount(nookTypedArgs0_1)
      .finally(() => {
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
  const authenticatorCanceled = runConcreteDecoder(
    WebsiteAuthenticatorCanceledMessageSchema.decode,
    message,
  )
  if (
    sender.id === chrome.runtime.id &&
    authenticatorCanceled.kind === ConcreteDecoderResultKind.Decoded &&
    authenticatorCanceled.value.payload.origin === location.origin
  ) {
    const message = authenticatorCanceled.value
    const taken = pickerState.takeAuthenticator(message.payload.requestId)
    if (taken.kind !== PendingPickerTakeKind.Taken) return false
    const pending = taken.request
    window.clearTimeout(pending.timeoutId)
    const nookTypedArgs0_2: Parameters<
      typeof authenticationWorkflowUi.setStatus
    >[0] = {
      description: pending.description,
      continueButton: pending.continueButton,
      text: workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorPickerCanceled,
      ),
      enableContinue: true,
    }
    authenticationWorkflowUi.setStatus(nookTypedArgs0_2)
    if (pending.continueButton.isConnected && !pending.continueButton.hidden) {
      pending.continueButton.disabled = false
    }
    const nookTypedArgs0_3: Parameters<typeof sendResponse>[0] = { ok: true }
    sendResponse(nookTypedArgs0_3)
    return false
  }
  const authenticatorSelected = runConcreteDecoder(
    WebsiteAuthenticatorSelectedMessageSchema.decode,
    message,
  )
  if (
    sender.id !== chrome.runtime.id ||
    authenticatorSelected.kind === ConcreteDecoderResultKind.Rejected ||
    authenticatorSelected.value.payload.origin !== location.origin
  ) {
    return false
  }
  const selectedMessage = authenticatorSelected.value
  const taken = pickerState.takeAuthenticator(selectedMessage.payload.requestId)
  if (taken.kind !== PendingPickerTakeKind.Taken) return false
  const pending = taken.request
  window.clearTimeout(pending.timeoutId)
  const nookTypedArgs0_4: Parameters<typeof sendResponse>[0] = { ok: true }
  sendResponse(nookTypedArgs0_4)
  widgetState.busy = true
  pending.continueButton.disabled = true
  const nookTypedArgs0_3: Parameters<
    typeof authenticatorInteraction.fillAuthenticatorCode
  >[0] = {
    account: selectedMessage.payload.account,
    workflow: pending.workflow,
    approval: pending.approval,
    step: pending.step,
    title: pending.title,
    description: pending.description,
    continueButton: pending.continueButton,
  }
  void authenticatorInteraction
    .fillAuthenticatorCode(nookTypedArgs0_3)
    .finally(() => {
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
chrome.runtime.onMessage.addListener(routeAutofillMessage)
