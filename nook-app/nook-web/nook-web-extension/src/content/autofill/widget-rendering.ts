import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { isTrustedAuthAction } from '../../lib/auth-widget-policy'
import {
  authenticationWorkflowApprovalsMatch,
  type AuthenticationWorkflowApproval,
  type AuthenticationWorkflowSnapshotView,
} from '../../lib/auth-workflow-messages'
import {
  AuthenticationWorkflowAction,
  type AuthenticationPageObservationFacts,
  type WebsiteLoginMatchAvailability,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  detectEnrollmentHints,
  renderEnrollmentActions,
  type EnrollmentPageHints,
} from '../enrollment-flow'
import {
  cancelPendingAuthenticatorPickerRequest,
  continueWithAuthenticator,
} from './authenticator-actions'
import {
  cancelPendingLoginPickerRequest,
  continueWithNook,
  generatePasswordWithNook,
  proposePasskeyWithNook,
} from './login-passkey-actions'
import {
  AuthenticatorPickerKind,
  LoginPickerKind,
  WidgetHostKind,
  WidgetWorkflowKeyKind,
  WidgetWorkflowRootKind,
  pickerState,
  widgetState,
} from './state'
import {
  buildEnrollmentFlowHost,
  createWidgetShell,
  enrollmentCopy,
  mountWidgetShell,
} from './widget-shell'
import type { PilotVaultConnection } from './workflow-ui'
import { removeWidget, translatedMessage, workflowCopy } from './workflow-ui'

type RenderEnrollmentWidgetArgs = {
  hints: EnrollmentPageHints
  vaultConnection: PilotVaultConnection
}

export function renderEnrollmentWidget({
  hints,
  vaultConnection,
}: RenderEnrollmentWidgetArgs): void {
  if (widgetState.dismissed) {
    removeWidget()
    return
  }
  const workflowKey = [
    'enrollment',
    hints.qr ? 'qr' : '',
    hints.backupCodes ? 'backup' : '',
    vaultConnection.connected ? 'connected' : 'disconnected',
    vaultConnection.vaultName ?? '',
  ].join(':')
  if (pickerState.login.kind === LoginPickerKind.Open) {
    cancelPendingLoginPickerRequest()
  }
  if (pickerState.authenticator.kind === AuthenticatorPickerKind.Open) {
    cancelPendingAuthenticatorPickerRequest()
  }
  if (
    widgetState.host.kind === WidgetHostKind.Attached &&
    widgetState.workflowKey.kind === WidgetWorkflowKeyKind.Assigned &&
    widgetState.workflowKey.key === workflowKey
  ) {
    return
  }
  if (widgetState.host.kind === WidgetHostKind.Attached) removeWidget()

  const nookTypedArgs0_0: Parameters<typeof createWidgetShell>[0] = {
    copy: enrollmentCopy(hints),
    vaultConnection,
    currentStep: 1,
    totalSteps: 1,
  }
  const shell = createWidgetShell(nookTypedArgs0_0)
  const { body, step, title, description, continueButton, openVaultButton } =
    shell
  continueButton.hidden = true
  openVaultButton.hidden = true
  const workflowRoot: Parameters<typeof mountWidgetShell>[0]['workflowRoot'] = {
    kind: WidgetWorkflowRootKind.Unassigned,
  }
  const nookTypedArgs0_1: Parameters<typeof mountWidgetShell>[0] = {
    shell,
    workflowKey,
    workflowRoot,
  }
  mountWidgetShell(nookTypedArgs0_1)

  const nookTypedArgs0_2: Parameters<typeof buildEnrollmentFlowHost>[0] = {
    panel: body,
    step,
    title,
    description,
    continueButton,
    openVaultButton,
  }
  const nookTypedArgs1_0: Parameters<typeof renderEnrollmentActions>[0] = {
    host: buildEnrollmentFlowHost(nookTypedArgs0_2),
    hints,
  }
  renderEnrollmentActions(nookTypedArgs1_0)
}

type RenderWidgetArgs = {
  snapshot: AuthenticationWorkflowSnapshotView
  workflow: PasswordFormObservation
  facts: AuthenticationPageObservationFacts
  loginMatches: WebsiteLoginMatchAvailability
  vaultConnection: PilotVaultConnection
}

export function renderWidget({
  snapshot,
  workflow,
  facts,
  loginMatches,
  vaultConnection,
}: RenderWidgetArgs): void {
  if (widgetState.dismissed) {
    removeWidget()
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
    vaultConnection.vaultName ?? '',
  ].join(':')
  const currentApproval: AuthenticationWorkflowApproval = {
    workflowKey,
    facts,
  }
  if (pickerState.login.kind === LoginPickerKind.Open) {
    const approvalPair: Parameters<
      typeof authenticationWorkflowApprovalsMatch
    >[0] = {
      approved: pickerState.login.request.approval,
      current: currentApproval,
    }
    if (!authenticationWorkflowApprovalsMatch(approvalPair)) {
      cancelPendingLoginPickerRequest()
    }
  }
  if (pickerState.authenticator.kind === AuthenticatorPickerKind.Open) {
    const approvalPair: Parameters<
      typeof authenticationWorkflowApprovalsMatch
    >[0] = {
      approved: pickerState.authenticator.request.approval,
      current: currentApproval,
    }
    if (!authenticationWorkflowApprovalsMatch(approvalPair)) {
      cancelPendingAuthenticatorPickerRequest()
    }
  }
  if (
    widgetState.host.kind === WidgetHostKind.Attached &&
    widgetState.workflowKey.kind === WidgetWorkflowKeyKind.Assigned &&
    widgetState.workflowKey.key === workflowKey &&
    widgetState.renderedWorkflowRoot.kind === WidgetWorkflowRootKind.Assigned &&
    widgetState.renderedWorkflowRoot.observation.root === workflow.root &&
    widgetState.renderedWorkflowRoot.observation.formScope.kind ===
      workflow.formScope.kind &&
    (widgetState.renderedWorkflowRoot.observation.formScope.kind !== 'owned' ||
      (workflow.formScope.kind === 'owned' &&
        widgetState.renderedWorkflowRoot.observation.formScope.owner ===
          workflow.formScope.owner))
  ) {
    const renderedWorkflowRoot: Parameters<
      typeof widgetState.setRenderedWorkflowRoot
    >[0] = {
      kind: WidgetWorkflowRootKind.Assigned,
      observation: workflow,
      facts,
    }
    widgetState.setRenderedWorkflowRoot(renderedWorkflowRoot)
    return
  }
  if (widgetState.host.kind === WidgetHostKind.Attached) removeWidget()

  const nookTypedArgs0_3: Parameters<typeof createWidgetShell>[0] = {
    copy: workflowCopy(snapshot.kind),
    vaultConnection,
    currentStep: snapshot.currentStep,
    totalSteps: snapshot.totalSteps,
  }
  const shell = createWidgetShell(nookTypedArgs0_3)
  const { body, step, title, description, continueButton, openVaultButton } =
    shell
  const canContinueWithNook =
    snapshot.action === AuthenticationWorkflowAction.ContinueWithNook ||
    snapshot.action === AuthenticationWorkflowAction.FillTotp ||
    snapshot.action === AuthenticationWorkflowAction.GeneratePassword ||
    snapshot.action === AuthenticationWorkflowAction.UsePasskey ||
    snapshot.action === AuthenticationWorkflowAction.CreatePasskey
  const continueMessageKey =
    snapshot.action === AuthenticationWorkflowAction.FillTotp
      ? BROWSER_MESSAGE_KEYS.WidgetFillAuthenticator
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
    translatedMessage(continueMessageKey),
  )
  continueButton.textContent = translatedMessage(continueMessageKey)

  continueButton.addEventListener('click', (event) => {
    if (!isTrustedAuthAction(event.isTrusted)) return
    if (!canContinueWithNook) {
      cancelPendingAuthenticatorPickerRequest()
      cancelPendingLoginPickerRequest()
      widgetState.dismissed = true
      removeWidget()
      return
    }
    if (snapshot.action === AuthenticationWorkflowAction.FillTotp) {
      const nookTypedArgs0_4: Parameters<typeof continueWithAuthenticator>[0] =
        {
          workflow,
          step,
          title,
          description,
          continueButton,
        }
      void continueWithAuthenticator(nookTypedArgs0_4)
    } else if (
      snapshot.action === AuthenticationWorkflowAction.GeneratePassword
    ) {
      const nookTypedArgs0_5: Parameters<typeof generatePasswordWithNook>[0] = {
        workflow,
        step,
        title,
        description,
        continueButton,
      }
      void generatePasswordWithNook(nookTypedArgs0_5)
    } else if (
      snapshot.action === AuthenticationWorkflowAction.UsePasskey ||
      snapshot.action === AuthenticationWorkflowAction.CreatePasskey
    ) {
      const nookTypedArgs0_6: Parameters<typeof proposePasskeyWithNook>[0] = {
        description,
        continueButton,
        action: snapshot.action,
        workflow,
      }
      void proposePasskeyWithNook(nookTypedArgs0_6)
    } else {
      const nookTypedArgs0_7: Parameters<typeof continueWithNook>[0] = {
        step,
        title,
        description,
        continueButton,
        workflow,
      }
      void continueWithNook(nookTypedArgs0_7)
    }
  })

  const takeOverButton = document.createElement('button')
  takeOverButton.type = 'button'
  takeOverButton.className = 'text-button'
  takeOverButton.textContent = translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetTakeOver,
  )
  takeOverButton.hidden = !canContinueWithNook
  takeOverButton.addEventListener('click', (event) => {
    if (!isTrustedAuthAction(event.isTrusted)) return
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
    widgetState.dismissed = true
    removeWidget()
  })

  body.append(takeOverButton)
  const passkeyAction =
    snapshot.action === AuthenticationWorkflowAction.UsePasskey ||
    snapshot.action === AuthenticationWorkflowAction.CreatePasskey
  const savedLoginActionAvailable =
    loginMatches.kind === 'locked' ||
    (loginMatches.kind === 'ready' && loginMatches.count > 0)
  if (passkeyAction && savedLoginActionAvailable) {
    const savedLoginButton = document.createElement('button')
    savedLoginButton.type = 'button'
    savedLoginButton.className = 'text-button'
    savedLoginButton.textContent = translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetContinue,
    )
    savedLoginButton.addEventListener('click', (event) => {
      if (!isTrustedAuthAction(event.isTrusted)) return
      const nookTypedArgs0_10: Parameters<typeof continueWithNook>[0] = {
        step,
        title,
        description,
        continueButton: savedLoginButton,
        workflow,
      }
      void continueWithNook(nookTypedArgs0_10)
    })
    body.append(savedLoginButton)
  }
  const nookTypedArgs0_1: Parameters<
    typeof mountWidgetShell
  >[0]['workflowRoot'] = {
    kind: WidgetWorkflowRootKind.Assigned,
    observation: workflow,
    facts,
  }
  const nookTypedArgs0_8: Parameters<typeof mountWidgetShell>[0] = {
    shell,
    workflowKey,
    workflowRoot: nookTypedArgs0_1,
  }
  mountWidgetShell(nookTypedArgs0_8)

  const enrollmentHints = detectEnrollmentHints()
  if (enrollmentHints.qr || enrollmentHints.backupCodes) {
    const nookTypedArgs0_9: Parameters<typeof buildEnrollmentFlowHost>[0] = {
      panel: body,
      step,
      title,
      description,
      continueButton,
      openVaultButton,
    }
    const nookTypedArgs1_1: Parameters<typeof renderEnrollmentActions>[0] = {
      host: buildEnrollmentFlowHost(nookTypedArgs0_9),
      hints: enrollmentHints,
    }
    renderEnrollmentActions(nookTypedArgs1_1)
  }
}
