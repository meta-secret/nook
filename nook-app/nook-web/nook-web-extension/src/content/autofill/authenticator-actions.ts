import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'

import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'

import {
  PasswordFormQueryKind,
  passwordFormCredentialInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowActivity,
  authentication_workflow_activity_progress,
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
  RuntimeMessageDeliveryKind,
  authenticationWorkflowUi,
  authenticationRuntimeTransport,
} from './login-passkey-actions'

import {
  AuthenticatorPickerKind,
  WidgetWorkflowKeyKind,
  WidgetWorkflowRootKind,
  pickerState,
  widgetState,
} from './state'

import { workflowUi } from './workflow-ui'

import {
  AuthenticationObservationBindingKind,
  RevalidatedAuthenticationAction,
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
}

type AuthenticatorFillFailureArgs = Omit<
  FillAuthenticatorCodeArgs,
  'account' | 'workflow' | 'approval'
>

type ContinueWithAuthenticatorArgs = {
  workflow: PasswordFormObservation
  approval: AuthenticationWorkflowApproval
  step: HTMLParagraphElement
  title: HTMLHeadingElement
  description: HTMLParagraphElement
  continueButton: HTMLButtonElement
}

/** Owns the browser runtime resources shared by these interactions. */
type AuthenticatorInteractionContext = {
  readonly widgetState: typeof widgetState
  readonly pickerState: typeof pickerState
}
class AuthenticatorInteraction {
  constructor(private readonly ui: AuthenticatorInteractionContext) {}

  private reportAuthenticatorFillFailure({
    step,
    title,
    description,
    continueButton,
  }: AuthenticatorFillFailureArgs): false {
    const progressRequest: Parameters<typeof workflowUi.setFlightProgress>[0] =
      {
        step,
        title,
        ...authentication_workflow_activity_progress(
          AuthenticationWorkflowActivity.FillingAuthenticator,
        ),
        titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      }
    workflowUi.setFlightProgress(progressRequest)
    const statusRequest: Parameters<
      typeof authenticationWorkflowUi.setStatus
    >[0] = {
      description,
      continueButton,
      text: workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed,
      ),
      enableContinue: true,
    }
    authenticationWorkflowUi.setStatus(statusRequest)
    return false
  }

  async fillAuthenticatorCode({
    account,
    workflow,
    approval,
    step,
    title,
    description,
    continueButton,
  }: FillAuthenticatorCodeArgs): Promise<boolean> {
    const failureUi: AuthenticatorFillFailureArgs = {
      step,
      title,
      description,
      continueButton,
    }
    const approvalIsActive = () =>
      !this.ui.widgetState.dismissed && continueButton.isConnected
    let releasedObservationBinding: AuthenticationObservationBinding =
      RevalidatedAuthenticationAction.requiredAuthenticationObservationBinding(
        approval.facts,
      )
    const releaseRequest: ConstructorParameters<
      typeof RevalidatedAuthenticationAction
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
    const releaseOutcome = await new RevalidatedAuthenticationAction(
      releaseRequest,
    ).execute()
    if (
      releaseOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted
    ) {
      return this.reportAuthenticatorFillFailure(failureUi)
    }
    const message: Parameters<
      typeof authenticationRuntimeTransport.sendAuthenticatorCodeRuntimeMessage
    >[0] = {
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
    const delivery =
      await authenticationRuntimeTransport.sendAuthenticatorCodeRuntimeMessage(
        message,
      )
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return this.reportAuthenticatorFillFailure(failureUi)
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
      return this.reportAuthenticatorFillFailure(failureUi)
    }
    const code = { value: response.code }
    const expiresAt = response.expiresAt
    response.code = ''
    if (expiresAt <= Date.now()) {
      code.value = ''
      return this.reportAuthenticatorFillFailure(failureUi)
    }
    const revalidationRequest: ConstructorParameters<
      typeof RevalidatedAuthenticationAction
    >[0] = {
      workflow,
      expectedAction: AuthenticationWorkflowAction.FillTotp,
      observationBinding: releasedObservationBinding,
      approvalIsActive,
      act: ({ currentWorkflow }) => {
        if (expiresAt <= Date.now()) {
          return { kind: RevalidatedAuthenticationActResultKind.Failed }
        }
        const nookTypedArgs0_4: Parameters<
          typeof passwordFormCredentialInteraction.fillOneTimeCode
        >[0] = {
          code: code.value,
          kind: PasswordFormQueryKind.Scoped,
          root: currentWorkflow.root,
          formScope: currentWorkflow.formScope,
        }
        return {
          kind: passwordFormCredentialInteraction.fillOneTimeCode(
            nookTypedArgs0_4,
          )
            ? RevalidatedAuthenticationActResultKind.Acted
            : RevalidatedAuthenticationActResultKind.Failed,
        }
      },
    }
    const fillOutcome = await (async () => {
      try {
        return await new RevalidatedAuthenticationAction(
          revalidationRequest,
        ).execute()
      } finally {
        code.value = ''
      }
    })()
    if (fillOutcome.kind !== RevalidatedAuthenticationActionOutcomeKind.Acted) {
      return this.reportAuthenticatorFillFailure(failureUi)
    }
    const nookTypedArgs0_7: Parameters<typeof workflowUi.setFlightProgress>[0] =
      {
        step,
        title,
        ...authentication_workflow_activity_progress(
          AuthenticationWorkflowActivity.FillingAuthenticator,
        ),
        titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      }
    workflowUi.setFlightProgress(nookTypedArgs0_7)
    description.textContent = workflowUi.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFilled,
    )
    continueButton.hidden = true
    return true
  }

  async continueWithAuthenticator({
    workflow,
    approval,
    step,
    title,
    description,
    continueButton,
  }: ContinueWithAuthenticatorArgs): Promise<void> {
    if (
      this.ui.widgetState.busy ||
      this.ui.pickerState.authenticator.kind === AuthenticatorPickerKind.Open
    ) {
      return
    }
    this.ui.widgetState.busy = true
    continueButton.disabled = true
    const nookTypedArgs0_8: Parameters<typeof workflowUi.setFlightProgress>[0] =
      {
        step,
        title,
        ...authentication_workflow_activity_progress(
          AuthenticationWorkflowActivity.FillingAuthenticator,
        ),
        titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
      }
    workflowUi.setFlightProgress(nookTypedArgs0_8)
    const nookTypedArgs0_9: Parameters<
      typeof authenticationWorkflowUi.setStatus
    >[0] = {
      description,
      continueButton,
      text: workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetAuthenticatorWorking,
      ),
      enableContinue: false,
    }
    authenticationWorkflowUi.setStatus(nookTypedArgs0_9)

    try {
      const message: Parameters<
        typeof authenticationRuntimeTransport.sendAuthenticatorPickerOpenRuntimeMessage
      >[0] = {
        type: WebsiteAuthenticatorPickerOpenMessageType.NookWebsiteAuthenticatorPickerOpen,
        payload: { origin: location.origin },
      }
      const delivery =
        await authenticationRuntimeTransport.sendAuthenticatorPickerOpenRuntimeMessage(
          message,
        )
      if (
        delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
        delivery.response.kind === AuthenticatorPickerOpenResponseKind.Rejected
      ) {
        const nookTypedArgs0_10: Parameters<
          typeof workflowUi.setFlightProgress
        >[0] = {
          step,
          title,
          ...authentication_workflow_activity_progress(
            AuthenticationWorkflowActivity.FillingAuthenticator,
          ),
          titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
        }
        workflowUi.setFlightProgress(nookTypedArgs0_10)
        const nookTypedArgs0_11: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(nookTypedArgs0_11)
        return
      }
      const { response } = delivery
      if (response.kind === AuthenticatorPickerOpenResponseKind.Locked) {
        const nookTypedArgs0_12: Parameters<
          typeof workflowUi.setFlightProgress
        >[0] = {
          step,
          title,
          ...authentication_workflow_activity_progress(
            AuthenticationWorkflowActivity.FillingAuthenticator,
          ),
          titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
        }
        workflowUi.setFlightProgress(nookTypedArgs0_12)
        const nookTypedArgs0_13: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetAuthenticatorUnlock,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(nookTypedArgs0_13)
        return
      }

      if (response.kind === AuthenticatorPickerOpenResponseKind.Unavailable) {
        const nookTypedArgs0_14: Parameters<
          typeof workflowUi.setFlightProgress
        >[0] = {
          step,
          title,
          ...authentication_workflow_activity_progress(
            AuthenticationWorkflowActivity.FillingAuthenticator,
          ),
          titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
        }
        workflowUi.setFlightProgress(nookTypedArgs0_14)
        const nookTypedArgs0_15: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetConnectVault,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(nookTypedArgs0_15)
        return
      }

      if (
        response.kind !== AuthenticatorPickerOpenResponseKind.Ready ||
        !('requestId' in response) ||
        response.expiresAt <= Date.now()
      ) {
        const nookTypedArgs0_16: Parameters<
          typeof workflowUi.setFlightProgress
        >[0] = {
          step,
          title,
          ...authentication_workflow_activity_progress(
            AuthenticationWorkflowActivity.FillingAuthenticator,
          ),
          titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
        }
        workflowUi.setFlightProgress(nookTypedArgs0_16)
        const nookTypedArgs0_17: Parameters<
          typeof authenticationWorkflowUi.setStatus
        >[0] = {
          description,
          continueButton,
          text: workflowUi.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed,
          ),
          enableContinue: true,
        }
        authenticationWorkflowUi.setStatus(nookTypedArgs0_17)
        return
      }
      const requestId = response.requestId
      if (this.ui.widgetState.dismissed || !continueButton.isConnected) {
        this.cancelAuthenticatorPickerRequest(requestId)
        return
      }
      if (
        !authenticationWorkflowUi.approvedWorkflowIsStillCurrent(workflow) ||
        this.ui.widgetState.workflowKey.kind !==
          WidgetWorkflowKeyKind.Assigned ||
        this.ui.widgetState.renderedWorkflowRoot.kind !==
          WidgetWorkflowRootKind.Assigned
      ) {
        this.cancelAuthenticatorPickerRequest(requestId)
        return
      }
      const timeoutId = window.setTimeout(
        () => {
          if (
            this.ui.pickerState.authenticator.kind !==
              AuthenticatorPickerKind.Open ||
            this.ui.pickerState.authenticator.request.requestId !== requestId
          ) {
            return
          }
          const pending = this.ui.pickerState.authenticator.request
          this.ui.pickerState.clearPendingAuthenticator()
          const nookTypedArgs0_18: Parameters<
            typeof authenticationWorkflowUi.setStatus
          >[0] = {
            description: pending.description,
            continueButton: pending.continueButton,
            text: workflowUi.translatedMessage(
              BROWSER_MESSAGE_KEYS.WidgetAuthenticatorFillFailed,
            ),
            enableContinue: true,
          }
          authenticationWorkflowUi.setStatus(nookTypedArgs0_18)
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
        typeof this.ui.pickerState.openAuthenticator
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
      this.ui.pickerState.openAuthenticator(nookTypedArgs0_2)
      const nookTypedArgs0_19: Parameters<
        typeof workflowUi.setFlightProgress
      >[0] = {
        step,
        title,
        ...authentication_workflow_activity_progress(
          AuthenticationWorkflowActivity.FillingAuthenticator,
        ),
        titleKey: BROWSER_MESSAGE_KEYS.WidgetAuthenticatorTitle,
      }
      workflowUi.setFlightProgress(nookTypedArgs0_19)
      const nookTypedArgs0_20: Parameters<
        typeof authenticationWorkflowUi.setStatus
      >[0] = {
        description,
        continueButton,
        text: workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetAuthenticatorPickerOpened,
        ),
        enableContinue: true,
      }
      authenticationWorkflowUi.setStatus(nookTypedArgs0_20)
    } finally {
      this.ui.widgetState.busy = false
      if (
        this.ui.pickerState.authenticator.kind ===
          AuthenticatorPickerKind.Closed &&
        continueButton.isConnected &&
        !continueButton.hidden
      ) {
        continueButton.disabled = false
      }
    }
  }

  private cancelAuthenticatorPickerRequest(requestId: string): void {
    const message: Parameters<
      typeof authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse
    >[0] = {
      type: AuthenticatorPickerCancelMessageType.NookAuthenticatorPickerCancel,
      payload: { requestId },
    }
    authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse(message)
  }

  cancelPendingAuthenticatorPickerRequest(): void {
    if (
      this.ui.pickerState.authenticator.kind === AuthenticatorPickerKind.Closed
    )
      return
    const pending = this.ui.pickerState.authenticator.request
    this.ui.pickerState.clearPendingAuthenticator()
    window.clearTimeout(pending.timeoutId)
    this.cancelAuthenticatorPickerRequest(pending.requestId)
  }
}

export const authenticatorInteraction = new AuthenticatorInteraction({
  widgetState,
  pickerState,
})
