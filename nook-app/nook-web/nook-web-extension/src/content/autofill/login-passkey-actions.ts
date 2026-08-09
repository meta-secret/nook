import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  fillGeneratedPassword,
  fillLoginCredentials,
  findPasskeyControl,
  PasskeyControlLookupKind,
  submitLoginForm,
} from '../../../../nook-web-shared/src/extension/password-forms'
import type { WebsiteLoginAccountOption } from '../../lib/login-fill-messages'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { LoginPickerKind, pickerState, widgetState } from './state'
import type {
  LoginFillResponse,
  LoginOptionsResponse,
  LoginPickerOpenResponse,
} from './workflow-ui'
import { setFlightProgress, translatedMessage } from './workflow-ui'

export type PasskeyWidgetAction =
  | AuthenticationWorkflowAction.UsePasskey
  | AuthenticationWorkflowAction.CreatePasskey

export enum RuntimeMessageDeliveryKind {
  Delivered = 'delivered',
  Unavailable = 'unavailable',
}

export type RuntimeMessageDelivery<T> =
  | { kind: RuntimeMessageDeliveryKind.Delivered; response: T }
  | { kind: RuntimeMessageDeliveryKind.Unavailable }

export function sendRuntimeMessage<T>(
  message: unknown,
): Promise<RuntimeMessageDelivery<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        const nookTypedArgs0_0: Parameters<typeof resolve>[0] = {
          kind: RuntimeMessageDeliveryKind.Unavailable,
        }
        resolve(nookTypedArgs0_0)
        return
      }
      const nookTypedArgs0_1: Parameters<typeof resolve>[0] = {
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: response as T,
      }
      resolve(nookTypedArgs0_1)
    })
  })
}

export function setStatus({
  description,
  continueButton,
  text,
  enableContinue,
}: {
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  text: string
  enableContinue: boolean
}): void {
  description.textContent = text
  continueButton.disabled = !enableContinue || widgetState.busy
}

export async function fillAndSubmitAccount({
  account,
  workflow,
  step,
  title,
  description,
  continueButton,
}: {
  account: Pick<WebsiteLoginAccountOption, 'vaultStoreId' | 'secretId'>
  workflow: PasswordFormObservation
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}): Promise<boolean> {
  const nookTypedArgs0_2: Parameters<typeof sendRuntimeMessage>[0] = {
    type: 'nook:website-login-fill',
    payload: {
      origin: location.origin,
      vaultStoreId: account.vaultStoreId,
      secretId: account.secretId,
    },
  }
  const delivery = await sendRuntimeMessage<LoginFillResponse>(nookTypedArgs0_2)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    const nookTypedArgs0_0: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 1,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
    }
    setFlightProgress(nookTypedArgs0_0)
    const nookTypedArgs0_1: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_1)
    return false
  }
  const { response } = delivery
  if (
    !response?.ok ||
    !response.username ||
    typeof response.password !== 'string'
  ) {
    const nookTypedArgs0_2: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 1,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
    }
    setFlightProgress(nookTypedArgs0_2)
    const nookTypedArgs0_3: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_3)
    return false
  }

  const credentials = {
    username: response.username,
    password: response.password,
  }
  response.password = ''
  const nookTypedArgs0_4: Parameters<typeof fillLoginCredentials>[0] = {
    credentials,
    root: workflow.root,
    formScope: workflow.formScope,
  }
  const filled = fillLoginCredentials(nookTypedArgs0_4)
  credentials.password = ''
  credentials.username = ''
  if (!filled) {
    const nookTypedArgs0_5: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 1,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
    }
    setFlightProgress(nookTypedArgs0_5)
    const nookTypedArgs0_6: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_6)
    return false
  }
  const nookTypedArgs0_7: Parameters<typeof submitLoginForm>[0] = {
    root: workflow.root,
    formScope: workflow.formScope,
  }
  if (!submitLoginForm(nookTypedArgs0_7)) {
    const nookTypedArgs0_8: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 2,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
    }
    setFlightProgress(nookTypedArgs0_8)
    description.textContent = translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetFilledManual,
    )
    continueButton.hidden = true
    return true
  }
  const nookTypedArgs0_9: Parameters<typeof setFlightProgress>[0] = {
    step,
    title,
    currentStep: 3,
    totalSteps: 3,
    titleKey: BROWSER_MESSAGE_KEYS.WidgetVerifyingTitle,
  }
  setFlightProgress(nookTypedArgs0_9)
  description.textContent = translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetSubmitted,
  )
  continueButton.hidden = true
  return true
}

async function openLoginPicker({
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
  if (pickerState.login.kind === LoginPickerKind.Open) return
  const nookTypedArgs0_3: Parameters<typeof sendRuntimeMessage>[0] = {
    type: 'nook:website-login-picker-open',
    payload: { origin: location.origin },
  }
  const delivery =
    await sendRuntimeMessage<LoginPickerOpenResponse>(nookTypedArgs0_3)
  if (
    delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
    !delivery.response?.ok
  ) {
    const nookTypedArgs0_10: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 1,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
    }
    setFlightProgress(nookTypedArgs0_10)
    const nookTypedArgs0_11: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
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
      currentStep: 1,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
    }
    setFlightProgress(nookTypedArgs0_12)
    const nookTypedArgs0_13: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_13)
    return
  }
  if (response.status === 'unavailable') {
    const nookTypedArgs0_14: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 1,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
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
      currentStep: 1,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
    }
    setFlightProgress(nookTypedArgs0_16)
    const nookTypedArgs0_17: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_17)
    return
  }
  const requestId = response.requestId
  if (widgetState.dismissed || !continueButton.isConnected) {
    cancelLoginPickerRequest(requestId)
    return
  }
  const timeoutId = window.setTimeout(
    () => {
      if (
        pickerState.login.kind !== LoginPickerKind.Open ||
        pickerState.login.request.requestId !== requestId
      ) {
        return
      }
      const pending = pickerState.login.request
      pickerState.clearPendingLogin()
      const nookTypedArgs0_18: Parameters<typeof setStatus>[0] = {
        description: pending.description,
        continueButton: pending.continueButton,
        text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
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
  const nookTypedArgs0_4: Parameters<typeof pickerState.openLogin>[0] = {
    requestId,
    workflow,
    step,
    title,
    description,
    continueButton,
    timeoutId,
  }
  pickerState.openLogin(nookTypedArgs0_4)
  const nookTypedArgs0_19: Parameters<typeof setFlightProgress>[0] = {
    step,
    title,
    currentStep: 2,
    totalSteps: 3,
    titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
  }
  setFlightProgress(nookTypedArgs0_19)
  const nookTypedArgs0_20: Parameters<typeof setStatus>[0] = {
    description,
    continueButton,
    text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetLoginPickerOpened),
    enableContinue: true,
  }
  setStatus(nookTypedArgs0_20)
}

function cancelLoginPickerRequest(requestId: string): void {
  const nookTypedArgs0_5: Parameters<typeof sendRuntimeMessage>[0] = {
    type: 'nook:login-picker-cancel',
    payload: { requestId },
  }
  void sendRuntimeMessage(nookTypedArgs0_5)
}

export function cancelPendingLoginPickerRequest(): void {
  if (pickerState.login.kind === LoginPickerKind.Closed) return
  const pending = pickerState.login.request
  pickerState.clearPendingLogin()
  window.clearTimeout(pending.timeoutId)
  cancelLoginPickerRequest(pending.requestId)
}

export async function generatePasswordWithNook({
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
  if (widgetState.busy) return
  widgetState.busy = true
  continueButton.disabled = true
  const totalSteps = workflow.summary.currentPasswordFieldCount > 0 ? 4 : 5
  const nookTypedArgs0_21: Parameters<typeof setFlightProgress>[0] = {
    step,
    title,
    currentStep: 2,
    totalSteps,
    titleKey: copyTitleForWorkflow(workflow),
  }
  setFlightProgress(nookTypedArgs0_21)
  const nookTypedArgs0_22: Parameters<typeof setStatus>[0] = {
    description,
    continueButton,
    text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordWorking),
    enableContinue: false,
  }
  setStatus(nookTypedArgs0_22)
  try {
    const nookTypedArgs0_6: Parameters<typeof sendRuntimeMessage>[0] = {
      type: 'nook:website-generate-password',
      payload: { origin: location.origin },
    }
    const delivery = await sendRuntimeMessage<{
      ok?: boolean
      password?: string
      reason?: string
    }>(nookTypedArgs0_6)
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      const nookTypedArgs0_23: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
        ),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_23)
      return
    }
    const { response } = delivery
    if (response.ok !== true || typeof response.password !== 'string') {
      const nookTypedArgs0_24: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
        ),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_24)
      return
    }
    const password = response.password
    const nookTypedArgs0_25: Parameters<typeof fillGeneratedPassword>[0] = {
      password,
      root: workflow.root,
      formScope: workflow.formScope,
    }
    const filled = fillGeneratedPassword(nookTypedArgs0_25)
    if (!filled) {
      const nookTypedArgs0_26: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
        ),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_26)
      return
    }
    const nookTypedArgs0_27: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetGeneratedPasswordFilled,
      ),
      enableContinue: false,
    }
    setStatus(nookTypedArgs0_27)
    continueButton.hidden = true
  } finally {
    widgetState.busy = false
    continueButton.disabled = false
  }
}

export async function proposePasskeyWithNook({
  description,
  continueButton,
  action,
}: {
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  action: PasskeyWidgetAction
}): Promise<void> {
  if (widgetState.busy) return
  widgetState.busy = true
  continueButton.disabled = true
  const nookTypedArgs0_28: Parameters<typeof setStatus>[0] = {
    description,
    continueButton,
    text: translatedMessage(
      action === AuthenticationWorkflowAction.UsePasskey
        ? BROWSER_MESSAGE_KEYS.WidgetUsePasskeyWorking
        : BROWSER_MESSAGE_KEYS.WidgetCreatePasskeyWorking,
    ),
    enableContinue: false,
  }
  setStatus(nookTypedArgs0_28)
  try {
    const control = findPasskeyControl(document)
    if (control.kind === PasskeyControlLookupKind.Absent) {
      const nookTypedArgs0_29: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetPasskeyControlMissing,
        ),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_29)
      return
    }
    control.control.click()
    const nookTypedArgs0_30: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetPasskeyCeremonyStarted,
      ),
      enableContinue: false,
    }
    setStatus(nookTypedArgs0_30)
    continueButton.hidden = true
  } finally {
    widgetState.busy = false
    continueButton.disabled = false
  }
}

function copyTitleForWorkflow(
  workflow: PasswordFormObservation,
): BrowserMessageKey {
  if (
    workflow.summary.currentPasswordFieldCount > 0 &&
    workflow.summary.newPasswordFieldCount > 0
  ) {
    return BROWSER_MESSAGE_KEYS.WidgetPasswordChangeTitle
  }
  if (workflow.summary.newPasswordFieldCount > 0) {
    return BROWSER_MESSAGE_KEYS.WidgetSignupTitle
  }
  return BROWSER_MESSAGE_KEYS.WidgetLoginTitle
}

export async function continueWithNook({
  step,
  title,
  description,
  continueButton,
  workflow,
}: {
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  workflow: PasswordFormObservation
}): Promise<void> {
  if (widgetState.busy || pickerState.login.kind === LoginPickerKind.Open)
    return
  widgetState.busy = true
  continueButton.disabled = true
  const nookTypedArgs0_31: Parameters<typeof setFlightProgress>[0] = {
    step,
    title,
    currentStep: 2,
    totalSteps: 3,
    titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
  }
  setFlightProgress(nookTypedArgs0_31)
  const nookTypedArgs0_32: Parameters<typeof setStatus>[0] = {
    description,
    continueButton,
    text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetWorking),
    enableContinue: false,
  }
  setStatus(nookTypedArgs0_32)

  try {
    const nookTypedArgs0_7: Parameters<typeof sendRuntimeMessage>[0] = {
      type: 'nook:website-login-options',
      payload: { origin: location.origin },
    }
    const delivery =
      await sendRuntimeMessage<LoginOptionsResponse>(nookTypedArgs0_7)

    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      !delivery.response?.ok
    ) {
      const nookTypedArgs0_33: Parameters<typeof setFlightProgress>[0] = {
        step,
        title,
        currentStep: 1,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      }
      setFlightProgress(nookTypedArgs0_33)
      const nookTypedArgs0_34: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_34)
      return
    }
    const { response } = delivery

    if (response.status === 'locked') {
      const nookTypedArgs0_35: Parameters<typeof setFlightProgress>[0] = {
        step,
        title,
        currentStep: 1,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      }
      setFlightProgress(nookTypedArgs0_35)
      const nookTypedArgs0_36: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_36)
      return
    }

    if (response.status === 'unavailable') {
      const nookTypedArgs0_37: Parameters<typeof setFlightProgress>[0] = {
        step,
        title,
        currentStep: 1,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      }
      setFlightProgress(nookTypedArgs0_37)
      const nookTypedArgs0_38: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetConnectVault),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_38)
      return
    }

    const accounts = response.accounts ?? []
    if (accounts.length === 0) {
      const nookTypedArgs0_39: Parameters<typeof setFlightProgress>[0] = {
        step,
        title,
        currentStep: 1,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      }
      setFlightProgress(nookTypedArgs0_39)
      const nookTypedArgs0_40: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetNoMatch),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_40)
      return
    }

    if (accounts.length === 1) {
      const nookTypedArgs0_41: Parameters<typeof fillAndSubmitAccount>[0] = {
        account: accounts[0],
        workflow,
        step,
        title,
        description,
        continueButton,
      }
      await fillAndSubmitAccount(nookTypedArgs0_41)
      return
    }

    const nookTypedArgs0_42: Parameters<typeof openLoginPicker>[0] = {
      workflow,
      step,
      title,
      description,
      continueButton,
    }
    await openLoginPicker(nookTypedArgs0_42)
  } finally {
    widgetState.busy = false
    if (
      pickerState.login.kind === LoginPickerKind.Closed &&
      continueButton.isConnected &&
      !continueButton.hidden
    ) {
      continueButton.disabled = false
    }
  }
}
