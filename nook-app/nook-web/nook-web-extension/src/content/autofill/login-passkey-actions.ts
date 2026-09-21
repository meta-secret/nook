/* eslint-disable nook-typed-api/no-raw-object-arguments -- WebAuthn observations are converted into typed Rust requests at this boundary. */
import { LiveAuthenticationWorkflowDisposition } from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import {
  PasskeyControlLookupKind,
  PasswordFormQueryKind,
  passwordFormCredentialInteraction,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { WebsiteLoginOptionsMessageType } from '../../lib/login-fill-messages'
import {
  LoginPickerCancelMessageType,
  WebsiteLoginPickerOpenMessageType,
} from '../../lib/login-picker-messages'
import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowActivity,
  GeneratedPasswordResponseKind,
  LoginPickerOpenResponseKind,
  WebsiteLoginOptionsKind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authenticationActivityProgress,
  authentication_workflow_activity_progress,
} from './authentication-activity-progress'
import { CompanionWasmSessionMessageType } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  LoginPickerKind,
  WidgetControlDisposition,
  PendingPickerTakeKind,
  pickerState,
  widgetState,
} from './state'
import { authenticationWorkflowUi } from './authentication-workflow-ui-state'
import { WorkflowCopy, workflowUi } from './workflow-ui'
import {
  RuntimeMessageDeliveryKind,
  authenticationRuntimeTransport,
} from './runtime-message-adapter'
import { GeneratePasswordRequestType } from '../../../../nook-web-shared/src/extension/runtime-messages'
import {
  AuthenticationObservationBindingKind,
  RevalidatedAuthenticationAction,
  RevalidatedAuthenticationActionOutcomeKind,
  RevalidatedAuthenticationActResultKind,
  type AuthenticationObservationBinding,
} from './workflow-revalidation'
import { loginCredentialFillAction } from './login-credential-fill-action'
import type {
  ContinueWithNookArgs,
  FillAndSubmitAccountArgs,
  GeneratePasswordWithNookArgs,
  OpenLoginPickerArgs,
  ProposePasskeyWithNookArgs,
} from './login-passkey-action-types'

export {
  RuntimeMessageDeliveryKind,
  authenticationRuntimeTransport,
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

export { authenticationWorkflowUi } from './authentication-workflow-ui-state'

export type { PasskeyWidgetAction } from './login-passkey-action-types'

type PreparedPasskeyActuation = () => RevalidatedAuthenticationActResultKind

/** Owns the browser runtime resources shared by these interactions. */
class LoginPasskeyInteraction {
  private preparedPasskeyActuations = new WeakMap<
    HTMLButtonElement,
    PreparedPasskeyActuation
  >()
  async fillAndSubmitAccount(
    request: FillAndSubmitAccountArgs,
  ): Promise<boolean> {
    return loginCredentialFillAction.fillAndSubmitAccount(request)
  }

  private async openLoginPicker({
    workflow,
    approval,
    step,
    title,
    description,
    continueButton,
  }: OpenLoginPickerArgs): Promise<void> {
    if (pickerState.login.kind === LoginPickerKind.Open) return

    const loginPickerMessage1: Parameters<
      typeof authenticationRuntimeTransport.sendLoginPickerOpenRuntimeMessage
    >[0] = {
      type: WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen,
      payload: { origin: location.origin },
    }
    const delivery =
      await authenticationRuntimeTransport.sendLoginPickerOpenRuntimeMessage(
        loginPickerMessage1,
      )
    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      delivery.response.kind === LoginPickerOpenResponseKind.Failed
    ) {
      const flightProgressRequest5: Parameters<
        typeof workflowUi.setFlightProgress
      >[0] = {
        step,
        title,
        ...authentication_workflow_activity_progress(
          AuthenticationWorkflowActivity.ReadyLogin,
        ),
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      }
      workflowUi.setFlightProgress(flightProgressRequest5)
      const authenticationStatusRequest3: Parameters<
        typeof authenticationWorkflowUi.setStatus
      >[0] = {
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetFillFailed,
        ),
        enableContinue: true,
      }
      authenticationWorkflowUi.setStatus(authenticationStatusRequest3)
      return
    }
    const { response } = delivery
    if (response.kind === LoginPickerOpenResponseKind.Locked) {
      const flightProgressRequest6: Parameters<
        typeof workflowUi.setFlightProgress
      >[0] = {
        step,
        title,
        ...authentication_workflow_activity_progress(
          AuthenticationWorkflowActivity.ReadyLogin,
        ),
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      }
      workflowUi.setFlightProgress(flightProgressRequest6)
      const authenticationStatusRequest4: Parameters<
        typeof authenticationWorkflowUi.setStatus
      >[0] = {
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue,
        ),
        enableContinue: true,
      }
      authenticationWorkflowUi.setStatus(authenticationStatusRequest4)
      return
    }
    if (response.kind === LoginPickerOpenResponseKind.Unavailable) {
      const flightProgressRequest7: Parameters<
        typeof workflowUi.setFlightProgress
      >[0] = {
        step,
        title,
        ...authentication_workflow_activity_progress(
          AuthenticationWorkflowActivity.ReadyLogin,
        ),
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      }
      workflowUi.setFlightProgress(flightProgressRequest7)
      const authenticationStatusRequest5: Parameters<
        typeof authenticationWorkflowUi.setStatus
      >[0] = {
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetConnectVault,
        ),
        enableContinue: true,
      }
      authenticationWorkflowUi.setStatus(authenticationStatusRequest5)
      return
    }
    if (!('expiresAt' in response) || !('requestId' in response)) return
    if (response.expiresAt <= Date.now()) {
      const flightProgressRequest8: Parameters<
        typeof workflowUi.setFlightProgress
      >[0] = {
        step,
        title,
        ...authentication_workflow_activity_progress(
          AuthenticationWorkflowActivity.ReadyLogin,
        ),
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      }
      workflowUi.setFlightProgress(flightProgressRequest8)
      const authenticationStatusRequest6: Parameters<
        typeof authenticationWorkflowUi.setStatus
      >[0] = {
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetFillFailed,
        ),
        enableContinue: true,
      }
      authenticationWorkflowUi.setStatus(authenticationStatusRequest6)
      return
    }
    const requestId = response.requestId
    if (
      widgetState.controlDisposition(continueButton) !==
      WidgetControlDisposition.Active
    ) {
      this.cancelLoginPickerRequest(requestId)
      return
    }
    if (
      (await authenticationWorkflowUi.approvedWorkflowDisposition(workflow)) !==
      LiveAuthenticationWorkflowDisposition.Current
    ) {
      this.cancelLoginPickerRequest(requestId)
      return
    }
    const timeoutId = window.setTimeout(
      () => {
        const taken = pickerState.takeLogin(requestId)
        if (taken.kind !== PendingPickerTakeKind.Taken) return
        const pending = taken.request
        const authenticationStatusRequest7: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description: pending.description,
          continueButton: pending.continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetFillFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest7)
        if (
          pending.continueButton.isConnected &&
          !pending.continueButton.hidden
        ) {
          pending.continueButton.disabled = false
        }
      },
      Math.max(0, response.expiresAt - Date.now()),
    )
    const pendingLoginRequest1: Parameters<typeof pickerState.openLogin>[0] = {
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
    pickerState.openLogin(pendingLoginRequest1)
    const flightProgressRequest9: Parameters<
      typeof workflowUi.setFlightProgress
    >[0] = {
      step,
      title,
      ...authentication_workflow_activity_progress(
        AuthenticationWorkflowActivity.FillingLogin,
      ),
      titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
    }
    workflowUi.setFlightProgress(flightProgressRequest9)
    const authenticationStatusRequest8: Parameters<
      typeof authenticationWorkflowUi.setStatus
    >[0] = {
      description,
      continueButton,
      text: workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetLoginPickerOpened,
      ),
      enableContinue: true,
    }
    authenticationWorkflowUi.setStatus(authenticationStatusRequest8)
  }

  private cancelLoginPickerRequest(requestId: string): void {
    const runtimeMessage1: Parameters<
      typeof authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse
    >[0] = {
      type: LoginPickerCancelMessageType.NookLoginPickerCancel,
      payload: { requestId },
    }
    authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse(
      runtimeMessage1,
    )
  }

  cancelPendingLoginPickerRequest(): void {
    if (pickerState.login.kind === LoginPickerKind.Closed) return
    const pending = pickerState.login.request
    pickerState.clearPendingLogin()
    window.clearTimeout(pending.timeoutId)
    this.cancelLoginPickerRequest(pending.requestId)
  }

  async generatePasswordWithNook({
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
    const passwordWorkflowActivityRequest1 = {
      currentPasswordFieldCount: workflow.summary.currentPasswordFieldCount,
      newPasswordFieldCount: workflow.summary.newPasswordFieldCount,
    }
    const activityDelivery =
      await authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage({
        type: CompanionWasmSessionMessageType.PasswordWorkflowActivity,
        payload: passwordWorkflowActivityRequest1,
      })
    if (activityDelivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      continueButton.disabled = false
      return
    }
    const activity = activityDelivery.response
    if (
      typeof activity !== 'object' ||
      !('generationProgress' in activity) ||
      !('kind' in activity)
    ) {
      continueButton.disabled = false
      return
    }
    const flightProgressRequest10: Parameters<
      typeof workflowUi.setFlightProgress
    >[0] = {
      step,
      title,
      ...activity.generationProgress,
      titleKey: WorkflowCopy.forKind(activity.kind).titleKey,
    }
    workflowUi.setFlightProgress(flightProgressRequest10)
    const authenticationStatusRequest9: Parameters<
      typeof authenticationWorkflowUi.setStatus
    >[0] = {
      description,
      continueButton,
      text: workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordWorking,
      ),
      enableContinue: false,
    }
    authenticationWorkflowUi.setStatus(authenticationStatusRequest9)
    const approvalIsActive = () =>
      widgetState.controlDisposition(continueButton) ===
      WidgetControlDisposition.Active
    try {
      let releasedObservationBinding: AuthenticationObservationBinding =
        await RevalidatedAuthenticationAction.requiredAuthenticationObservationBinding(
          approval.facts,
        )
      const revalidationRequest2: ConstructorParameters<
        typeof RevalidatedAuthenticationAction
      >[0] = {
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
      }
      const releaseApproved = await new RevalidatedAuthenticationAction(
        revalidationRequest2,
      ).execute()
      if (
        releaseApproved.kind !==
        RevalidatedAuthenticationActionOutcomeKind.Acted
      ) {
        const authenticationStatusRequest10: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest10)
        return
      }

      const generatePasswordMessage: Parameters<
        typeof authenticationRuntimeTransport.sendGeneratePasswordRuntimeMessage
      >[0] = {
        type: GeneratePasswordRequestType.NookWebsiteGeneratePassword,
        payload: { origin: location.origin },
      }
      const delivery =
        await authenticationRuntimeTransport.sendGeneratePasswordRuntimeMessage(
          generatePasswordMessage,
        )
      if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
        const authenticationStatusRequest11: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest11)
        return
      }
      const { response } = delivery
      const approvalRemainsActive = approvalIsActive()
      if (
        !approvalRemainsActive &&
        response.kind === GeneratedPasswordResponseKind.Generated &&
        'password' in response
      )
        response.password = ''
      if (!approvalRemainsActive) return
      if (
        response.kind !== GeneratedPasswordResponseKind.Generated ||
        !('password' in response)
      ) {
        const authenticationStatusRequest12: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest12)
        return
      }
      const password = { value: response.password }
      response.password = ''
      const fillOutcome = await (async () => {
        try {
          const revalidationRequest3: ConstructorParameters<
            typeof RevalidatedAuthenticationAction
          >[0] = {
            workflow,
            expectedAction: AuthenticationWorkflowAction.GeneratePassword,
            observationBinding: releasedObservationBinding,
            approvalIsActive,
            act: ({ currentWorkflow }) => {
              const generatedPasswordRequest: Parameters<
                typeof passwordFormCredentialInteraction.fillGeneratedPassword
              >[0] = {
                password: password.value,
                kind: PasswordFormQueryKind.Scoped,
                root: currentWorkflow.root,
                formScope: currentWorkflow.formScope,
              }
              return {
                kind: passwordFormCredentialInteraction.fillGeneratedPassword(
                  generatedPasswordRequest,
                )
                  ? RevalidatedAuthenticationActResultKind.Acted
                  : RevalidatedAuthenticationActResultKind.Failed,
              }
            },
          }
          return await new RevalidatedAuthenticationAction(
            revalidationRequest3,
          ).execute()
        } finally {
          password.value = ''
        }
      })()
      if (
        fillOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted
      ) {
        const authenticationStatusRequest13: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest13)
        return
      }
      const authenticationStatusRequest14: Parameters<
        typeof authenticationWorkflowUi.setStatus
      >[0] = {
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetGeneratedPasswordFilled,
        ),
        enableContinue: false,
      }
      authenticationWorkflowUi.setStatus(authenticationStatusRequest14)
      continueButton.hidden = true
    } finally {
      widgetState.busy = false
      continueButton.disabled = false
    }
  }

  async proposePasskeyWithNook({
    description,
    continueButton,
    action,
    workflow,
    approval,
  }: ProposePasskeyWithNookArgs): Promise<void> {
    if (widgetState.busy) return
    const preparedActuation = this.preparedPasskeyActuations.get(continueButton)
    if (preparedActuation) {
      this.preparedPasskeyActuations.delete(continueButton)
      const actuationResult = preparedActuation()
      if (actuationResult !== RevalidatedAuthenticationActResultKind.Acted) {
        const authenticationStatusRequest15: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            actuationResult ===
              RevalidatedAuthenticationActResultKind.ControlMissing
              ? BROWSER_MESSAGE_KEYS.WidgetPasskeyControlMissing
              : BROWSER_MESSAGE_KEYS.WidgetFillFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest15)
        return
      }
      const authenticationStatusRequest16: Parameters<
        typeof authenticationWorkflowUi.setStatus
      >[0] = {
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetPasskeyCeremonyStarted,
        ),
        enableContinue: false,
      }
      authenticationWorkflowUi.setStatus(authenticationStatusRequest16)
      continueButton.hidden = true
      return
    }
    widgetState.busy = true
    continueButton.disabled = true
    const authenticationStatusRequest17: Parameters<
      typeof authenticationWorkflowUi.setStatus
    >[0] = {
      description,
      continueButton,
      text: workflowUi.translatedMessage(
        action === AuthenticationWorkflowAction.UsePasskey
          ? BROWSER_MESSAGE_KEYS.WidgetUsePasskeyWorking
          : BROWSER_MESSAGE_KEYS.WidgetCreatePasskeyWorking,
      ),
      enableContinue: false,
    }
    authenticationWorkflowUi.setStatus(authenticationStatusRequest17)
    const approvalIsActive = () =>
      widgetState.controlDisposition(continueButton) ===
      WidgetControlDisposition.Active
    try {
      const observationBinding =
        await RevalidatedAuthenticationAction.requiredAuthenticationObservationBinding(
          approval.facts,
        )
      const revalidationRequest4: ConstructorParameters<
        typeof RevalidatedAuthenticationAction
      >[0] = {
        workflow,
        expectedAction: action,
        observationBinding,
        approvalIsActive,
        act: ({ currentWorkflow, revalidateCurrentWorkflow }) => {
          const control =
            passwordFormInteraction.findWorkflowPasskeyControl(currentWorkflow)
          if (control.kind === PasskeyControlLookupKind.Absent) {
            return {
              kind: RevalidatedAuthenticationActResultKind.ControlMissing,
            }
          }
          if (!approvalIsActive()) {
            return { kind: RevalidatedAuthenticationActResultKind.Failed }
          }
          const approvedControl = control.control
          const preparedActuation: PreparedPasskeyActuation = () => {
            if (!approvalIsActive()) {
              return RevalidatedAuthenticationActResultKind.Failed
            }
            const liveWorkflow = revalidateCurrentWorkflow()
            if (!liveWorkflow) {
              return RevalidatedAuthenticationActResultKind.Failed
            }
            const liveControl =
              passwordFormInteraction.findWorkflowPasskeyControl(liveWorkflow)
            if (liveControl.kind === PasskeyControlLookupKind.Absent) {
              return RevalidatedAuthenticationActResultKind.ControlMissing
            }
            if (liveControl.control !== approvedControl) {
              return RevalidatedAuthenticationActResultKind.Failed
            }
            liveControl.control.click()
            return RevalidatedAuthenticationActResultKind.Acted
          }
          this.preparedPasskeyActuations.set(continueButton, preparedActuation)
          return { kind: RevalidatedAuthenticationActResultKind.Acted }
        },
      }
      const outcome = await new RevalidatedAuthenticationAction(
        revalidationRequest4,
      ).execute()
      if (outcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted) {
        const authenticationStatusRequest18: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            outcome.kind ===
              RevalidatedAuthenticationActionOutcomeKind.ControlMissing
              ? BROWSER_MESSAGE_KEYS.WidgetPasskeyControlMissing
              : BROWSER_MESSAGE_KEYS.WidgetFillFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest18)
        return
      }
      const authenticationStatusRequest19: Parameters<
        typeof authenticationWorkflowUi.setStatus
      >[0] = {
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          action === AuthenticationWorkflowAction.UsePasskey
            ? BROWSER_MESSAGE_KEYS.WidgetUsePasskey
            : BROWSER_MESSAGE_KEYS.WidgetCreatePasskey,
        ),
        enableContinue: true,
      }
      authenticationWorkflowUi.setStatus(authenticationStatusRequest19)
    } finally {
      widgetState.busy = false
      continueButton.disabled = false
    }
  }

  async continueWithNook({
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
    widgetState.credentialActuationInFlight = true
    continueButton.disabled = true
    if (!authenticationActivityProgress.prepare()) {
      widgetState.busy = false
      continueButton.disabled = false
      return
    }
    const flightProgressRequest11: Parameters<
      typeof workflowUi.setFlightProgress
    >[0] = {
      step,
      title,
      ...authentication_workflow_activity_progress(
        AuthenticationWorkflowActivity.FillingLogin,
      ),
      titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
    }
    workflowUi.setFlightProgress(flightProgressRequest11)
    const authenticationStatusRequest20: Parameters<
      typeof authenticationWorkflowUi.setStatus
    >[0] = {
      description,
      continueButton,
      text: workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetWorking),
      enableContinue: false,
    }
    authenticationWorkflowUi.setStatus(authenticationStatusRequest20)

    try {
      const loginOptionsMessage1: Parameters<
        typeof authenticationRuntimeTransport.sendLoginOptionsRuntimeMessage
      >[0] = {
        type: WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions,
        payload: { origin: location.origin },
      }
      const delivery =
        await authenticationRuntimeTransport.sendLoginOptionsRuntimeMessage(
          loginOptionsMessage1,
        )

      if (
        delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
        delivery.response.kind === WebsiteLoginOptionsKind.Rejected
      ) {
        const flightProgressRequest12: Parameters<
          typeof workflowUi.setFlightProgress
        >[0] = {
          step,
          title,
          ...authentication_workflow_activity_progress(
            AuthenticationWorkflowActivity.ReadyLogin,
          ),
          titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
        }
        workflowUi.setFlightProgress(flightProgressRequest12)
        const authenticationStatusRequest21: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetFillFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest21)
        return
      }
      const { response } = delivery

      if (response.kind === WebsiteLoginOptionsKind.Locked) {
        const flightProgressRequest13: Parameters<
          typeof workflowUi.setFlightProgress
        >[0] = {
          step,
          title,
          ...authentication_workflow_activity_progress(
            AuthenticationWorkflowActivity.ReadyLogin,
          ),
          titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
        }
        workflowUi.setFlightProgress(flightProgressRequest13)
        const authenticationStatusRequest22: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest22)
        return
      }

      if (response.kind === WebsiteLoginOptionsKind.Unavailable) {
        const flightProgressRequest14: Parameters<
          typeof workflowUi.setFlightProgress
        >[0] = {
          step,
          title,
          ...authentication_workflow_activity_progress(
            AuthenticationWorkflowActivity.ReadyLogin,
          ),
          titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
        }
        workflowUi.setFlightProgress(flightProgressRequest14)
        const authenticationStatusRequest23: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetConnectVault,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest23)
        return
      }

      if (!('accounts' in response)) return

      const accounts = response.accounts
      if (accounts.length === 0) {
        const flightProgressRequest15: Parameters<
          typeof workflowUi.setFlightProgress
        >[0] = {
          step,
          title,
          ...authentication_workflow_activity_progress(
            AuthenticationWorkflowActivity.ReadyLogin,
          ),
          titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
        }
        workflowUi.setFlightProgress(flightProgressRequest15)
        const authenticationStatusRequest24: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetNoMatch,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest24)
        return
      }

      const [account] = accounts
      if (accounts.length === 1 && account) {
        const fillAccountRequest1: FillAndSubmitAccountArgs = {
          account: {
            ...account,
            authorizationGeneration: response.authorizationGeneration,
          },
          workflow,
          approval,
          step,
          title,
          description,
          continueButton,
        }
        await this.fillAndSubmitAccount(fillAccountRequest1)
        return
      }
      const openLoginPickerRequest1: OpenLoginPickerArgs = {
        workflow,
        approval,
        step,
        title,
        description,
        continueButton,
      }
      await this.openLoginPicker(openLoginPickerRequest1)
    } finally {
      widgetState.busy = false
      widgetState.credentialActuationInFlight = false
      if (
        pickerState.login.kind === LoginPickerKind.Closed &&
        continueButton.isConnected &&
        !continueButton.hidden
      ) {
        continueButton.disabled = false
      }
    }
  }
}

export const loginPasskeyInteraction = new LoginPasskeyInteraction()
