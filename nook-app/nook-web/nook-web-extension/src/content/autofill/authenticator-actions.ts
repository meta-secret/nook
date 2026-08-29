import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  fillOneTimeCode,
  PasswordFormQueryKind,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  AuthenticationWorkflowAction,
  AuthenticatorCodeResponseKind,
  AuthenticatorPickerOpenResponseKind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { WebsiteAuthenticatorOption } from '../../lib/login-fill-messages'
import type { AuthenticationWorkflowApproval } from '../../lib/auth-workflow-messages'
import { WebsiteAuthenticatorFillMessageType } from '../../lib/login-fill-messages'
import {
  AuthenticatorPickerCancelMessageType,
  WebsiteAuthenticatorPickerOpenMessageType,
} from '../../lib/authenticator-picker-messages'
import {
  approvedWorkflowIsStillCurrent,
  RuntimeMessageDeliveryKind,
  sendAuthenticatorCodeRuntimeMessage,
  sendAuthenticatorPickerOpenRuntimeMessage,
  sendRuntimeMessageWithoutResponse,
  setStatus,
} from './login-passkey-actions'
import {
  AuthenticatorPickerKind,
  WidgetWorkflowKeyKind,
  WidgetWorkflowRootKind,
  pickerState,
  widgetState,
} from './state'
import { setFlightProgress, translatedMessage } from './workflow-ui'
import {
  AuthenticationObservationBindingKind,
  performRevalidatedAuthenticationAction,
  requiredAuthenticationObservationBinding,
  RevalidatedAuthenticationActionOutcomeKind,
  RevalidatedAuthenticationActResultKind,
  type AuthenticationObservationBinding,
} from './workflow-revalidation'

type FillAuthenticatorCodeArgs = {
  account: Pick<WebsiteAuthenticatorOption, 'vaultStoreId' | 'secretId'> & {
    authorizationGeneration?: string
  }
  workflow: PasswordFormObservation
  approval: AuthenticationWorkflowApproval
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  actionGeneration: number
}

type AuthenticatorFillFailureArgs = Omit<
  FillAuthenticatorCodeArgs,
  'account' | 'workflow' | 'approval'
>

function reportAuthenticatorFillFailure({
  step,
  title,
  description,
  continueButton,
}: AuthenticatorFillFailureArgs): false {
  const progressRequest: Parameters<typeof setFlightProgress>[0] = {
    step,
    title,
    currentStep: 2,
    totalSteps: 3,
    titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
  }
  setFlightProgress(progressRequest)
  const statusRequest: Parameters<typeof setStatus>[0] = {
    description,
    continueButton,
    text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed),
    enableContinue: true,
  }
  setStatus(statusRequest)
  return false
}

export async function fillAuthenticatorCode({
  account,
  workflow,
  approval,
  step,
  title,
  description,
  continueButton,
  actionGeneration,
}: FillAuthenticatorCodeArgs): Promise<boolean> {
  const failureUi: AuthenticatorFillFailureArgs = {
    step,
    title,
    description,
    continueButton,
  }
  const approvalIsActive = () =>
    !widgetState.dismissed && continueButton.isConnected
  let releasedObservationBinding: AuthenticationObservationBinding =
    requiredAuthenticationObservationBinding(approval.facts)
  const releaseRequest: Parameters<
    typeof performRevalidatedAuthenticationAction
  >[0] = {
    workflow,
    expectedAction: AuthenticationWorkflowAction.FillTotp,
    observationBinding: releasedObservationBinding,
    approvalIsActive,
    act: ({ observationBindingToken }) => {
      releasedObservationBinding = {
        kind: AuthenticationObservationBindingKind.Required,
        token: observationBindingToken,
      }
      return { kind: RevalidatedAuthenticationActResultKind.Acted }
    },
  }
  const releaseOutcome =
    await performRevalidatedAuthenticationAction(releaseRequest)
  if (
    releaseOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted
  ) {
    return reportAuthenticatorFillFailure(failureUi)
  }
  const message: Parameters<typeof sendAuthenticatorCodeRuntimeMessage>[0] = {
    type: WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill,
    payload: {
      origin: location.origin,
      vaultStoreId: account.vaultStoreId,
      secretId: account.secretId,
      ...(typeof account.authorizationGeneration === 'string'
        ? { authorizationGeneration: account.authorizationGeneration }
        : {}),
    },
  }
  const delivery = await sendAuthenticatorCodeRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    return reportAuthenticatorFillFailure(failureUi)
  }
  const { response } = delivery
  if (!approvalIsActive()) {
    if (
      response.kind === AuthenticatorCodeResponseKind.Ready &&
      'code' in response
    ) {
      response.code = ''
    }
    return false
  }
  if (
    response.kind !== AuthenticatorCodeResponseKind.Ready ||
    !('code' in response) ||
    !('expiresAt' in response)
  ) {
    return reportAuthenticatorFillFailure(failureUi)
  }
  const code = { value: response.code }
  const expiresAt = response.expiresAt
  response.code = ''
  if (expiresAt <= Date.now()) {
    code.value = ''
    return reportAuthenticatorFillFailure(failureUi)
  }
  const revalidationRequest: Parameters<
    typeof performRevalidatedAuthenticationAction
  >[0] = {
    workflow,
    expectedAction: AuthenticationWorkflowAction.FillTotp,
    observationBinding: releasedObservationBinding,
    approvalIsActive,
    act: ({ currentWorkflow }) => {
      if (expiresAt <= Date.now()) {
        return { kind: RevalidatedAuthenticationActResultKind.Failed }
      }
      const nookTypedArgs0_4: Parameters<typeof fillOneTimeCode>[0] = {
        code: code.value,
        kind: PasswordFormQueryKind.Scoped,
        root: currentWorkflow.root,
        formScope: currentWorkflow.formScope,
      }
      return {
        kind: fillOneTimeCode(nookTypedArgs0_4)
          ? RevalidatedAuthenticationActResultKind.Acted
          : RevalidatedAuthenticationActResultKind.Failed,
      }
    },
  }
  const fillOutcome = await (async () => {
    try {
      return await performRevalidatedAuthenticationAction(revalidationRequest)
    } finally {
      code.value = ''
    }
  })()
  if (fillOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted) {
    return reportAuthenticatorFillFailure(failureUi)
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

type ContinueWithAuthenticatorArgs = {
  workflow: PasswordFormObservation
  approval: AuthenticationWorkflowApproval
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}

export async function continueWithAuthenticator({
  workflow,
  approval,
  step,
  title,
  description,
  continueButton,
}: ContinueWithAuthenticatorArgs): Promise<void> {
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
    const message: Parameters<
      typeof sendAuthenticatorPickerOpenRuntimeMessage
    >[0] = {
      type: WebsiteAuthenticatorPickerOpenMessageType.NookWebsiteAuthenticatorPickerOpen,
      payload: { origin: location.origin },
    }
    const delivery = await sendAuthenticatorPickerOpenRuntimeMessage(message)
    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      delivery.response.kind === AuthenticatorPickerOpenResponseKind.Rejected
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
    if (response.kind === AuthenticatorPickerOpenResponseKind.Locked) {
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

    if (response.kind === AuthenticatorPickerOpenResponseKind.Unavailable) {
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
      response.kind !== AuthenticatorPickerOpenResponseKind.Ready ||
      !('requestId' in response) ||
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
    if (
      !approvedWorkflowIsStillCurrent(workflow) ||
      widgetState.workflowKey.kind !== WidgetWorkflowKeyKind.Assigned ||
      widgetState.renderedWorkflowRoot.kind !== WidgetWorkflowRootKind.Assigned
    ) {
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
      approval: {
        workflowKey: approval.workflowKey,
        facts: approval.facts,
      },
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
    type: AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel,
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
