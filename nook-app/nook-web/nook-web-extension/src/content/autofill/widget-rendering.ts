import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { isTrustedAuthAction } from '../../lib/auth-widget-policy'
import type { AuthenticationWorkflowSnapshotView } from '../../lib/auth-workflow-messages'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  detectEnrollmentHints,
  renderEnrollmentActions,
  type EnrollmentPageHints,
} from '../enrollment-flow'
import { startRevalidatedBackupCodeEnrollment } from './backup-code-workflow-action'
import {
  selectedEnrollmentHints,
  supplementalEnrollmentHints,
} from './enrollment-action-presentation'
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
  WidgetHostKind,
  WidgetWorkflowKeyKind,
  WidgetWorkflowRootKind,
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
  action: AuthenticationWorkflowAction
  vaultConnection: PilotVaultConnection
}

export function renderEnrollmentWidget({
  hints,
  action,
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
    hints: selectedEnrollmentHints(action),
  }
  renderEnrollmentActions(nookTypedArgs1_0)
}

type RenderWidgetArgs = {
  snapshot: AuthenticationWorkflowSnapshotView
  workflow: PasswordFormObservation
  vaultConnection: PilotVaultConnection
}

export function renderWidget({
  snapshot,
  workflow,
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
    vaultConnection.connected ? 'connected' : 'disconnected',
    vaultConnection.vaultName ?? '',
  ].join(':')
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
    snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes ||
    snapshot.action === AuthenticationWorkflowAction.GeneratePassword ||
    snapshot.action === AuthenticationWorkflowAction.UsePasskey ||
    snapshot.action === AuthenticationWorkflowAction.CreatePasskey
  const continueMessageKey =
    snapshot.action === AuthenticationWorkflowAction.FillTotp
      ? BROWSER_MESSAGE_KEYS.WidgetFillAuthenticator
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
      snapshot.action === AuthenticationWorkflowAction.SaveBackupCodes
    ) {
      const hostRequest: Parameters<typeof buildEnrollmentFlowHost>[0] = {
        panel: body,
        step,
        title,
        description,
        continueButton,
        openVaultButton,
      }
      void startRevalidatedBackupCodeEnrollment({
        workflow,
        host: buildEnrollmentFlowHost(hostRequest),
      })
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
  const nookTypedArgs0_1: Parameters<
    typeof mountWidgetShell
  >[0]['workflowRoot'] = {
    kind: WidgetWorkflowRootKind.Assigned,
    observation: workflow,
  }
  const nookTypedArgs0_8: Parameters<typeof mountWidgetShell>[0] = {
    shell,
    workflowKey,
    workflowRoot: nookTypedArgs0_1,
  }
  mountWidgetShell(nookTypedArgs0_8)

  const enrollmentHints = detectEnrollmentHints()
  const supplementalHints = supplementalEnrollmentHints(
    snapshot.action,
    enrollmentHints,
  )
  if (supplementalHints.qr || supplementalHints.backupCodes) {
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
      hints: supplementalHints,
    }
    renderEnrollmentActions(nookTypedArgs1_1)
  }
}
