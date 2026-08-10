import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { fillOneTimeCode } from '../../../../nook-web-shared/src/extension/password-forms'
import type { WebsiteAuthenticatorOption } from '../../lib/login-fill-messages'
import {
  type DecodedRuntimeMessageArgs,
  RuntimeMessageDeliveryKind,
  sendDecodedRuntimeMessage,
  sendRuntimeMessageWithoutResponse,
  setStatus,
} from './login-passkey-actions'
import { AuthenticatorPickerKind, pickerState, widgetState } from './state'
import type {
  AuthenticatorFillResponse,
  AuthenticatorOptionsResponse,
} from './workflow-ui'
import {
  isAuthenticatorFillResponse,
  isAuthenticatorOptionsResponse,
  setFlightProgress,
  translatedMessage,
} from './workflow-ui'

export async function fillAuthenticatorCode({
  account,
  workflow,
  step,
  title,
  description,
  continueButton,
}: {
  account: Pick<WebsiteAuthenticatorOption, 'vaultStoreId' | 'secretId'>
  workflow: PasswordFormObservation
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}): Promise<boolean> {
  const message: Parameters<typeof sendRuntimeMessageWithoutResponse>[0] = {
    type: 'nook:website-authenticator-fill',
    payload: {
      origin: location.origin,
      vaultStoreId: account.vaultStoreId,
      secretId: account.secretId,
    },
  }
  const sendArgs: DecodedRuntimeMessageArgs<AuthenticatorFillResponse> = {
    message,
    decode: isAuthenticatorFillResponse,
  }
  const delivery =
    await sendDecodedRuntimeMessage<AuthenticatorFillResponse>(sendArgs)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    const nookTypedArgs0_0: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 2,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
    }
    setFlightProgress(nookTypedArgs0_0)
    const nookTypedArgs0_1: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed,
      ),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_1)
    return false
  }
  const { response } = delivery
  if (response.ok !== true) {
    const nookTypedArgs0_2: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 2,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
    }
    setFlightProgress(nookTypedArgs0_2)
    const nookTypedArgs0_3: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed,
      ),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_3)
    return false
  }
  const codeValue = response.code
  const code = { value: codeValue }
  response.code = ''
  const nookTypedArgs0_4: Parameters<typeof fillOneTimeCode>[0] = {
    code: code.value,
    root: workflow.root,
    formScope: workflow.formScope,
  }
  const filled = fillOneTimeCode(nookTypedArgs0_4)
  code.value = ''
  if (!filled) {
    const nookTypedArgs0_5: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 2,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
    }
    setFlightProgress(nookTypedArgs0_5)
    const nookTypedArgs0_6: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed,
      ),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_6)
    return false
  }
  const nookTypedArgs0_7: Parameters<typeof setFlightProgress>[0] = {
    step,
    title,
    currentStep: 2,
    totalSteps: 3,
    titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
  }
  setFlightProgress(nookTypedArgs0_7)
  description.textContent = translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFilled,
  )
  continueButton.hidden = true
  return true
}

export async function continueWithAuthenticator({
  workflow,
  step,
  title,
  description,
  continueButton,
}: {
  workflow: PasswordFormObservation
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}): Promise<void> {
  if (
    widgetState.busy ||
    pickerState.authenticator.kind === AuthenticatorPickerKind.Open
  ) {
    return
  }
  widgetState.busy = true
  continueButton.disabled = true
  const nookTypedArgs0_8: Parameters<typeof setFlightProgress>[0] = {
    step,
    title,
    currentStep: 2,
    totalSteps: 3,
    titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
  }
  setFlightProgress(nookTypedArgs0_8)
  const nookTypedArgs0_9: Parameters<typeof setStatus>[0] = {
    description,
    continueButton,
    text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorWorking),
    enableContinue: false,
  }
  setStatus(nookTypedArgs0_9)

  try {
    const message = {
      type: 'nook:website-authenticator-picker-open',
      payload: { origin: location.origin },
    }
    const sendArgs: DecodedRuntimeMessageArgs<AuthenticatorOptionsResponse> = {
      message,
      decode: isAuthenticatorOptionsResponse,
    }
    const delivery =
      await sendDecodedRuntimeMessage<AuthenticatorOptionsResponse>(sendArgs)
    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      !delivery.response?.ok
    ) {
      const nookTypedArgs0_10: Parameters<typeof setFlightProgress>[0] = {
        step,
        title,
        currentStep: 2,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      }
      setFlightProgress(nookTypedArgs0_10)
      const nookTypedArgs0_11: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed,
        ),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_11)
      return
    }
    const { response } = delivery
    if (response.status === 'locked') {
      const nookTypedArgs0_12: Parameters<typeof setFlightProgress>[0] = {
        step,
        title,
        currentStep: 2,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      }
      setFlightProgress(nookTypedArgs0_12)
      const nookTypedArgs0_13: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorUnlock),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_13)
      return
    }

    if (response.status === 'unavailable') {
      const nookTypedArgs0_14: Parameters<typeof setFlightProgress>[0] = {
        step,
        title,
        currentStep: 2,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      }
      setFlightProgress(nookTypedArgs0_14)
      const nookTypedArgs0_15: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetConnectVault),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_15)
      return
    }

    if (
      !response.requestId ||
      typeof response.expiresAt !== 'number' ||
      response.expiresAt <= Date.now()
    ) {
      const nookTypedArgs0_16: Parameters<typeof setFlightProgress>[0] = {
        step,
        title,
        currentStep: 2,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      }
      setFlightProgress(nookTypedArgs0_16)
      const nookTypedArgs0_17: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed,
        ),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_17)
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
        const nookTypedArgs0_18: Parameters<typeof setStatus>[0] = {
          description: pending.description,
          continueButton: pending.continueButton,
          text: translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed,
          ),
          enableContinue: true,
        }
        setStatus(nookTypedArgs0_18)
        if (
          pending.continueButton.isConnected &&
          !pending.continueButton.hidden
        ) {
          pending.continueButton.disabled = false
        }
      },
      Math.max(0, response.expiresAt - Date.now()),
    )
    const nookTypedArgs0_2: Parameters<
      typeof pickerState.openAuthenticator
    >[0] = {
      requestId: response.requestId,
      workflow,
      step,
      title,
      description,
      continueButton,
      timeoutId,
    }
    pickerState.openAuthenticator(nookTypedArgs0_2)
    const nookTypedArgs0_19: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 2,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
    }
    setFlightProgress(nookTypedArgs0_19)
    const nookTypedArgs0_20: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorPickerOpened,
      ),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_20)
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
  const message: Parameters<typeof sendRuntimeMessageWithoutResponse>[0] = {
    type: 'nook:authenticator-picker-cancel',
    payload: { requestId },
  }
  sendRuntimeMessageWithoutResponse(message)
}

export function cancelPendingAuthenticatorPickerRequest(): void {
  if (pickerState.authenticator.kind === AuthenticatorPickerKind.Closed) return
  const pending = pickerState.authenticator.request
  pickerState.clearPendingAuthenticator()
  window.clearTimeout(pending.timeoutId)
  cancelAuthenticatorPickerRequest(pending.requestId)
}
