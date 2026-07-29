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
  if (
    delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
    !delivery.response?.ok ||
    !delivery.response.code
  ) {
    setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetAuthenticatorFillFailed'),
      true,
    )
    return false
  }
  const { response } = delivery
  const code = { value: response.code }
  response.code = ''
  const filled = fillOneTimeCode(code.value, workflow.root, workflow.formScope)
  code.value = ''
  if (!filled) {
    setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetAuthenticatorFillFailed'),
      true,
    )
    return false
  }
  setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
  description.textContent = translatedMessage('widgetAuthenticatorFilled')
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
  setFlightProgress(step, title, 2, 3, 'widgetFillingTitle')
  setStatus(
    description,
    continueButton,
    translatedMessage('widgetAuthenticatorWorking'),
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
      setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetAuthenticatorFillFailed'),
        true,
      )
      return
    }
    const { response } = delivery
    if (response.status === 'locked') {
      setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetAuthenticatorUnlock'),
        true,
      )
      return
    }

    if (response.status === 'unavailable') {
      setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetConnectVault'),
        true,
      )
      return
    }

    if (
      !response.requestId ||
      typeof response.expiresAt !== 'number' ||
      response.expiresAt <= Date.now()
    ) {
      setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetAuthenticatorFillFailed'),
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
          translatedMessage('widgetAuthenticatorFillFailed'),
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
    setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetAuthenticatorPickerOpened'),
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
