import { LoginChecklistMountKind } from './state'
import type { AuthenticationAuthenticatorSetupSnapshot } from '../../lib/page-qr-capture'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'
import { LoginChecklistProgress } from './login-checklist-progress'

import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'

import { AuthenticationGesture } from '../../lib/auth-widget-policy'

import {
  type AuthenticationWorkflowApproval,
  type AuthenticationWorkflowSnapshotView,
} from '../../lib/auth-workflow-messages'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
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
  WidgetRenderDisposition,
  PendingPickerApprovalDisposition,
  WidgetWorkflowRootKind,
  pickerState,
  widgetState,
} from './state'

import { authenticationWidgetShell } from './widget-shell'

import type { PilotVaultConnection } from './workflow-ui'

import { WorkflowCopy, workflowUi } from './workflow-ui'
import {
  SavedLoginPresentation,
  SavedLoginPresentationKind,
  WidgetVaultGate,
  WidgetVaultGateKind,
  WidgetVaultPresentationProjection,
  WidgetVaultRequirement,
  type WidgetVaultPresentation,
} from './widget-presentation-state'
import {
  VaultConnectResumeKind,
  WidgetVaultGateSurface,
  type WidgetVaultGateMount,
} from './widget-vault-gate'
import { PilotVaultOpening } from './pilot-vault-opening'
import { authenticationWidgetWorkflowKey } from './widget-workflow-key'

type RenderEnrollmentWidgetArgs = {
  authenticatorSetupSnapshot: AuthenticationAuthenticatorSetupSnapshot
  hints: EnrollmentPageHints
  snapshot: AuthenticationWorkflowSnapshotView
  vaultConnection: PilotVaultConnection
}

type RenderWidgetArgs = {
  authenticatorSetupSnapshot: AuthenticationAuthenticatorSetupSnapshot
  snapshot: AuthenticationWorkflowSnapshotView
  workflow: PasswordFormObservation
  facts: AuthenticationPageObservationFacts
  loginMatches: WebsiteLoginMatchAvailability
  vaultConnection: PilotVaultConnection
  factsBindingToken: string | false
  savedLoginActionAvailable: boolean
}

type MountVaultGateArgs = {
  readonly shell: ReturnType<typeof authenticationWidgetShell.createWidgetShell>
  readonly presentation: WidgetVaultPresentation
  readonly requirement: WidgetVaultRequirement
}

type MountLoginChecklistArgs = ConstructorParameters<
  typeof LoginChecklistProgress
>[0] & {
  readonly presentation: SavedLoginPresentationKind
}

/** Owns the browser runtime resources shared by these interactions. */
type AuthenticationWidgetRendererContext = {
  readonly widgetState: typeof widgetState
  readonly pickerState: typeof pickerState
}
class AuthenticationWidgetRenderer {
  constructor(private readonly ui: AuthenticationWidgetRendererContext) {}

  /** Take over and password generation run without the vault; every other
   * Pilot action reads or writes it. */
  private vaultRequirement(
    action: AuthenticationWorkflowAction,
  ): WidgetVaultRequirement {
    switch (action) {
      case AuthenticationWorkflowAction.TakeOver:
      case AuthenticationWorkflowAction.GeneratePassword:
        return WidgetVaultRequirement.NotRequired
      case AuthenticationWorkflowAction.ContinueWithNook:
      case AuthenticationWorkflowAction.FillTotp:
      case AuthenticationWorkflowAction.EnrollAuthenticator:
      case AuthenticationWorkflowAction.SaveBackupCodes:
      case AuthenticationWorkflowAction.UsePasskey:
      case AuthenticationWorkflowAction.CreatePasskey:
        return WidgetVaultRequirement.Required
    }
  }

  /** Renders the connect-first or unlock-first state when the vault action cannot run. */
  private vaultGate(request: MountVaultGateArgs): WidgetVaultGateKind {
    const gate = WidgetVaultGate.decide(request)
    switch (gate) {
      case WidgetVaultGateKind.Open:
        return gate
      case WidgetVaultGateKind.Connect:
      case WidgetVaultGateKind.Unlock: {
        const mount: WidgetVaultGateMount = {
          shell: request.shell,
          gate,
          resume: { kind: VaultConnectResumeKind.Page },
        }
        WidgetVaultGateSurface.render(mount)
        return gate
      }
    }
  }

  private async mountLoginChecklist(
    request: MountLoginChecklistArgs,
  ): Promise<void> {
    switch (request.presentation) {
      case SavedLoginPresentationKind.Empty:
        return
      case SavedLoginPresentationKind.Workflow:
        break
    }
    const checklist = new LoginChecklistProgress(request)
    this.ui.widgetState.loginChecklist = {
      kind: LoginChecklistMountKind.Mounted,
      progress: checklist,
    }
    await checklist.initialize()
  }

  renderEnrollmentWidget({
    authenticatorSetupSnapshot,
    hints,
    snapshot,
    vaultConnection,
  }: RenderEnrollmentWidgetArgs): void {
    if (this.ui.widgetState.dismissed) {
      workflowUi.removeWidget()
      return
    }
    const vaultPresentation =
      WidgetVaultPresentationProjection.forConnection(vaultConnection)
    const workflowKey = [
      'enrollment',
      snapshot.action,
      snapshot.currentStep,
      snapshot.totalSteps,
      hints.qr,
      hints.backupCodes ? 'backup' : '',
      vaultPresentation.kind,
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
      this.ui.widgetState.enrollmentRenderDisposition(workflowKey) ===
      WidgetRenderDisposition.Reuse
    ) {
      return
    }
    if (this.ui.widgetState.host.kind === WidgetHostKind.Attached)
      workflowUi.removeWidget()

    const nookTypedArgs0_0: Parameters<
      typeof authenticationWidgetShell.createWidgetShell
    >[0] = {
      copy: authenticationWidgetShell.enrollmentCopy(hints),
      vaultPresentation,
      savedLoginAction: false,
      savedLoginPresentation: SavedLoginPresentationKind.Workflow,
      currentStep: snapshot.currentStep,
      totalSteps: snapshot.totalSteps,
    }
    const shell = authenticationWidgetShell.createWidgetShell(nookTypedArgs0_0)
    const { body, step, title, description, continueButton } = shell
    continueButton.hidden = true
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
    const enrollmentGate: MountVaultGateArgs = {
      shell,
      presentation: vaultPresentation,
      requirement: WidgetVaultRequirement.Required,
    }
    const enrollmentGateKind = this.vaultGate(enrollmentGate)
    authenticationWidgetShell.mountWidgetShell(nookTypedArgs0_1)
    switch (enrollmentGateKind) {
      case WidgetVaultGateKind.Connect:
      case WidgetVaultGateKind.Unlock:
        return
      case WidgetVaultGateKind.Open:
        break
    }

    const nookTypedArgs0_2: Parameters<
      typeof authenticationWidgetShell.buildEnrollmentFlowHost
    >[0] = {
      authenticatorSetupSnapshot,
      panel: body,
      step,
      title,
      description,
      continueButton,
    }
    const nookTypedArgs1_0: Parameters<
      typeof authenticatorEnrollmentInteraction.renderEnrollmentActions
    >[0] = {
      host: authenticationWidgetShell.buildEnrollmentFlowHost(nookTypedArgs0_2),
      hints: new SelectedEnrollmentPresentation(snapshot.action).hints,
    }
    authenticatorEnrollmentInteraction.renderEnrollmentActions(nookTypedArgs1_0)
  }

  async renderWidget({
    authenticatorSetupSnapshot,
    snapshot,
    workflow,
    facts,
    loginMatches,
    vaultConnection,
    factsBindingToken,
    savedLoginActionAvailable,
  }: RenderWidgetArgs): Promise<void> {
    if (this.ui.widgetState.dismissed) {
      workflowUi.removeWidget()
      return
    }
    const vaultPresentationRequest: ConstructorParameters<
      typeof WidgetVaultPresentationProjection
    >[0] = { vaultConnection, loginMatches }
    const vaultPresentation = new WidgetVaultPresentationProjection(
      vaultPresentationRequest,
    ).state()
    const workflowKeyRequest: Parameters<
      typeof authenticationWidgetWorkflowKey
    >[0] = {
      snapshot,
      loginMatches,
      vaultPresentation,
      facts,
      factsBindingToken,
    }
    const workflowKey =
      await authenticationWidgetWorkflowKey(workflowKeyRequest)
    if (!workflowKey) {
      workflowUi.removeWidget()
      return
    }
    const currentApproval: AuthenticationWorkflowApproval = {
      workflowKey,
      facts,
      ...(factsBindingToken ? { factsBindingToken } : {}),
    }
    if (
      this.ui.pickerState.loginApprovalDisposition(currentApproval) ===
      PendingPickerApprovalDisposition.Changed
    ) {
      loginPasskeyInteraction.cancelPendingLoginPickerRequest()
    }
    if (
      this.ui.pickerState.authenticatorApprovalDisposition(currentApproval) ===
      PendingPickerApprovalDisposition.Changed
    ) {
      authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
    }
    const workflowRenderRequest: Parameters<
      typeof this.ui.widgetState.workflowRenderDisposition
    >[0] = {
      key: workflowKey,
      observation: workflow,
    }
    if (
      this.ui.widgetState.workflowRenderDisposition(workflowRenderRequest) ===
      WidgetRenderDisposition.Reuse
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
    let savedLoginPresentation = SavedLoginPresentationKind.Workflow
    switch (snapshot.action) {
      case AuthenticationWorkflowAction.ContinueWithNook:
        savedLoginPresentation =
          SavedLoginPresentation.forVault(vaultPresentation)
        break
      case AuthenticationWorkflowAction.FillTotp:
      case AuthenticationWorkflowAction.EnrollAuthenticator:
      case AuthenticationWorkflowAction.SaveBackupCodes:
      case AuthenticationWorkflowAction.GeneratePassword:
      case AuthenticationWorkflowAction.UsePasskey:
      case AuthenticationWorkflowAction.CreatePasskey:
      case AuthenticationWorkflowAction.TakeOver:
        break
    }
    const nookTypedArgs0_3: Parameters<
      typeof authenticationWidgetShell.createWidgetShell
    >[0] = {
      copy: enrollmentAction
        ? authenticationWidgetShell.enrollmentCopy(
            new SelectedEnrollmentPresentation(snapshot.action).hints,
          )
        : WorkflowCopy.forKind(snapshot.kind),
      vaultPresentation,
      savedLoginAction:
        snapshot.action === AuthenticationWorkflowAction.ContinueWithNook,
      savedLoginPresentation,
      currentStep: snapshot.currentStep,
      totalSteps: snapshot.totalSteps,
    }
    const shell = authenticationWidgetShell.createWidgetShell(nookTypedArgs0_3)
    const { body, step, title, description, continueButton } = shell
    const workflowRootRequest: Parameters<
      typeof authenticationWidgetShell.mountWidgetShell
    >[0]['workflowRoot'] = {
      kind: WidgetWorkflowRootKind.Assigned,
      observation: workflow,
      facts,
    }
    const workflowGate: MountVaultGateArgs = {
      shell,
      presentation: vaultPresentation,
      requirement: this.vaultRequirement(snapshot.action),
    }
    switch (this.vaultGate(workflowGate)) {
      case WidgetVaultGateKind.Connect:
      case WidgetVaultGateKind.Unlock: {
        const gateMount: Parameters<
          typeof authenticationWidgetShell.mountWidgetShell
        >[0] = { shell, workflowKey, workflowRoot: workflowRootRequest }
        authenticationWidgetShell.mountWidgetShell(gateMount)
        return
      }
      case WidgetVaultGateKind.Open:
        break
    }
    const canContinueWithNook =
      snapshot.action === AuthenticationWorkflowAction.ContinueWithNook ||
      snapshot.action === AuthenticationWorkflowAction.FillTotp ||
      snapshot.action === AuthenticationWorkflowAction.EnrollAuthenticator ||
      snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes ||
      snapshot.action === AuthenticationWorkflowAction.GeneratePassword ||
      snapshot.action === AuthenticationWorkflowAction.UsePasskey ||
      snapshot.action === AuthenticationWorkflowAction.CreatePasskey
    let continueMessageKey: BrowserMessageKey =
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
    switch (savedLoginPresentation) {
      case SavedLoginPresentationKind.Empty:
        continueMessageKey = BROWSER_MESSAGE_KEYS.WidgetOpenNook
        break
      case SavedLoginPresentationKind.Workflow:
        break
    }
    continueButton.setAttribute(
      'aria-label',
      workflowUi.translatedMessage(continueMessageKey),
    )
    continueButton.textContent =
      workflowUi.translatedMessage(continueMessageKey)

    const activateContinueButton = (event: Event): void => {
      if (!new AuthenticationGesture(event).trusted) return
      switch (savedLoginPresentation) {
        case SavedLoginPresentationKind.Empty: {
          const openingSurface: ConstructorParameters<
            typeof PilotVaultOpening
          >[0] = {
            button: continueButton,
            description,
          }
          new PilotVaultOpening(openingSurface).activate()
          return
        }
        case SavedLoginPresentationKind.Workflow:
          break
      }
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
          authenticatorSetupSnapshot,
          panel: body,
          step,
          title,
          description,
          continueButton,
        }
        const host =
          authenticationWidgetShell.buildEnrollmentFlowHost(hostRequest)
        const enrollmentRequest: ConstructorParameters<
          typeof RevalidatedEnrollmentAction
        >[0] = {
          workflow,
          host,
          action: snapshot.action,
          start: (approval) => {
            if (
              snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes
            ) {
              const startRequest: Parameters<
                typeof authenticatorEnrollmentInteraction.startBackupCodeEnrollment
              >[0] = { approval, host }
              void authenticatorEnrollmentInteraction.startBackupCodeEnrollment(
                startRequest,
              )
            } else {
              const section = document.createElement('section')
              body.append(section)
              const startRequest: Parameters<
                typeof authenticatorEnrollmentInteraction.startQrEnrollment
              >[0] = {
                approval,
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
    }
    continueButton.addEventListener('click', activateContinueButton)

    if (savedLoginActionAvailable) {
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

    switch (snapshot.kind) {
      case AuthenticationWorkflowKind.Login:
        switch (snapshot.action) {
          case AuthenticationWorkflowAction.ContinueWithNook: {
            const mount: MountLoginChecklistArgs = {
              surface: { body, title, description },
              control: continueButton,
              workflow,
              presentation: savedLoginPresentation,
            }
            await this.mountLoginChecklist(mount)
            break
          }
          case AuthenticationWorkflowAction.GeneratePassword:
          case AuthenticationWorkflowAction.FillTotp:
          case AuthenticationWorkflowAction.EnrollAuthenticator:
          case AuthenticationWorkflowAction.UsePasskey:
          case AuthenticationWorkflowAction.CreatePasskey:
          case AuthenticationWorkflowAction.TakeOver:
          case AuthenticationWorkflowAction.SaveBackupCodes:
            break
        }
        break
      case AuthenticationWorkflowKind.Signup:
      case AuthenticationWorkflowKind.PasswordChange:
      case AuthenticationWorkflowKind.TotpChallenge:
      case AuthenticationWorkflowKind.TotpEnrollment:
      case AuthenticationWorkflowKind.Manual:
        break
    }

    const enrollmentHints =
      authenticatorEnrollmentInteraction.detectEnrollmentHints(
        authenticatorSetupSnapshot,
      )
    const supplementalHintsRequest: ConstructorParameters<
      typeof SupplementalEnrollmentPresentation
    >[0] = { action: snapshot.action, detected: enrollmentHints }
    const supplementalHints = new SupplementalEnrollmentPresentation(
      supplementalHintsRequest,
    ).hints
    // Supplemental enrollment writes to the vault, so it follows the vault gate too.
    const supplementalGate: Parameters<typeof WidgetVaultGate.decide>[0] = {
      presentation: vaultPresentation,
      requirement: WidgetVaultRequirement.Required,
    }
    if (
      WidgetVaultGate.decide(supplementalGate) === WidgetVaultGateKind.Open &&
      (supplementalHints.qr === 'present' || supplementalHints.backupCodes)
    ) {
      const nookTypedArgs0_9: Parameters<
        typeof authenticationWidgetShell.buildEnrollmentFlowHost
      >[0] = {
        authenticatorSetupSnapshot,
        panel: body,
        step,
        title,
        description,
        continueButton,
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

const authenticationWidgetRendererDependencies: ConstructorParameters<
  typeof AuthenticationWidgetRenderer
>[0] = {
  widgetState,
  pickerState,
}
export const authenticationWidgetRenderer = new AuthenticationWidgetRenderer(
  authenticationWidgetRendererDependencies,
)
