import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { fillOneTimeCode } from '../../../../nook-web-shared/src/extension/password-forms'
import type { WebsiteAuthenticatorOption } from '../../lib/login-fill-messages'
import { sendRuntimeMessage, setStatus } from './login-passkey-actions'
import { pickerState, widgetState } from './state'
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
  const response = await sendRuntimeMessage<AuthenticatorFillResponse>({
    type: 'nook:website-authenticator-fill',
    payload: {
      origin: location.origin,
      vaultStoreId: account.vaultStoreId,
      secretId: account.secretId,
    },
  })
  if (!response?.ok || !response.code) {
    setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
    setStatus(
      description,
      continueButton,
      translatedMessage('widgetAuthenticatorFillFailed'),
      true,
    )
    return false
  }
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
  if (widgetState.busy || pickerState.pendingAuthenticator) return
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
    const response = await sendRuntimeMessage<AuthenticatorOptionsResponse>({
      type: 'nook:website-authenticator-picker-open',
      payload: { origin: location.origin },
    })
    if (!response?.ok) {
      setFlightProgress(step, title, 2, 3, 'widgetAuthenticatorTitle')
      setStatus(
        description,
        continueButton,
        translatedMessage('widgetAuthenticatorFillFailed'),
        true,
      )
      return
    }
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
        if (pickerState.pendingAuthenticator?.requestId !== requestId) return
        const pending = pickerState.pendingAuthenticator
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
    pickerState.pendingAuthenticator = {
      requestId: response.requestId,
      workflow,
      step,
      title,
      description,
      continueButton,
      timeoutId,
    }
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
      !pickerState.pendingAuthenticator &&
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
  const pending = pickerState.pendingAuthenticator
  if (!pending) return
  pickerState.clearPendingAuthenticator()
  window.clearTimeout(pending.timeoutId)
  cancelAuthenticatorPickerRequest(pending.requestId)
}
