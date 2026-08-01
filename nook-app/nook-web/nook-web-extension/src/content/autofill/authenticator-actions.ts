import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { fillOneTimeCode } from '../../../../nook-web-shared/src/extension/password-forms'
import type { WebsiteAuthenticatorOption } from '../../lib/login-fill-messages'
import {
  RuntimeMessageDeliveryKind,
  sendRuntimeMessage,
  setStatus,
} from './login-passkey-actions'
import { AuthenticatorPickerKind, pickerState, widgetState } from './state'
import type {
  AuthenticatorFillResponse,
  AuthenticatorOptionsResponse,
} from './workflow-ui'
import { setFlightProgress, translatedMessage } from './workflow-ui'

export async function fillAuthenticatorCode(
  account: Pick<WebsiteAuthenticatorOption, 'vaultStoreId' | 'secretId'>,
  workflow: PasswordFormObservation,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
): Promise<boolean> {
  const delivery = await sendRuntimeMessage<AuthenticatorFillResponse>({
    type: 'nook:website-authenticator-fill',
    payload: {
      origin: location.origin,
      vaultStoreId: account.vaultStoreId,
      secretId: account.secretId,
    },
  })
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    setFlightProgress(
      step,
      title,
      2,
      3,
      BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
    )
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed),
      true,
    )
    return false
  }
  const { response } = delivery
  const codeValue = response.code
  if (
    response.ok !== true ||
    typeof codeValue !== 'string' ||
    codeValue.length === 0
  ) {
    setFlightProgress(
      step,
      title,
      2,
      3,
      BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
    )
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed),
      true,
    )
    return false
  }
  const code = { value: codeValue }
  response.code = ''
  const filled = fillOneTimeCode(code.value, workflow.root, workflow.formScope)
  code.value = ''
  if (!filled) {
    setFlightProgress(
      step,
      title,
      2,
      3,
      BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
    )
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed),
      true,
    )
    return false
  }
  setFlightProgress(
    step,
    title,
    2,
    3,
    BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
  )
  description.textContent = translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFilled,
  )
  continueButton.hidden = true
  return true
}

export async function continueWithAuthenticator(
  workflow: PasswordFormObservation,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
): Promise<void> {
  if (
    widgetState.busy ||
    pickerState.authenticator.kind === AuthenticatorPickerKind.Open
  ) {
    return
  }
  widgetState.busy = true
  continueButton.disabled = true
  setFlightProgress(step, title, 2, 3, BROWSER_MESSAGE_KEYS.WidgetFillingTitle)
  setStatus(
    description,
    continueButton,
    translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorWorking),
    false,
  )

  try {
    const delivery = await sendRuntimeMessage<AuthenticatorOptionsResponse>({
      type: 'nook:website-authenticator-picker-open',
      payload: { origin: location.origin },
    })
    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      !delivery.response?.ok
    ) {
      setFlightProgress(
        step,
        title,
        2,
        3,
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      )
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed),
        true,
      )
      return
    }
    const { response } = delivery
    if (response.status === 'locked') {
      setFlightProgress(
        step,
        title,
        2,
        3,
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      )
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorUnlock),
        true,
      )
      return
    }

    if (response.status === 'unavailable') {
      setFlightProgress(
        step,
        title,
        2,
        3,
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      )
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetConnectVault),
        true,
      )
      return
    }

    if (
      !response.requestId ||
      typeof response.expiresAt !== 'number' ||
      response.expiresAt <= Date.now()
    ) {
      setFlightProgress(
        step,
        title,
        2,
        3,
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      )
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed),
        true,
      )
      return
    }
    const requestId = response.requestId
    if (widgetState.dismissed || !continueButton.isConnected) {
      cancelAuthenticatorPickerRequest(requestId)
      return
    }
    const timeoutId = window.setTimeout(
      () => {
        if (
          pickerState.authenticator.kind !== AuthenticatorPickerKind.Open ||
          pickerState.authenticator.request.requestId !== requestId
        ) {
          return
        }
        const pending = pickerState.authenticator.request
        pickerState.clearPendingAuthenticator()
        setStatus(
          pending.description,
          pending.continueButton,
          translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed),
          true,
        )
        if (
          pending.continueButton.isConnected &&
          !pending.continueButton.hidden
        ) {
          pending.continueButton.disabled = false
        }
      },
      Math.max(0, response.expiresAt - Date.now()),
    )
    pickerState.openAuthenticator({
      requestId: response.requestId,
      workflow,
      step,
      title,
      description,
      continueButton,
      timeoutId,
    })
    setFlightProgress(
      step,
      title,
      2,
      3,
      BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
    )
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorPickerOpened),
      true,
    )
  } finally {
    widgetState.busy = false
    if (
      pickerState.authenticator.kind === AuthenticatorPickerKind.Closed &&
      continueButton.isConnected &&
      !continueButton.hidden
    ) {
      continueButton.disabled = false
    }
  }
}

function cancelAuthenticatorPickerRequest(requestId: string): void {
  void sendRuntimeMessage({
    type: 'nook:authenticator-picker-cancel',
    payload: { requestId },
  })
}

export function cancelPendingAuthenticatorPickerRequest(): void {
  if (pickerState.authenticator.kind === AuthenticatorPickerKind.Closed) return
  const pending = pickerState.authenticator.request
  pickerState.clearPendingAuthenticator()
  window.clearTimeout(pending.timeoutId)
  cancelAuthenticatorPickerRequest(pending.requestId)
}
