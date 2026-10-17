import {
  FormSubmissionResult,
  PasswordFormQueryKind,
  passwordFormCredentialInteraction,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { WebsiteLoginRevealMessageType } from '../../lib/login-fill-messages'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import {
  WidgetControlDisposition,
  widgetState,
  scanState,
  WidgetCredentialActuation,
} from './state'
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
import { GoogleLoginStartDisposition } from './google-login-continuation'
import {
  LoginFillProgress,
  LoginFillStartKind,
  type LoginFillControls,
  type LoginFillProgressRequest,
} from './login-fill-progress'
import { SignInAttemptLogin } from './sign-in-attempt-login'

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
    const controls: LoginFillControls = {
      step,
      title,
      description,
      continueButton,
    }
    // Google's selected username advance runs its own continuation; only the
    // fill-and-submit path below is a tracked sign-in attempt.
    const preflight = LoginFillProgress.untracked(controls)
    const approvalIsActive = () =>
      widgetState.controlDisposition(continueButton) ===
      WidgetControlDisposition.Active
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
      return preflight.fillFailed()
    }
    const googleRequest: Parameters<
      typeof widgetState.googleLoginContinuation.start
    >[0] = { account, workflow, approvalIsActive }
    let googleStart: GoogleLoginStartDisposition
    widgetState.credentialActuation = WidgetCredentialActuation.WorkflowFill
    try {
      googleStart =
        await widgetState.googleLoginContinuation.start(googleRequest)
    } finally {
      widgetState.credentialActuation = WidgetCredentialActuation.Idle
    }
    switch (googleStart) {
      case GoogleLoginStartDisposition.Started:
        description.textContent = workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetFilledManual,
        )
        continueButton.hidden = true
        scanState.schedule()
        return true
      case GoogleLoginStartDisposition.Rejected:
        return preflight.fillFailed()
      case GoogleLoginStartDisposition.OtherPage:
        break
    }
    const progressRequest: LoginFillProgressRequest = {
      controls,
      login: SignInAttemptLogin.reference(account),
    }
    const start = await LoginFillProgress.start(progressRequest)
    const progress = start.progress
    switch (start.kind) {
      case LoginFillStartKind.Unavailable:
        return progress.fillFailed()
      case LoginFillStartKind.Started:
        break
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
      return progress.fillFailed()
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
      return progress.fillFailed()
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
    widgetState.credentialActuation = WidgetCredentialActuation.WorkflowFill
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
        return progress.fillFailed()
      }
      const approvedFillRequest = filledRequest
      if (!approvedFillRequest) return false
      await progress.filled()

      // Page frameworks may apply input-event state updates in their own
      // microtask. Cross the browser task boundary before rebuilding the
      // untrusted DOM facts and activating the approved submit control.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      const companionPoliciesRequest: Parameters<
        typeof passwordFormInteraction.prepareCompanionWorkflowPolicies
      >[0] = {
        authenticatorSetupHint: 'absent',
        backupCodesHint: false,
      }
      await passwordFormInteraction.prepareCompanionWorkflowPolicies(
        companionPoliciesRequest,
      )
      await progress.submitting()
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
          submission.result = progress.submit(() =>
            passwordFormInteraction.submitLoginForm(loginSubmissionRequest1),
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
        return progress.fillFailed()
      }
      return await progress.submission(submission.result)
    } catch (error) {
      await progress.aborted()
      throw error
    } finally {
      widgetState.credentialActuation = WidgetCredentialActuation.Idle
      scanState.schedule()
    }
  }
}

export const loginCredentialFillAction = new LoginCredentialFillAction()
