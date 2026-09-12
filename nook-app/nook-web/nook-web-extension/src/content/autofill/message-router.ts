import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
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
  const dismissal = loginSaveInteraction.dismissPendingSaveOffer()
  removeScannedWidget()
  await dismissal
}

type AutofillMessageListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]

export const routeAutofillMessage: AutofillMessageListener =
  // eslint-disable-next-line max-params -- Chrome owns the runtime listener callback signature.
  (runtimeMessage, sender, sendResponse) => {
    if (!runtimeMessage || typeof runtimeMessage !== 'object') return false
    const message = runtimeMessage
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
    if (
      sender.id === chrome.runtime.id &&
      WebsiteLoginCanceledMessageSchema.is(message) &&
      message.payload.origin === location.origin
    ) {
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
      if (
        pending.continueButton.isConnected &&
        !pending.continueButton.hidden
      ) {
        pending.continueButton.disabled = false
      }
      const nookTypedArgs0_1: Parameters<typeof sendResponse>[0] = { ok: true }
      sendResponse(nookTypedArgs0_1)
      return false
    }
    if (
      sender.id === chrome.runtime.id &&
      WebsiteLoginSelectedMessageSchema.is(message) &&
      message.payload.origin === location.origin
    ) {
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
    if (
      sender.id === chrome.runtime.id &&
      WebsiteAuthenticatorCanceledMessageSchema.is(message) &&
      message.payload.origin === location.origin
    ) {
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
      if (
        pending.continueButton.isConnected &&
        !pending.continueButton.hidden
      ) {
        pending.continueButton.disabled = false
      }
      const nookTypedArgs0_3: Parameters<typeof sendResponse>[0] = { ok: true }
      sendResponse(nookTypedArgs0_3)
      return false
    }
    if (
      sender.id !== chrome.runtime.id ||
      !WebsiteAuthenticatorSelectedMessageSchema.is(message) ||
      message.payload.origin !== location.origin
    ) {
      return false
    }
    const taken = pickerState.takeAuthenticator(message.payload.requestId)
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
      account: message.payload.account,
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
