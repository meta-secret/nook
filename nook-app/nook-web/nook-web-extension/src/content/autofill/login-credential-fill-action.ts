import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import {
  FormSubmissionResult,
  PasswordFormQueryKind,
  passwordFormCredentialInteraction,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { WebsiteLoginRevealMessageType } from '../../lib/login-fill-messages'
import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowActivity,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { authentication_workflow_activity_progress } from './authentication-activity-progress'
import { WidgetControlDisposition, widgetState } from './state'
import { authenticationWorkflowUi } from './authentication-workflow-ui-state'
import { workflowUi } from './workflow-ui'
import {
  LoginFillDeliveryKind,
  loginFillRuntimeTransport,
} from './login-fill-runtime-adapter'
import {
  AuthenticationObservationBindingKind,
  RevalidatedAuthenticationAction,
  RevalidatedAuthenticationActionOutcomeKind,
  RevalidatedAuthenticationActResultKind,
  type AuthenticationObservationBinding,
} from './workflow-revalidation'
import type { FillAndSubmitAccountArgs } from './login-passkey-action-types'

/** Owns the credential reveal, fill, and form submission lifecycle. */
export class LoginCredentialFillAction {
  async fillAndSubmitAccount({
    account,
    workflow,
    step,
    title,
    description,
    continueButton,
  }: FillAndSubmitAccountArgs): Promise<boolean> {
    const approvalIsActive = () =>
      widgetState.controlDisposition(continueButton) ===
      WidgetControlDisposition.Active
    const showFillFailure = () => {
      const flightProgressRequest1: Parameters<
        typeof workflowUi.setFlightProgress
      >[0] = {
        step,
        title,
        ...authentication_workflow_activity_progress(
          AuthenticationWorkflowActivity.ReadyLogin,
        ),
        titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
      }
      workflowUi.setFlightProgress(flightProgressRequest1)
      const authenticationStatusRequest1: Parameters<
        typeof authenticationWorkflowUi.setStatus
      >[0] = {
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetFillFailed,
        ),
        enableContinue: true,
      }
      authenticationWorkflowUi.setStatus(authenticationStatusRequest1)
      return false
    }
    let releasedObservationBinding: AuthenticationObservationBinding = {
      kind: AuthenticationObservationBindingKind.Unbound,
    }
    const revalidationRequest1: ConstructorParameters<
      typeof RevalidatedAuthenticationAction
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
    const releaseOutcome = await new RevalidatedAuthenticationAction(
      revalidationRequest1,
    ).execute()
    if (
      releaseOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted
    ) {
      return showFillFailure()
    }
    const loginFillMessage1: Parameters<
      typeof loginFillRuntimeTransport.sendLoginFillMessage
    >[0] = {
      type: WebsiteLoginRevealMessageType.NookWebsiteLoginFill,
      payload: {
        origin: location.origin,
        vaultStoreId: account.vaultStoreId,
        secretId: account.secretId,
        authorizationGeneration: account.authorizationGeneration,
      },
    }
    const delivery =
      await loginFillRuntimeTransport.sendLoginFillMessage(loginFillMessage1)
    if (delivery.kind === LoginFillDeliveryKind.Unavailable) {
      return showFillFailure()
    }
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
    ) {
      return showFillFailure()
    }

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

      // Page frameworks may apply input-event state updates in their own
      // microtask. Cross the browser task boundary before rebuilding the
      // untrusted DOM facts and activating the approved submit control.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      await passwordFormInteraction.prepareCompanionWorkflowPolicies()
      const submissionRevalidationRequest: ConstructorParameters<
        typeof RevalidatedAuthenticationAction
      >[0] = {
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: {
          kind: AuthenticationObservationBindingKind.Unbound,
        },
        approvalIsActive,
        act: ({
          currentWorkflow,
          approvedFacts,
          revalidateCurrentWorkflow,
        }) => {
          const approvedAdvanceControl = approvedFacts.detailedAdvanceControl
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
          const loginSubmissionRequest1: Parameters<
            typeof passwordFormInteraction.submitLoginForm
          >[0] = {
            kind: PasswordFormQueryKind.Scoped,
            root: currentWorkflow.root,
            formScope: currentWorkflow.formScope,
            submissionApproval,
            approvedAdvanceControls:
              approvedAdvanceControl?.kind === 'observed'
                ? approvedAdvanceControl.observations
                : [],
          }
          submission.result = passwordFormInteraction.submitLoginForm(
            loginSubmissionRequest1,
          )
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
        const flightProgressRequest2: Parameters<
          typeof workflowUi.setFlightProgress
        >[0] = {
          step,
          title,
          ...authentication_workflow_activity_progress(
            AuthenticationWorkflowActivity.FillingLogin,
          ),
          titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
        }
        workflowUi.setFlightProgress(flightProgressRequest2)
        const authenticationStatusRequest2: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetFillFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(authenticationStatusRequest2)
        continueButton.hidden = false
        return false
      }
      if (submission.result === FormSubmissionResult.NotObserved) {
        const flightProgressRequest3: Parameters<
          typeof workflowUi.setFlightProgress
        >[0] = {
          step,
          title,
          ...authentication_workflow_activity_progress(
            AuthenticationWorkflowActivity.FillingLogin,
          ),
          titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
        }
        workflowUi.setFlightProgress(flightProgressRequest3)
        description.textContent = workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetFilledManual,
        )
        continueButton.hidden = true
        return true
      }
      const flightProgressRequest4: Parameters<
        typeof workflowUi.setFlightProgress
      >[0] = {
        step,
        title,
        ...authentication_workflow_activity_progress(
          AuthenticationWorkflowActivity.VerifyingLogin,
        ),
        titleKey: BROWSER_MESSAGE_KEYS.WidgetVerifyingTitle,
      }
      workflowUi.setFlightProgress(flightProgressRequest4)
      description.textContent = workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetSubmitted,
      )
      continueButton.hidden = true
      return true
    } finally {
      widgetState.credentialActuationInFlight = false
    }
  }
}

export const loginCredentialFillAction = new LoginCredentialFillAction()
