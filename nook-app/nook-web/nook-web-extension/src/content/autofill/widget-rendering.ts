import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'

import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'

import { AuthenticationGesture } from '../../lib/auth-widget-policy'

import {
  type AuthenticationWorkflowApproval,
  type AuthenticationWorkflowSnapshotView,
  AuthenticationWorkflowApproval as AuthenticationWorkflowApprovalSchema,
} from '../../lib/auth-workflow-messages'

import {
  AuthenticationWorkflowAction,
  saved_login_action_available,
  type AuthenticationPageObservationFacts,
  type WebsiteLoginMatchAvailability,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

import {
  type EnrollmentPageHints,
  authenticatorEnrollmentInteraction,
} from '../enrollment-flow'

import { RevalidatedEnrollmentAction } from './backup-code-workflow-action'

import {
  SelectedEnrollmentPresentation,
  SupplementalEnrollmentPresentation,
} from './enrollment-action-presentation'

import { authenticatorInteraction } from './authenticator-actions'

import { loginPasskeyInteraction } from './login-passkey-actions'

import {
  AuthenticatorPickerKind,
  LoginPickerKind,
  WidgetHostKind,
  WidgetWorkflowKeyKind,
  WidgetWorkflowRootKind,
  pickerState,
  widgetState,
} from './state'

import { authenticationWidgetShell } from './widget-shell'

import type { PilotVaultConnection } from './workflow-ui'

import { WorkflowCopy, workflowUi } from './workflow-ui'

type RenderEnrollmentWidgetArgs = {
  hints: EnrollmentPageHints
  snapshot: AuthenticationWorkflowSnapshotView
  vaultConnection: PilotVaultConnection
}

type RenderWidgetArgs = {
  snapshot: AuthenticationWorkflowSnapshotView
  workflow: PasswordFormObservation
  facts: AuthenticationPageObservationFacts
  loginMatches: WebsiteLoginMatchAvailability
  vaultConnection: PilotVaultConnection
}

/** Owns the browser runtime resources shared by these interactions. */
type AuthenticationWidgetRendererContext = {
  readonly widgetState: typeof widgetState
  readonly pickerState: typeof pickerState
}
class AuthenticationWidgetRenderer {
  constructor(private readonly ui: AuthenticationWidgetRendererContext) {}

  renderEnrollmentWidget({
    hints,
    snapshot,
    vaultConnection,
  }: RenderEnrollmentWidgetArgs): void {
    if (this.ui.widgetState.dismissed) {
      workflowUi.removeWidget()
      return
    }
    const workflowKey = [
      'enrollment',
      snapshot.action,
      snapshot.currentStep,
      snapshot.totalSteps,
      hints.qr ? 'qr' : '',
      hints.backupCodes ? 'backup' : '',
      vaultConnection.connected ? 'connected' : 'disconnected',
      ((v) => (v ? v : ''))(vaultConnection.vaultName),
    ].join(':')
    if (this.ui.pickerState.login.kind === LoginPickerKind.Open) {
      loginPasskeyInteraction.cancelPendingLoginPickerRequest()
    }
    if (
      this.ui.pickerState.authenticator.kind === AuthenticatorPickerKind.Open
    ) {
      authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
    }
    if (
      this.ui.widgetState.host.kind === WidgetHostKind.Attached &&
      this.ui.widgetState.workflowKey.kind === WidgetWorkflowKeyKind.Assigned &&
      this.ui.widgetState.workflowKey.key === workflowKey
    ) {
      return
    }
    if (this.ui.widgetState.host.kind === WidgetHostKind.Attached)
      workflowUi.removeWidget()

    const nookTypedArgs0_0: Parameters<
      typeof authenticationWidgetShell.createWidgetShell
    >[0] = {
      copy: authenticationWidgetShell.enrollmentCopy(hints),
      vaultConnection,
      currentStep: snapshot.currentStep,
      totalSteps: snapshot.totalSteps,
    }
    const shell = authenticationWidgetShell.createWidgetShell(nookTypedArgs0_0)
    const { body, step, title, description, continueButton, openVaultButton } =
      shell
    continueButton.hidden = true
    openVaultButton.hidden = true
    const workflowRoot: Parameters<
      typeof authenticationWidgetShell.mountWidgetShell
    >[0]['workflowRoot'] = {
      kind: WidgetWorkflowRootKind.Unassigned,
    }
    const nookTypedArgs0_1: Parameters<
      typeof authenticationWidgetShell.mountWidgetShell
    >[0] = {
      shell,
      workflowKey,
      workflowRoot,
    }
    authenticationWidgetShell.mountWidgetShell(nookTypedArgs0_1)

    const nookTypedArgs0_2: Parameters<
      typeof authenticationWidgetShell.buildEnrollmentFlowHost
    >[0] = {
      panel: body,
      step,
      title,
      description,
      continueButton,
      openVaultButton,
    }
    const nookTypedArgs1_0: Parameters<
      typeof authenticatorEnrollmentInteraction.renderEnrollmentActions
    >[0] = {
      host: authenticationWidgetShell.buildEnrollmentFlowHost(nookTypedArgs0_2),
      hints: new SelectedEnrollmentPresentation(snapshot.action).hints,
    }
    authenticatorEnrollmentInteraction.renderEnrollmentActions(nookTypedArgs1_0)
  }

  renderWidget({
    snapshot,
    workflow,
    facts,
    loginMatches,
    vaultConnection,
  }: RenderWidgetArgs): void {
    if (this.ui.widgetState.dismissed) {
      workflowUi.removeWidget()
      return
    }
    const workflowKey = [
      snapshot.kind,
      snapshot.stage,
      snapshot.action,
      snapshot.currentStep,
      snapshot.totalSteps,
      snapshot.observationIndex,
      loginMatches.kind,
      'count' in loginMatches ? loginMatches.count : 0,
      vaultConnection.connected ? 'connected' : 'disconnected',
      ((v) => (v ? v : ''))(vaultConnection.vaultName),
    ].join(':')
    const currentApproval: AuthenticationWorkflowApproval = {
      workflowKey,
      facts,
    }
    if (this.ui.pickerState.login.kind === LoginPickerKind.Open) {
      const approvalPair: Parameters<
        typeof AuthenticationWorkflowApprovalSchema.authenticationWorkflowApprovalsMatch
      >[0] = {
        approved: this.ui.pickerState.login.request.approval,
        current: currentApproval,
      }
      if (
        !AuthenticationWorkflowApprovalSchema.authenticationWorkflowApprovalsMatch(
          approvalPair,
        )
      ) {
        loginPasskeyInteraction.cancelPendingLoginPickerRequest()
      }
    }
    if (
      this.ui.pickerState.authenticator.kind === AuthenticatorPickerKind.Open
    ) {
      const approvalPair: Parameters<
        typeof AuthenticationWorkflowApprovalSchema.authenticationWorkflowApprovalsMatch
      >[0] = {
        approved: this.ui.pickerState.authenticator.request.approval,
        current: currentApproval,
      }
      if (
        !AuthenticationWorkflowApprovalSchema.authenticationWorkflowApprovalsMatch(
          approvalPair,
        )
      ) {
        authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
      }
    }
    if (
      this.ui.widgetState.host.kind === WidgetHostKind.Attached &&
      this.ui.widgetState.workflowKey.kind === WidgetWorkflowKeyKind.Assigned &&
      this.ui.widgetState.workflowKey.key === workflowKey &&
      this.ui.widgetState.renderedWorkflowRoot.kind ===
        WidgetWorkflowRootKind.Assigned &&
      this.ui.widgetState.renderedWorkflowRoot.observation.root ===
        workflow.root &&
      this.ui.widgetState.renderedWorkflowRoot.observation.formScope.kind ===
        workflow.formScope.kind &&
      (this.ui.widgetState.renderedWorkflowRoot.observation.formScope.kind !==
        'owned' ||
        (workflow.formScope.kind === 'owned' &&
          this.ui.widgetState.renderedWorkflowRoot.observation.formScope
            .owner === workflow.formScope.owner))
    ) {
      const renderedWorkflowRoot: Parameters<
        typeof this.ui.widgetState.setRenderedWorkflowRoot
      >[0] = {
        kind: WidgetWorkflowRootKind.Assigned,
        observation: workflow,
        facts,
      }
      this.ui.widgetState.setRenderedWorkflowRoot(renderedWorkflowRoot)
      return
    }
    if (this.ui.widgetState.host.kind === WidgetHostKind.Attached)
      workflowUi.removeWidget()

    const enrollmentAction =
      snapshot.action === AuthenticationWorkflowAction.EnrollAuthenticator ||
      snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes
    const nookTypedArgs0_3: Parameters<
      typeof authenticationWidgetShell.createWidgetShell
    >[0] = {
      copy: enrollmentAction
        ? authenticationWidgetShell.enrollmentCopy(
            new SelectedEnrollmentPresentation(snapshot.action).hints,
          )
        : WorkflowCopy.forKind(snapshot.kind),
      vaultConnection,
      currentStep: snapshot.currentStep,
      totalSteps: snapshot.totalSteps,
    }
    const shell = authenticationWidgetShell.createWidgetShell(nookTypedArgs0_3)
    const { body, step, title, description, continueButton, openVaultButton } =
      shell
    const canContinueWithNook =
      snapshot.action === AuthenticationWorkflowAction.ContinueWithNook ||
      snapshot.action === AuthenticationWorkflowAction.FillTotp ||
      snapshot.action === AuthenticationWorkflowAction.EnrollAuthenticator ||
      snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes ||
      snapshot.action === AuthenticationWorkflowAction.GeneratePassword ||
      snapshot.action === AuthenticationWorkflowAction.UsePasskey ||
      snapshot.action === AuthenticationWorkflowAction.CreatePasskey
    const continueMessageKey =
      snapshot.action === AuthenticationWorkflowAction.FillTotp
        ? BROWSER_MESSAGE_KEYS.WidgetFillAuthenticator
        : snapshot.action === AuthenticationWorkflowAction.EnrollAuthenticator
          ? BROWSER_MESSAGE_KEYS.WidgetAddFromPage
          : snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes
            ? BROWSER_MESSAGE_KEYS.WidgetSaveBackupCodes
            : snapshot.action === AuthenticationWorkflowAction.GeneratePassword
              ? BROWSER_MESSAGE_KEYS.WidgetGeneratePassword
              : snapshot.action === AuthenticationWorkflowAction.UsePasskey
                ? BROWSER_MESSAGE_KEYS.WidgetUsePasskey
                : snapshot.action === AuthenticationWorkflowAction.CreatePasskey
                  ? BROWSER_MESSAGE_KEYS.WidgetCreatePasskey
                  : canContinueWithNook
                    ? BROWSER_MESSAGE_KEYS.WidgetContinue
                    : BROWSER_MESSAGE_KEYS.WidgetTakeOver
    continueButton.setAttribute(
      'aria-label',
      workflowUi.translatedMessage(continueMessageKey),
    )
    continueButton.textContent =
      workflowUi.translatedMessage(continueMessageKey)

    continueButton.addEventListener('click', (event) => {
      if (!new AuthenticationGesture(event).trusted) return
      if (!canContinueWithNook) {
        authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
        loginPasskeyInteraction.cancelPendingLoginPickerRequest()
        this.ui.widgetState.dismissed = true
        workflowUi.removeWidget()
        return
      }
      if (snapshot.action === AuthenticationWorkflowAction.FillTotp) {
        const nookTypedArgs0_4: Parameters<
          typeof authenticatorInteraction.continueWithAuthenticator
        >[0] = {
          workflow,
          step,
          title,
          description,
          continueButton,
          approval: currentApproval,
        }
        void authenticatorInteraction.continueWithAuthenticator(
          nookTypedArgs0_4,
        )
      } else if (
        snapshot.action === AuthenticationWorkflowAction.EnrollAuthenticator ||
        snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes
      ) {
        const hostRequest: Parameters<
          typeof authenticationWidgetShell.buildEnrollmentFlowHost
        >[0] = {
          panel: body,
          step,
          title,
          description,
          continueButton,
          openVaultButton,
        }
        const host =
          authenticationWidgetShell.buildEnrollmentFlowHost(hostRequest)
        const enrollmentRequest: ConstructorParameters<
          typeof RevalidatedEnrollmentAction
        >[0] = {
          workflow,
          host,
          action: snapshot.action,
          start: () => {
            if (
              snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes
            ) {
              const startRequest: Parameters<
                typeof authenticatorEnrollmentInteraction.startBackupCodeEnrollment
              >[0] = { host }
              authenticatorEnrollmentInteraction.startBackupCodeEnrollment(
                startRequest,
              )
            } else {
              const section = document.createElement('section')
              body.append(section)
              const startRequest: Parameters<
                typeof authenticatorEnrollmentInteraction.startQrEnrollment
              >[0] = {
                host,
                section,
              }
              void authenticatorEnrollmentInteraction.startQrEnrollment(
                startRequest,
              )
            }
          },
        }
        void new RevalidatedEnrollmentAction(enrollmentRequest).execute()
      } else if (
        snapshot.action === AuthenticationWorkflowAction.GeneratePassword
      ) {
        const nookTypedArgs0_5: Parameters<
          typeof loginPasskeyInteraction.generatePasswordWithNook
        >[0] = {
          workflow,
          step,
          title,
          description,
          continueButton,
          approval: currentApproval,
        }
        void loginPasskeyInteraction.generatePasswordWithNook(nookTypedArgs0_5)
      } else if (
        snapshot.action === AuthenticationWorkflowAction.UsePasskey ||
        snapshot.action === AuthenticationWorkflowAction.CreatePasskey
      ) {
        loginPasskeyInteraction.cancelPendingLoginPickerRequest()
        const nookTypedArgs0_6: Parameters<
          typeof loginPasskeyInteraction.proposePasskeyWithNook
        >[0] = {
          description,
          continueButton,
          action: snapshot.action,
          workflow,
          approval: currentApproval,
        }
        void loginPasskeyInteraction.proposePasskeyWithNook(nookTypedArgs0_6)
      } else {
        const nookTypedArgs0_7: Parameters<
          typeof loginPasskeyInteraction.continueWithNook
        >[0] = {
          step,
          title,
          description,
          continueButton,
          workflow,
          approval: currentApproval,
        }
        void loginPasskeyInteraction.continueWithNook(nookTypedArgs0_7)
      }
    })

    const takeOverButton = document.createElement('button')
    takeOverButton.type = 'button'
    takeOverButton.className = 'text-button'
    takeOverButton.textContent = workflowUi.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetTakeOver,
    )
    takeOverButton.hidden = !canContinueWithNook
    takeOverButton.addEventListener('click', (event) => {
      if (!new AuthenticationGesture(event).trusted) return
      authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
      loginPasskeyInteraction.cancelPendingLoginPickerRequest()
      this.ui.widgetState.dismissed = true
      workflowUi.removeWidget()
    })

    body.append(takeOverButton)
    if (
      saved_login_action_available({ action: snapshot.action, loginMatches })
    ) {
      const savedLoginButton = document.createElement('button')
      savedLoginButton.type = 'button'
      savedLoginButton.className = 'text-button'
      savedLoginButton.textContent = workflowUi.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetContinue,
      )
      savedLoginButton.addEventListener('click', (event) => {
        if (!new AuthenticationGesture(event).trusted) return
        const nookTypedArgs0_10: Parameters<
          typeof loginPasskeyInteraction.continueWithNook
        >[0] = {
          step,
          title,
          description,
          continueButton: savedLoginButton,
          workflow,
          approval: currentApproval,
        }
        void loginPasskeyInteraction.continueWithNook(nookTypedArgs0_10)
      })
      body.append(savedLoginButton)
    }
    const nookTypedArgs0_1: Parameters<
      typeof authenticationWidgetShell.mountWidgetShell
    >[0]['workflowRoot'] = {
      kind: WidgetWorkflowRootKind.Assigned,
      observation: workflow,
      facts,
    }
    const nookTypedArgs0_8: Parameters<
      typeof authenticationWidgetShell.mountWidgetShell
    >[0] = {
      shell,
      workflowKey,
      workflowRoot: nookTypedArgs0_1,
    }
    authenticationWidgetShell.mountWidgetShell(nookTypedArgs0_8)

    const enrollmentHints =
      authenticatorEnrollmentInteraction.detectEnrollmentHints()
    const supplementalHintsRequest: ConstructorParameters<
      typeof SupplementalEnrollmentPresentation
    >[0] = { action: snapshot.action, detected: enrollmentHints }
    const supplementalHints = new SupplementalEnrollmentPresentation(
      supplementalHintsRequest,
    ).hints
    if (supplementalHints.qr || supplementalHints.backupCodes) {
      const nookTypedArgs0_9: Parameters<
        typeof authenticationWidgetShell.buildEnrollmentFlowHost
      >[0] = {
        panel: body,
        step,
        title,
        description,
        continueButton,
        openVaultButton,
      }
      const nookTypedArgs1_1: Parameters<
        typeof authenticatorEnrollmentInteraction.renderEnrollmentActions
      >[0] = {
        host: authenticationWidgetShell.buildEnrollmentFlowHost(
          nookTypedArgs0_9,
        ),
        hints: supplementalHints,
      }
      authenticatorEnrollmentInteraction.renderEnrollmentActions(
        nookTypedArgs1_1,
      )
    }
  }
}

export const authenticationWidgetRenderer = new AuthenticationWidgetRenderer({
  widgetState,
  pickerState,
})
