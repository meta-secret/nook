import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  fillGeneratedPassword,
  fillLoginCredentials,
  findPasskeyControl,
  PasskeyControlLookupKind,
  submitLoginForm,
} from '../../../../nook-web-shared/src/extension/password-forms'
import type { WebsiteLoginAccountOption } from '../../lib/login-fill-messages'
import { LoginPickerKind, pickerState, widgetState } from './state'
import type {
  LoginFillResponse,
  LoginOptionsResponse,
  LoginPickerOpenResponse,
} from './workflow-ui'
import { setFlightProgress, translatedMessage } from './workflow-ui'

export enum PasskeyWidgetAction {
  UsePasskey = 'use-passkey',
  CreatePasskey = 'create-passkey',
}

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
        resolve({ kind: RuntimeMessageDeliveryKind.Unavailable })
        return
      }
      resolve({
        kind: RuntimeMessageDeliveryKind.Delivered,
        response: response as T,
      })
    })
  })
}

export function setStatus(
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  text: string,
  enableContinue: boolean,
): void {
  description.textContent = text
  continueButton.disabled = !enableContinue || widgetState.busy
}

export async function fillAndSubmitAccount(
  account: Pick<WebsiteLoginAccountOption, 'vaultStoreId' | 'secretId'>,
  workflow: PasswordFormObservation,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
): Promise<boolean> {
  const delivery = await sendRuntimeMessage<LoginFillResponse>({
    type: 'nook:website-login-fill',
    payload: {
      origin: location.origin,
      vaultStoreId: account.vaultStoreId,
      secretId: account.secretId,
    },
  })
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    setFlightProgress(step, title, 1, 3, BROWSER_MESSAGE_KEYS.WidgetLoginTitle)
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      true,
    )
    return false
  }
  const { response } = delivery
  if (
    !response?.ok ||
    !response.username ||
    typeof response.password !== 'string'
  ) {
    setFlightProgress(step, title, 1, 3, BROWSER_MESSAGE_KEYS.WidgetLoginTitle)
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      true,
    )
    return false
  }

  const credentials = {
    username: response.username,
    password: response.password,
  }
  response.password = ''
  const filled = fillLoginCredentials(
    credentials,
    workflow.root,
    workflow.formScope,
  )
  credentials.password = ''
  credentials.username = ''
  if (!filled) {
    setFlightProgress(step, title, 1, 3, BROWSER_MESSAGE_KEYS.WidgetLoginTitle)
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      true,
    )
    return false
  }
  if (!submitLoginForm(workflow.root, workflow.formScope)) {
    setFlightProgress(
      step,
      title,
      2,
      3,
      BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
    )
    description.textContent = translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetFilledManual,
    )
    continueButton.hidden = true
    return true
  }
  setFlightProgress(
    step,
    title,
    3,
    3,
    BROWSER_MESSAGE_KEYS.WidgetVerifyingTitle,
  )
  description.textContent = translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetSubmitted,
  )
  continueButton.hidden = true
  return true
}

async function openLoginPicker(
  workflow: PasswordFormObservation,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
): Promise<void> {
  if (pickerState.login.kind === LoginPickerKind.Open) return
  const delivery = await sendRuntimeMessage<LoginPickerOpenResponse>({
    type: 'nook:website-login-picker-open',
    payload: { origin: location.origin },
  })
  if (
    delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
    !delivery.response?.ok
  ) {
    setFlightProgress(step, title, 1, 3, BROWSER_MESSAGE_KEYS.WidgetLoginTitle)
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      true,
    )
    return
  }
  const { response } = delivery
  if (response.status === 'locked') {
    setFlightProgress(step, title, 1, 3, BROWSER_MESSAGE_KEYS.WidgetLoginTitle)
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue),
      true,
    )
    return
  }
  if (response.status === 'unavailable') {
    setFlightProgress(step, title, 1, 3, BROWSER_MESSAGE_KEYS.WidgetLoginTitle)
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
    setFlightProgress(step, title, 1, 3, BROWSER_MESSAGE_KEYS.WidgetLoginTitle)
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      true,
    )
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
      setStatus(
        pending.description,
        pending.continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
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
  pickerState.openLogin({
    requestId,
    workflow,
    step,
    title,
    description,
    continueButton,
    timeoutId,
  })
  setFlightProgress(step, title, 2, 3, BROWSER_MESSAGE_KEYS.WidgetFillingTitle)
  setStatus(
    description,
    continueButton,
    translatedMessage(BROWSER_MESSAGE_KEYS.WidgetLoginPickerOpened),
    true,
  )
}

function cancelLoginPickerRequest(requestId: string): void {
  void sendRuntimeMessage({
    type: 'nook:login-picker-cancel',
    payload: { requestId },
  })
}

export function cancelPendingLoginPickerRequest(): void {
  if (pickerState.login.kind === LoginPickerKind.Closed) return
  const pending = pickerState.login.request
  pickerState.clearPendingLogin()
  window.clearTimeout(pending.timeoutId)
  cancelLoginPickerRequest(pending.requestId)
}

export async function generatePasswordWithNook(
  workflow: PasswordFormObservation,
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
): Promise<void> {
  if (widgetState.busy) return
  widgetState.busy = true
  continueButton.disabled = true
  const totalSteps = workflow.summary.currentPasswordFieldCount > 0 ? 4 : 5
  setFlightProgress(step, title, 2, totalSteps, copyTitleForWorkflow(workflow))
  setStatus(
    description,
    continueButton,
    translatedMessage(BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordWorking),
    false,
  )
  try {
    const delivery = await sendRuntimeMessage<{
      ok?: boolean
      password?: string
      reason?: string
    }>({
      type: 'nook:website-generate-password',
      payload: { origin: location.origin },
    })
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed),
        true,
      )
      return
    }
    const { response } = delivery
    if (response.ok !== true || typeof response.password !== 'string') {
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed),
        true,
      )
      return
    }
    const password = response.password
    const filled = fillGeneratedPassword(
      password,
      workflow.root,
      workflow.formScope,
    )
    if (!filled) {
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed),
        true,
      )
      return
    }
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetGeneratedPasswordFilled),
      false,
    )
    continueButton.hidden = true
  } finally {
    widgetState.busy = false
    continueButton.disabled = false
  }
}

export async function proposePasskeyWithNook(
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  action: PasskeyWidgetAction,
): Promise<void> {
  if (widgetState.busy) return
  widgetState.busy = true
  continueButton.disabled = true
  setStatus(
    description,
    continueButton,
    translatedMessage(
      action === PasskeyWidgetAction.UsePasskey
        ? BROWSER_MESSAGE_KEYS.WidgetUsePasskeyWorking
        : BROWSER_MESSAGE_KEYS.WidgetCreatePasskeyWorking,
    ),
    false,
  )
  try {
    const control = findPasskeyControl(document)
    if (control.kind === PasskeyControlLookupKind.Absent) {
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPasskeyControlMissing),
        true,
      )
      return
    }
    control.control.click()
    setStatus(
      description,
      continueButton,
      translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPasskeyCeremonyStarted),
      false,
    )
    continueButton.hidden = true
  } finally {
    widgetState.busy = false
    continueButton.disabled = false
  }
}

function copyTitleForWorkflow(workflow: PasswordFormObservation): string {
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

export async function continueWithNook(
  step: HTMLParagraphElement,
  title: HTMLHeadingElement,
  description: HTMLParagraphElement,
  continueButton: HTMLButtonElement,
  _openVaultButton: HTMLButtonElement,
  _panel: HTMLElement,
  workflow: PasswordFormObservation,
): Promise<void> {
  if (widgetState.busy || pickerState.login.kind === LoginPickerKind.Open)
    return
  widgetState.busy = true
  continueButton.disabled = true
  setFlightProgress(step, title, 2, 3, BROWSER_MESSAGE_KEYS.WidgetFillingTitle)
  setStatus(
    description,
    continueButton,
    translatedMessage(BROWSER_MESSAGE_KEYS.WidgetWorking),
    false,
  )

  try {
    const delivery = await sendRuntimeMessage<LoginOptionsResponse>({
      type: 'nook:website-login-options',
      payload: { origin: location.origin },
    })

    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      !delivery.response?.ok
    ) {
      setFlightProgress(
        step,
        title,
        1,
        3,
        BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      )
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
        true,
      )
      return
    }
    const { response } = delivery

    if (response.status === 'locked') {
      setFlightProgress(
        step,
        title,
        1,
        3,
        BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      )
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue),
        true,
      )
      return
    }

    if (response.status === 'unavailable') {
      setFlightProgress(
        step,
        title,
        1,
        3,
        BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      )
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetConnectVault),
        true,
      )
      return
    }

    const accounts = response.accounts ?? []
    if (accounts.length === 0) {
      setFlightProgress(
        step,
        title,
        1,
        3,
        BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      )
      setStatus(
        description,
        continueButton,
        translatedMessage(BROWSER_MESSAGE_KEYS.WidgetNoMatch),
        true,
      )
      return
    }

    if (accounts.length === 1) {
      await fillAndSubmitAccount(
        accounts[0],
        workflow,
        step,
        title,
        description,
        continueButton,
      )
      return
    }

    await openLoginPicker(workflow, step, title, description, continueButton)
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
