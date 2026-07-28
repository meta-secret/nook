import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { isTrustedAuthAction } from '../../lib/auth-widget-policy'
import type { AuthenticationWorkflowSnapshotView } from '../../lib/auth-workflow-messages'
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
import { widgetState } from './state'
import {
  buildEnrollmentFlowHost,
  createWidgetShell,
  enrollmentCopy,
  mountWidgetShell,
} from './widget-shell'
import type { PilotVaultConnection } from './workflow-ui'
import { removeWidget, translatedMessage, workflowCopy } from './workflow-ui'

export function renderEnrollmentWidget(
  hints: EnrollmentPageHints,
  vaultConnection: PilotVaultConnection,
): void {
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
  if (widgetState.host && widgetState.renderedWorkflowKey === workflowKey) {
    return
  }
  if (widgetState.host) removeWidget()

  const shell = createWidgetShell(enrollmentCopy(hints), vaultConnection, 1, 1)
  const { body, step, title, description, continueButton, openVaultButton } =
    shell
  continueButton.hidden = true
  openVaultButton.hidden = true
  mountWidgetShell(shell, workflowKey, undefined)

  renderEnrollmentActions(
    buildEnrollmentFlowHost(
      body,
      step,
      title,
      description,
      continueButton,
      openVaultButton,
    ),
    hints,
  )
}

export function renderWidget(
  snapshot: AuthenticationWorkflowSnapshotView,
  workflow: PasswordFormObservation,
  vaultConnection: PilotVaultConnection,
): void {
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
    widgetState.host &&
    widgetState.renderedWorkflowKey === workflowKey &&
    widgetState.renderedWorkflowRoot?.root === workflow.root &&
    widgetState.renderedWorkflowRoot.formScope.kind ===
      workflow.formScope.kind &&
    (widgetState.renderedWorkflowRoot.formScope.kind !== 'owned' ||
      (workflow.formScope.kind === 'owned' &&
        widgetState.renderedWorkflowRoot.formScope.owner ===
          workflow.formScope.owner))
  ) {
    return
  }
  if (widgetState.host) removeWidget()

  const shell = createWidgetShell(
    workflowCopy(snapshot.kind),
    vaultConnection,
    snapshot.currentStep,
    snapshot.totalSteps,
  )
  const { body, step, title, description, continueButton, openVaultButton } =
    shell
  const canContinueWithNook =
    snapshot.action === 'continue-with-nook' ||
    snapshot.action === 'fill-totp' ||
    snapshot.action === 'generate-password' ||
    snapshot.action === 'use-passkey' ||
    snapshot.action === 'create-passkey'
  const continueMessageKey =
    snapshot.action === 'fill-totp'
      ? 'widgetFillAuthenticator'
      : snapshot.action === 'generate-password'
        ? 'widgetGeneratePassword'
        : snapshot.action === 'use-passkey'
          ? 'widgetUsePasskey'
          : snapshot.action === 'create-passkey'
            ? 'widgetCreatePasskey'
            : canContinueWithNook
              ? 'widgetContinue'
              : 'widgetTakeOver'
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
    if (snapshot.action === 'fill-totp') {
      void continueWithAuthenticator(
        workflow,
        step,
        title,
        description,
        continueButton,
      )
    } else if (snapshot.action === 'generate-password') {
      void generatePasswordWithNook(
        workflow,
        step,
        title,
        description,
        continueButton,
      )
    } else if (
      snapshot.action === 'use-passkey' ||
      snapshot.action === 'create-passkey'
    ) {
      void proposePasskeyWithNook(description, continueButton, snapshot.action)
    } else {
      void continueWithNook(
        step,
        title,
        description,
        continueButton,
        openVaultButton,
        body,
        workflow,
      )
    }
  })

  const takeOverButton = document.createElement('button')
  takeOverButton.type = 'button'
  takeOverButton.className = 'text-button'
  takeOverButton.textContent = translatedMessage('widgetTakeOver')
  takeOverButton.hidden = !canContinueWithNook
  takeOverButton.addEventListener('click', (event) => {
    if (!isTrustedAuthAction(event.isTrusted)) return
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
    widgetState.dismissed = true
    removeWidget()
  })

  body.append(takeOverButton)
  mountWidgetShell(shell, workflowKey, workflow)

  const enrollmentHints = detectEnrollmentHints()
  if (enrollmentHints.qr || enrollmentHints.backupCodes) {
    renderEnrollmentActions(
      buildEnrollmentFlowHost(
        body,
        step,
        title,
        description,
        continueButton,
        openVaultButton,
      ),
      enrollmentHints,
    )
  }
}
