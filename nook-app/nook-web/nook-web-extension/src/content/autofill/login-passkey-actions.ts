import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'
import {
  authenticationWorkflowScopesMatch,
  liveApprovedAuthenticationWorkflow,
} from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { detectEnrollmentHints } from '../enrollment-flow'
import {
  clearLoginCredentials,
  fillGeneratedPassword,
  fillLoginCredentials,
  findWorkflowPasskeyControl,
  FormSubmissionResult,
  PasskeyControlLookupKind,
  PasswordFormQueryKind,
  submitLoginForm,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  type WebsiteLoginAccountOption,
  WebsiteLoginOptionsMessageType,
  WebsiteLoginRevealMessageType,
} from '../../lib/login-fill-messages'
import {
  LoginPickerCancelMessageType,
  WebsiteLoginPickerOpenMessageType,
} from '../../lib/login-picker-messages'
import {
  AuthenticationWorkflowAction,
  GeneratedPasswordResponseKind,
  LoginPickerOpenResponseKind,
  WebsiteLoginOptionsKind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  LoginPickerKind,
  WidgetWorkflowKeyKind,
  WidgetWorkflowRootKind,
  pickerState,
  widgetState,
} from './state'
import { setFlightProgress, translatedMessage } from './workflow-ui'
import {
  LoginFillDeliveryKind,
  sendLoginFillMessage,
} from './login-fill-runtime-adapter'
import {
  RuntimeMessageDeliveryKind,
  sendGeneratePasswordRuntimeMessage,
  sendLoginOptionsRuntimeMessage,
  sendLoginPickerOpenRuntimeMessage,
  sendRuntimeMessageWithoutResponse,
} from './runtime-message-adapter'
import { GeneratePasswordRequestType } from '../../../../nook-web-shared/src/extension/runtime-messages'
import type { AuthenticationWorkflowApproval } from '../../lib/auth-workflow-messages'
import {
  AuthenticationObservationBindingKind,
  performRevalidatedAuthenticationAction,
  requiredAuthenticationObservationBinding,
  RevalidatedAuthenticationActionOutcomeKind,
  RevalidatedAuthenticationActResultKind,
  type AuthenticationObservationBinding,
} from './workflow-revalidation'

export {
  RuntimeMessageDeliveryKind,
  sendAuthenticationWorkflowSnapshotRuntimeMessage,
  sendAuthenticationOutcomeRuntimeMessage,
  sendAuthenticatorBackupAttachRuntimeMessage,
  sendAuthenticatorCodeRuntimeMessage,
  sendAuthenticatorEnrollmentConfirmRuntimeMessage,
  sendAuthenticatorEnrollmentStageRuntimeMessage,
  sendAuthenticatorOptionsRuntimeMessage,
  sendAuthenticatorPickerOpenRuntimeMessage,
  sendAuthenticatorPreviewRuntimeMessage,
  sendDecodedRuntimeMessage,
  sendLoginSaveOfferRuntimeMessage,
  sendLoginSavePendingRuntimeMessage,
  sendLoginSaveActionRuntimeMessage,
  sendRuntimeMessageWithoutResponse,
} from './runtime-message-adapter'
export type {
  AuthenticatorBackupAttachResponse,
  AuthenticatorCodeResponse,
  AuthenticatorEnrollmentConfirmResponse,
  AuthenticatorEnrollmentStageResponse,
  AuthenticatorOptionsResponse,
  AuthenticatorPickerOpenResponse,
  AuthenticatorPreviewResponse,
  DecodedRuntimeMessageArgs,
  RuntimeMessageDelivery,
  RuntimeMessageResponseDecoder,
} from './runtime-message-adapter'

export type PasskeyWidgetAction =
  | AuthenticationWorkflowAction.UsePasskey
  | AuthenticationWorkflowAction.CreatePasskey

type PreparedPasskeyActuation = {
  act: () => RevalidatedAuthenticationActResultKind
}

const preparedPasskeyActuations = new WeakMap<
  HTMLButtonElement,
  PreparedPasskeyActuation
>()

type PasskeyWidgetStatusUpdate = {
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  text: string
  enableContinue: boolean
}

export function setStatus({
  description,
  continueButton,
  text,
  enableContinue,
}: PasskeyWidgetStatusUpdate): void {
  description.textContent = text
  continueButton.disabled = !enableContinue || widgetState.busy
}

export function approvedWorkflowIsStillCurrent(
  workflow: PasswordFormObservation,
): boolean {
  const rendered = widgetState.renderedWorkflowRoot
  if (rendered.kind !== WidgetWorkflowRootKind.Assigned) return false
  const scopePair: Parameters<typeof authenticationWorkflowScopesMatch>[0] = {
    left: rendered.observation,
    right: workflow,
  }
  if (!authenticationWorkflowScopesMatch(scopePair)) {
    return false
  }
  const hints = detectEnrollmentHints()
  const liveRequest: Parameters<typeof liveApprovedAuthenticationWorkflow>[0] =
    {
      approved: {
        observation: rendered.observation,
        facts: rendered.facts,
      },
      authenticatorSetupHint: hints.qr,
      backupCodesHint: hints.backupCodes,
    }
  return liveApprovedAuthenticationWorkflow(liveRequest)
}

type FillAndSubmitAccountArgs = {
  account: Pick<WebsiteLoginAccountOption, 'vaultStoreId' | 'secretId'>
  workflow: PasswordFormObservation
  approval: AuthenticationWorkflowApproval
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}

export async function fillAndSubmitAccount({
  account,
  workflow,
  approval,
  step,
  title,
  description,
  continueButton,
}: FillAndSubmitAccountArgs): Promise<boolean> {
  const approvalIsActive = () =>
    !widgetState.dismissed && continueButton.isConnected
  let releasedObservationBinding: AuthenticationObservationBinding =
    requiredAuthenticationObservationBinding(approval.facts)
  const releaseRevalidationRequest: Parameters<
    typeof performRevalidatedAuthenticationAction
  >[0] = {
    workflow,
    expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
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
  const releaseOutcome = await performRevalidatedAuthenticationAction(
    releaseRevalidationRequest,
  )
  if (
    releaseOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted
  ) {
    const progressRequest: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 1,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
    }
    setFlightProgress(progressRequest)
    const statusRequest: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      enableContinue: true,
    }
    setStatus(statusRequest)
    return false
  }
  const nookTypedArgs0_2: Parameters<typeof sendLoginFillMessage>[0] = {
    type: WebsiteLoginRevealMessageType.NookWebsiteLoginFill,
    payload: {
      origin: location.origin,
      vaultStoreId: account.vaultStoreId,
      secretId: account.secretId,
    },
  }
  const delivery = await sendLoginFillMessage(nookTypedArgs0_2)
  if (delivery.kind === LoginFillDeliveryKind.Unavailable) {
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
  let submissionResult = FormSubmissionResult.NotObserved
  let filledRequest: Parameters<typeof fillLoginCredentials>[0] | false = false
  const fillRevalidationRequest: Parameters<
    typeof performRevalidatedAuthenticationAction
  >[0] = {
    workflow,
    expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
    observationBinding: releasedObservationBinding,
    approvalIsActive,
    act: ({ currentWorkflow, revalidateCurrentWorkflow }) => {
      const fillRequest: Parameters<typeof fillLoginCredentials>[0] = {
        credentials,
        kind: PasswordFormQueryKind.Scoped,
        root: currentWorkflow.root,
        formScope: currentWorkflow.formScope,
      }
      if (!fillLoginCredentials(fillRequest)) {
        return { kind: RevalidatedAuthenticationActResultKind.Failed }
      }
      filledRequest = fillRequest
      const postFillWorkflow = revalidateCurrentWorkflow()
      if (!postFillWorkflow) {
        clearLoginCredentials(fillRequest)
        return { kind: RevalidatedAuthenticationActResultKind.Failed }
      }
      const submissionApproval: NonNullable<
        Parameters<typeof submitLoginForm>[0]['submissionApproval']
      > = {
        isApproved: () => Boolean(revalidateCurrentWorkflow()),
        reject: () => clearLoginCredentials(fillRequest),
      }
      const submissionRequest: Parameters<typeof submitLoginForm>[0] = {
        kind: PasswordFormQueryKind.Scoped,
        root: postFillWorkflow.root,
        formScope: postFillWorkflow.formScope,
        submissionApproval,
      }
      submissionResult = submitLoginForm(submissionRequest)
      return { kind: RevalidatedAuthenticationActResultKind.Acted }
    },
  }
  const fillOutcome = await (async () => {
    try {
      return await performRevalidatedAuthenticationAction(
        fillRevalidationRequest,
      )
    } finally {
      credentials.password = ''
      credentials.username = ''
    }
  })()
  if (fillOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted) {
    if (filledRequest) clearLoginCredentials(filledRequest)
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
  if (submissionResult === FormSubmissionResult.Rejected) {
    const rejectedProgress: Parameters<typeof setFlightProgress>[0] = {
      step,
      title,
      currentStep: 2,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
    }
    setFlightProgress(rejectedProgress)
    const rejectedStatus: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(BROWSER_MESSAGE_KEYS.WidgetFillFailed),
      enableContinue: true,
    }
    setStatus(rejectedStatus)
    continueButton.hidden = false
    return false
  }
  if (submissionResult === FormSubmissionResult.NotObserved) {
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

type OpenLoginPickerArgs = {
  workflow: PasswordFormObservation
  approval: AuthenticationWorkflowApproval
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}

async function openLoginPicker({
  workflow,
  approval,
  step,
  title,
  description,
  continueButton,
}: OpenLoginPickerArgs): Promise<void> {
  if (pickerState.login.kind === LoginPickerKind.Open) return
  const nookTypedArgs0_3: Parameters<
    typeof sendLoginPickerOpenRuntimeMessage
  >[0] = {
    type: WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen,
    payload: { origin: location.origin },
  }
  const delivery = await sendLoginPickerOpenRuntimeMessage(nookTypedArgs0_3)
  if (
    delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
    delivery.response.kind === LoginPickerOpenResponseKind.Failed
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
  if (response.kind === LoginPickerOpenResponseKind.Locked) {
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
  if (response.kind === LoginPickerOpenResponseKind.Unavailable) {
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
  if (!('expiresAt' in response) || !('requestId' in response)) return
  if (response.expiresAt <= Date.now()) {
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
  if (
    !approvedWorkflowIsStillCurrent(workflow) ||
    widgetState.workflowKey.kind !== WidgetWorkflowKeyKind.Assigned ||
    widgetState.renderedWorkflowRoot.kind !== WidgetWorkflowRootKind.Assigned
  ) {
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
    approval: {
      workflowKey: approval.workflowKey,
      facts: approval.facts,
    },
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
  const nookTypedArgs0_5: Parameters<
    typeof sendRuntimeMessageWithoutResponse
  >[0] = {
    type: LoginPickerCancelMessageType.NookLoginPickerCancel,
    payload: { requestId },
  }
  sendRuntimeMessageWithoutResponse(nookTypedArgs0_5)
}

export function cancelPendingLoginPickerRequest(): void {
  if (pickerState.login.kind === LoginPickerKind.Closed) return
  const pending = pickerState.login.request
  pickerState.clearPendingLogin()
  window.clearTimeout(pending.timeoutId)
  cancelLoginPickerRequest(pending.requestId)
}

type GeneratePasswordWithNookArgs = {
  workflow: PasswordFormObservation
  approval: AuthenticationWorkflowApproval
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}

export async function generatePasswordWithNook({
  workflow,
  approval,
  step,
  title,
  description,
  continueButton,
}: GeneratePasswordWithNookArgs): Promise<void> {
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
  const approvalIsActive = () =>
    !widgetState.dismissed && continueButton.isConnected
  try {
    let releasedObservationBinding: AuthenticationObservationBinding =
      requiredAuthenticationObservationBinding(approval.facts)
    const releaseApproved = await performRevalidatedAuthenticationAction({
      workflow,
      expectedAction: AuthenticationWorkflowAction.GeneratePassword,
      observationBinding: releasedObservationBinding,
      approvalIsActive,
      act: ({ observationBindingToken }) => {
        releasedObservationBinding = {
          kind: AuthenticationObservationBindingKind.Required,
          token: observationBindingToken,
        }
        return { kind: RevalidatedAuthenticationActResultKind.Acted }
      },
    })
    if (
      releaseApproved.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted
    ) {
      setStatus({
        description,
        continueButton,
        text: translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
        ),
        enableContinue: true,
      })
      return
    }
    const nookTypedArgs0_6: Parameters<
      typeof sendGeneratePasswordRuntimeMessage
    >[0] = {
      type: GeneratePasswordRequestType.NookWebsiteGeneratePassword,
      payload: { origin: location.origin },
    }
    const delivery = await sendGeneratePasswordRuntimeMessage(nookTypedArgs0_6)
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
    if (
      response.kind !== GeneratedPasswordResponseKind.Generated ||
      !('password' in response)
    ) {
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
    const password = { value: response.password }
    response.password = ''
    const fillOutcome = await (async () => {
      try {
        return await performRevalidatedAuthenticationAction({
          workflow,
          expectedAction: AuthenticationWorkflowAction.GeneratePassword,
          observationBinding: releasedObservationBinding,
          approvalIsActive,
          act: ({ currentWorkflow }) => ({
            kind: fillGeneratedPassword({
              password: password.value,
              kind: PasswordFormQueryKind.Scoped,
              root: currentWorkflow.root,
              formScope: currentWorkflow.formScope,
            })
              ? RevalidatedAuthenticationActResultKind.Acted
              : RevalidatedAuthenticationActResultKind.Failed,
          }),
        })
      } finally {
        password.value = ''
      }
    })()
    if (fillOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted) {
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

type ProposePasskeyWithNookArgs = {
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  action: PasskeyWidgetAction
  workflow: PasswordFormObservation
  approval: AuthenticationWorkflowApproval
}

export async function proposePasskeyWithNook({
  description,
  continueButton,
  action,
  workflow,
  approval,
}: ProposePasskeyWithNookArgs): Promise<void> {
  if (widgetState.busy) return
  const preparedActuation = preparedPasskeyActuations.get(continueButton)
  if (preparedActuation) {
    preparedPasskeyActuations.delete(continueButton)
    const actuationResult = preparedActuation.act()
    if (actuationResult !== RevalidatedAuthenticationActResultKind.Acted) {
      setStatus({
        description,
        continueButton,
        text: translatedMessage(
          actuationResult ===
            RevalidatedAuthenticationActResultKind.ControlMissing
            ? BROWSER_MESSAGE_KEYS.WidgetPasskeyControlMissing
            : BROWSER_MESSAGE_KEYS.WidgetFillFailed,
        ),
        enableContinue: true,
      })
      return
    }
    setStatus({
      description,
      continueButton,
      text: translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetPasskeyCeremonyStarted,
      ),
      enableContinue: false,
    })
    continueButton.hidden = true
    return
  }
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
  const approvalIsActive = () =>
    !widgetState.dismissed && continueButton.isConnected
  try {
    const revalidationRequest: Parameters<
      typeof performRevalidatedAuthenticationAction
    >[0] = {
      workflow,
      expectedAction: action,
      observationBinding: {
        ...requiredAuthenticationObservationBinding(approval.facts),
      },
      approvalIsActive,
      act: ({ currentWorkflow, revalidateCurrentWorkflow }) => {
        const control = findWorkflowPasskeyControl(currentWorkflow)
        if (control.kind === PasskeyControlLookupKind.Absent) {
          return {
            kind: RevalidatedAuthenticationActResultKind.ControlMissing,
          }
        }
        if (!approvalIsActive()) {
          return { kind: RevalidatedAuthenticationActResultKind.Failed }
        }
        const approvedControl = control.control
        preparedPasskeyActuations.set(continueButton, {
          act: () => {
            if (!approvalIsActive()) {
              return RevalidatedAuthenticationActResultKind.Failed
            }
            const liveWorkflow = revalidateCurrentWorkflow()
            if (!liveWorkflow) {
              return RevalidatedAuthenticationActResultKind.Failed
            }
            const liveControl = findWorkflowPasskeyControl(liveWorkflow)
            if (liveControl.kind === PasskeyControlLookupKind.Absent) {
              return RevalidatedAuthenticationActResultKind.ControlMissing
            }
            if (liveControl.control !== approvedControl) {
              return RevalidatedAuthenticationActResultKind.Failed
            }
            liveControl.control.click()
            return RevalidatedAuthenticationActResultKind.Acted
          },
        })
        return { kind: RevalidatedAuthenticationActResultKind.Acted }
      },
    }
    const outcome =
      await performRevalidatedAuthenticationAction(revalidationRequest)
    if (outcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted) {
      const nookTypedArgs0_29: Parameters<typeof setStatus>[0] = {
        description,
        continueButton,
        text: translatedMessage(
          outcome.kind ===
            RevalidatedAuthenticationActionOutcomeKind.ControlMissing
            ? BROWSER_MESSAGE_KEYS.WidgetPasskeyControlMissing
            : BROWSER_MESSAGE_KEYS.WidgetFillFailed,
        ),
        enableContinue: true,
      }
      setStatus(nookTypedArgs0_29)
      return
    }
    const nookTypedArgs0_30: Parameters<typeof setStatus>[0] = {
      description,
      continueButton,
      text: translatedMessage(
        action === AuthenticationWorkflowAction.UsePasskey
          ? BROWSER_MESSAGE_KEYS.WidgetUsePasskey
          : BROWSER_MESSAGE_KEYS.WidgetCreatePasskey,
      ),
      enableContinue: true,
    }
    setStatus(nookTypedArgs0_30)
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

type ContinueWithNookArgs = {
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
  workflow: PasswordFormObservation
  approval: AuthenticationWorkflowApproval
}

export async function continueWithNook({
  step,
  title,
  description,
  continueButton,
  workflow,
  approval,
}: ContinueWithNookArgs): Promise<void> {
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
    const nookTypedArgs0_7: Parameters<
      typeof sendLoginOptionsRuntimeMessage
    >[0] = {
      type: WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions,
      payload: { origin: location.origin },
    }
    const delivery = await sendLoginOptionsRuntimeMessage(nookTypedArgs0_7)

    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      delivery.response.kind === WebsiteLoginOptionsKind.Rejected
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

    if (response.kind === WebsiteLoginOptionsKind.Locked) {
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

    if (response.kind === WebsiteLoginOptionsKind.Unavailable) {
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

    if (!('accounts' in response)) return

    const accounts = response.accounts
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
        approval,
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
      approval,
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
