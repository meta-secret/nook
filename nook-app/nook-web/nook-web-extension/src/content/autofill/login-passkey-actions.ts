import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  FormSubmissionResult,
  PasskeyControlLookupKind,
  PasswordFormQueryKind,
  passwordFormCredentialInteraction,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
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
import { authenticationWorkflowUi } from './authentication-workflow-ui-state'
import { WorkflowCopy, workflowUi } from './workflow-ui'
import {
  LoginFillDeliveryKind,
  loginFillRuntimeTransport,
} from './login-fill-runtime-adapter'
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
  async fillAndSubmitAccount({
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
    const showFillFailure = () => {
      workflowUi.setFlightProgress({
        step,
        title,
        currentStep: 1,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      })

      authenticationWorkflowUi.setStatus({
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetFillFailed,
        ),
        enableContinue: true,
      })
      return false
    }
    let releasedObservationBinding: AuthenticationObservationBinding =
      RevalidatedAuthenticationAction.requiredAuthenticationObservationBinding(
        approval.facts,
      )

    const releaseOutcome = await new RevalidatedAuthenticationAction({
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
    }).execute()
    if (
      releaseOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted
    )
      return showFillFailure()

    const delivery = await loginFillRuntimeTransport.sendLoginFillMessage({
      type: WebsiteLoginRevealMessageType.NookWebsiteLoginFill,
      payload: {
        origin: location.origin,
        vaultStoreId: account.vaultStoreId,
        secretId: account.secretId,
        authorizationGeneration: account.authorizationGeneration,
      },
    })
    if (delivery.kind === LoginFillDeliveryKind.Unavailable)
      return showFillFailure()
    const { response } = delivery
    if (!approvalIsActive()) {
      if (response?.ok && typeof response.password === 'string')
        response.password = ''
      return false
    }
    if (
      !response?.ok ||
      !response.username ||
      typeof response.password !== 'string'
    )
      return showFillFailure()

    const credentials = {
      username: response.username,
      password: response.password,
    }
    response.password = ''
    const submission: { result: FormSubmissionResult } = {
      result: FormSubmissionResult.NotObserved,
    }
    let filledRequest:
      | Parameters<typeof passwordFormInteraction.fillLoginCredentials>[0]
      | false = false
    const fillRevalidationRequest: ConstructorParameters<
      typeof RevalidatedAuthenticationAction
    >[0] = {
      workflow,
      expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
      observationBinding: releasedObservationBinding,
      approvalIsActive,
      act: ({ currentWorkflow }) => {
        const fillRequest: Parameters<
          typeof passwordFormInteraction.fillLoginCredentials
        >[0] = {
          credentials,
          kind: PasswordFormQueryKind.Scoped,
          root: currentWorkflow.root,
          formScope: currentWorkflow.formScope,
        }
        if (!passwordFormInteraction.fillLoginCredentials(fillRequest)) {
          return { kind: RevalidatedAuthenticationActResultKind.Failed }
        }
        filledRequest = fillRequest
        return { kind: RevalidatedAuthenticationActResultKind.Acted }
      },
    }
    widgetState.credentialActuationInFlight = true
    try {
      let fillOutcome: Awaited<
        ReturnType<RevalidatedAuthenticationAction['execute']>
      >
      try {
        fillOutcome = await new RevalidatedAuthenticationAction(
          fillRevalidationRequest,
        ).execute()
      } catch (error) {
        if (filledRequest)
          passwordFormCredentialInteraction.clearLoginCredentials(filledRequest)
        throw error
      } finally {
        credentials.password = ''
        credentials.username = ''
      }
      if (
        fillOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted
      ) {
        if (filledRequest)
          passwordFormCredentialInteraction.clearLoginCredentials(filledRequest)
        return showFillFailure()
      }
      const approvedFillRequest = filledRequest
      if (!approvedFillRequest) return false

      await Promise.resolve()
      const submissionRevalidationRequest: ConstructorParameters<
        typeof RevalidatedAuthenticationAction
      >[0] = {
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        approvalIsActive,
        act: ({ currentWorkflow, revalidateCurrentWorkflow }) => {
          const submissionApproval: NonNullable<
            Parameters<
              typeof passwordFormInteraction.submitLoginForm
            >[0]['submissionApproval']
          > = {
            isApproved: () => Boolean(revalidateCurrentWorkflow()),
            reject: () =>
              passwordFormCredentialInteraction.clearLoginCredentials(
                approvedFillRequest,
              ),
          }

          submission.result = passwordFormInteraction.submitLoginForm({
            kind: PasswordFormQueryKind.Scoped,
            root: currentWorkflow.root,
            formScope: currentWorkflow.formScope,
            submissionApproval,
          })
          return { kind: RevalidatedAuthenticationActResultKind.Acted }
        },
      }
      let submissionOutcome: Awaited<
        ReturnType<RevalidatedAuthenticationAction['execute']>
      >
      try {
        submissionOutcome = await new RevalidatedAuthenticationAction(
          submissionRevalidationRequest,
        ).execute()
      } catch (error) {
        passwordFormCredentialInteraction.clearLoginCredentials(
          approvedFillRequest,
        )
        throw error
      }
      if (
        submissionOutcome.kind !==
        RevalidatedAuthenticationActionOutcomeKind.Acted
      ) {
        passwordFormCredentialInteraction.clearLoginCredentials(
          approvedFillRequest,
        )
        return showFillFailure()
      }
      if (submission.result === FormSubmissionResult.Rejected) {
        workflowUi.setFlightProgress({
          step,
          title,
          currentStep: 2,
          totalSteps: 3,
          titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
        })

        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetFillFailed,
          ),
          enableContinue: true,
        })
        continueButton.hidden = false
        return false
      }
      if (submission.result === FormSubmissionResult.NotObserved) {
        workflowUi.setFlightProgress({
          step,
          title,
          currentStep: 2,
          totalSteps: 3,
          titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
        })
        description.textContent = workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetFilledManual,
        )
        continueButton.hidden = true
        return true
      }

      workflowUi.setFlightProgress({
        step,
        title,
        currentStep: 3,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetVerifyingTitle,
      })
      description.textContent = workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetSubmitted,
      )
      continueButton.hidden = true
      return true
    } finally {
      widgetState.credentialActuationInFlight = false
    }
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

    const delivery =
      await authenticationRuntimeTransport.sendLoginPickerOpenRuntimeMessage({
        type: WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen,
        payload: { origin: location.origin },
      })
    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      delivery.response.kind === LoginPickerOpenResponseKind.Failed
    ) {
      workflowUi.setFlightProgress({
        step,
        title,
        currentStep: 1,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      })

      authenticationWorkflowUi.setStatus({
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetFillFailed,
        ),
        enableContinue: true,
      })
      return
    }
    const { response } = delivery
    if (response.kind === LoginPickerOpenResponseKind.Locked) {
      workflowUi.setFlightProgress({
        step,
        title,
        currentStep: 1,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      })

      authenticationWorkflowUi.setStatus({
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue,
        ),
        enableContinue: true,
      })
      return
    }
    if (response.kind === LoginPickerOpenResponseKind.Unavailable) {
      workflowUi.setFlightProgress({
        step,
        title,
        currentStep: 1,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      })

      authenticationWorkflowUi.setStatus({
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetConnectVault,
        ),
        enableContinue: true,
      })
      return
    }
    if (!('expiresAt' in response) || !('requestId' in response)) return
    if (response.expiresAt <= Date.now()) {
      workflowUi.setFlightProgress({
        step,
        title,
        currentStep: 1,
        totalSteps: 3,
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      })

      authenticationWorkflowUi.setStatus({
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetFillFailed,
        ),
        enableContinue: true,
      })
      return
    }
    const requestId = response.requestId
    if (widgetState.dismissed || !continueButton.isConnected) {
      this.cancelLoginPickerRequest(requestId)
      return
    }
    if (
      !authenticationWorkflowUi.approvedWorkflowIsStillCurrent(workflow) ||
      widgetState.workflowKey.kind !== WidgetWorkflowKeyKind.Assigned ||
      widgetState.renderedWorkflowRoot.kind !== WidgetWorkflowRootKind.Assigned
    ) {
      this.cancelLoginPickerRequest(requestId)
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

        authenticationWorkflowUi.setStatus({
          description: pending.description,
          continueButton: pending.continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetFillFailed,
          ),
          enableContinue: true,
        })
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
      approval: {
        workflowKey: approval.workflowKey,
        facts: approval.facts,
      },
    })

    workflowUi.setFlightProgress({
      step,
      title,
      currentStep: 2,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
    })

    authenticationWorkflowUi.setStatus({
      description,
      continueButton,
      text: workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetLoginPickerOpened,
      ),
      enableContinue: true,
    })
  }

  private cancelLoginPickerRequest(requestId: string): void {
    authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse({
      type: LoginPickerCancelMessageType.NookLoginPickerCancel,
      payload: { requestId },
    })
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
    const totalSteps = workflow.summary.currentPasswordFieldCount > 0 ? 4 : 5

    workflowUi.setFlightProgress({
      step,
      title,
      currentStep: 2,
      totalSteps,
      titleKey: WorkflowCopy.titleForObservation(workflow),
    })

    authenticationWorkflowUi.setStatus({
      description,
      continueButton,
      text: workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordWorking,
      ),
      enableContinue: false,
    })
    const approvalIsActive = () =>
      !widgetState.dismissed && continueButton.isConnected
    try {
      let releasedObservationBinding: AuthenticationObservationBinding =
        RevalidatedAuthenticationAction.requiredAuthenticationObservationBinding(
          approval.facts,
        )

      const releaseApproved = await new RevalidatedAuthenticationAction({
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
      }).execute()
      if (
        releaseApproved.kind !==
        RevalidatedAuthenticationActionOutcomeKind.Acted
      ) {
        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
          ),
          enableContinue: true,
        })
        return
      }

      const delivery =
        await authenticationRuntimeTransport.sendGeneratePasswordRuntimeMessage(
          {
            type: GeneratePasswordRequestType.NookWebsiteGeneratePassword,
            payload: { origin: location.origin },
          },
        )
      if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
          ),
          enableContinue: true,
        })
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
        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
          ),
          enableContinue: true,
        })
        return
      }
      const password = { value: response.password }
      response.password = ''
      const fillOutcome = await (async () => {
        try {
          return await new RevalidatedAuthenticationAction({
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
          }).execute()
        } finally {
          password.value = ''
        }
      })()
      if (
        fillOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted
      ) {
        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetGeneratePasswordFailed,
          ),
          enableContinue: true,
        })
        return
      }

      authenticationWorkflowUi.setStatus({
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetGeneratedPasswordFilled,
        ),
        enableContinue: false,
      })
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
        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            actuationResult ===
              RevalidatedAuthenticationActResultKind.ControlMissing
              ? BROWSER_MESSAGE_KEYS.WidgetPasskeyControlMissing
              : BROWSER_MESSAGE_KEYS.WidgetFillFailed,
          ),
          enableContinue: true,
        })
        return
      }

      authenticationWorkflowUi.setStatus({
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetPasskeyCeremonyStarted,
        ),
        enableContinue: false,
      })
      continueButton.hidden = true
      return
    }
    widgetState.busy = true
    continueButton.disabled = true

    authenticationWorkflowUi.setStatus({
      description,
      continueButton,
      text: workflowUi.translatedMessage(
        action === AuthenticationWorkflowAction.UsePasskey
          ? BROWSER_MESSAGE_KEYS.WidgetUsePasskeyWorking
          : BROWSER_MESSAGE_KEYS.WidgetCreatePasskeyWorking,
      ),
      enableContinue: false,
    })
    const approvalIsActive = () =>
      !widgetState.dismissed && continueButton.isConnected
    try {
      const observationBinding =
        RevalidatedAuthenticationAction.requiredAuthenticationObservationBinding(
          approval.facts,
        )

      const outcome = await new RevalidatedAuthenticationAction({
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
      }).execute()
      if (outcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted) {
        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            outcome.kind ===
              RevalidatedAuthenticationActionOutcomeKind.ControlMissing
              ? BROWSER_MESSAGE_KEYS.WidgetPasskeyControlMissing
              : BROWSER_MESSAGE_KEYS.WidgetFillFailed,
          ),
          enableContinue: true,
        })
        return
      }

      authenticationWorkflowUi.setStatus({
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          action === AuthenticationWorkflowAction.UsePasskey
            ? BROWSER_MESSAGE_KEYS.WidgetUsePasskey
            : BROWSER_MESSAGE_KEYS.WidgetCreatePasskey,
        ),
        enableContinue: true,
      })
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
    continueButton.disabled = true

    workflowUi.setFlightProgress({
      step,
      title,
      currentStep: 2,
      totalSteps: 3,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
    })

    authenticationWorkflowUi.setStatus({
      description,
      continueButton,
      text: workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetWorking),
      enableContinue: false,
    })

    try {
      const delivery =
        await authenticationRuntimeTransport.sendLoginOptionsRuntimeMessage({
          type: WebsiteLoginOptionsMessageType.NookWebsiteLoginOptions,
          payload: { origin: location.origin },
        })

      if (
        delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
        delivery.response.kind === WebsiteLoginOptionsKind.Rejected
      ) {
        workflowUi.setFlightProgress({
          step,
          title,
          currentStep: 1,
          totalSteps: 3,
          titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
        })

        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetFillFailed,
          ),
          enableContinue: true,
        })
        return
      }
      const { response } = delivery

      if (response.kind === WebsiteLoginOptionsKind.Locked) {
        workflowUi.setFlightProgress({
          step,
          title,
          currentStep: 1,
          totalSteps: 3,
          titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
        })

        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue,
          ),
          enableContinue: true,
        })
        return
      }

      if (response.kind === WebsiteLoginOptionsKind.Unavailable) {
        workflowUi.setFlightProgress({
          step,
          title,
          currentStep: 1,
          totalSteps: 3,
          titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
        })

        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetConnectVault,
          ),
          enableContinue: true,
        })
        return
      }

      if (!('accounts' in response)) return

      const accounts = response.accounts
      if (accounts.length === 0) {
        workflowUi.setFlightProgress({
          step,
          title,
          currentStep: 1,
          totalSteps: 3,
          titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
        })

        authenticationWorkflowUi.setStatus({
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetNoMatch,
          ),
          enableContinue: true,
        })
        return
      }

      if (accounts.length === 1) {
        await this.fillAndSubmitAccount({
          account: {
            ...accounts[0],
            authorizationGeneration: response.authorizationGeneration,
          },
          workflow,
          approval,
          step,
          title,
          description,
          continueButton,
        })
        return
      }

      await this.openLoginPicker({
        workflow,
        approval,
        step,
        title,
        description,
        continueButton,
      })
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
}

export const loginPasskeyInteraction = new LoginPasskeyInteraction()
