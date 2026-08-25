import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  authWidgetStartsCollapsed,
  isTrustedAuthAction,
} from '../../lib/auth-widget-policy'
import { type WebsiteLoginMatchAvailability } from '../../lib/auth-workflow-messages'
import {
  authentication_workflow_pilot_presentation_capability,
  authentication_workflow_saved_login_capability,
  type AuthenticationWorkflowSnapshot,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
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
  WidgetHostKind,
  WidgetWorkflowKeyKind,
  WidgetWorkflowRootKind,
  authenticationActionState,
  invalidateAuthenticationActionContext,
  scanState,
  widgetState,
} from './state'
import {
  buildEnrollmentFlowHost,
  createWidgetShell,
  enrollmentCopy,
  mountWidgetShell,
} from './widget-shell'
import type { PilotVaultConnection } from './workflow-ui'
import {
  remountWidget,
  removeWidget,
  translatedMessage,
  workflowCopy,
} from './workflow-ui'

type RenderEnrollmentWidgetArgs = {
  hints: EnrollmentPageHints
  snapshot: AuthenticationWorkflowSnapshot
  vaultConnection: PilotVaultConnection
}

export function renderEnrollmentWidget({
  hints,
  snapshot,
  vaultConnection,
}: RenderEnrollmentWidgetArgs): void {
  const actionContextArgs: Parameters<
    typeof invalidateAuthenticationActionContext
  >[0] = {
    actionState: authenticationActionState,
    widget: widgetState,
  }
  invalidateAuthenticationActionContext(actionContextArgs)
  cancelPendingAuthenticatorPickerRequest()
  cancelPendingLoginPickerRequest()
  if (widgetState.dismissed) {
    removeWidget()
    return
  }
  if (
    authentication_workflow_pilot_presentation_capability(snapshot) !==
    'propose-action'
  ) {
    removeWidget()
    return
  }
  widgetState.beginEnrollmentWorkflow()
  const workflowKey = [
    'enrollment',
    hints.qr ? 'qr' : '',
    hints.backupCodes ? 'backup' : '',
    snapshot.action,
    snapshot.stage,
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
    currentStep: snapshot.currentStep,
    totalSteps: snapshot.totalSteps,
  }
  const shell = createWidgetShell(nookTypedArgs0_0)
  const { body, step, title, description, continueButton } = shell
  continueButton.hidden = true
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
    requestWorkflowReclassification: () => {
      scanState.schedule()
    },
  }
  const nookTypedArgs1_0: Parameters<typeof renderEnrollmentActions>[0] = {
    host: buildEnrollmentFlowHost(nookTypedArgs0_2),
    hints: {
      qr: snapshot.action === 'enroll-authenticator' && hints.qr,
      backupCodes: snapshot.action === 'save-backup-codes' && hints.backupCodes,
    },
  }
  renderEnrollmentActions(nookTypedArgs1_0)
}

type RenderWidgetArgs = {
  snapshot: AuthenticationWorkflowSnapshot
  workflow: PasswordFormObservation
  vaultConnection: PilotVaultConnection
  loginMatches: WebsiteLoginMatchAvailability
}

export function renderWidget({
  snapshot,
  workflow,
  vaultConnection,
  loginMatches,
}: RenderWidgetArgs): void {
  if (widgetState.dismissed) {
    removeWidget()
    return
  }
  const presentationScope = [
    snapshot.kind,
    snapshot.stage,
    snapshot.action,
    snapshot.currentStep,
    snapshot.totalSteps,
    snapshot.approvalRequirement,
    snapshot.observationIndex,
    vaultConnection.connected ? 'connected' : 'disconnected',
    vaultConnection.vaultName ?? '',
  ].join(':')
  const workflowKey = [
    presentationScope,
    loginMatches.kind,
    loginMatches.kind === 'ready' && 'count' in loginMatches
      ? loginMatches.count
      : '',
  ].join(':')
  const sameRenderedWorkflow =
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
  if (
    sameRenderedWorkflow &&
    widgetState.host.kind === WidgetHostKind.Attached &&
    !widgetState.host.element.inert
  ) {
    return
  }
  if (widgetState.host.kind === WidgetHostKind.Attached) {
    if (!sameRenderedWorkflow) {
      authenticationActionState.invalidate()
      widgetState.busy = false
    }
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
    const preservesPresentation =
      widgetState.presentationScope.kind === WidgetWorkflowKeyKind.Assigned &&
      widgetState.presentationScope.key === presentationScope
    if (sameRenderedWorkflow || preservesPresentation) remountWidget()
    else removeWidget()
  }

  const savedLoginCapability =
    authentication_workflow_saved_login_capability(snapshot)
  if (
    authentication_workflow_pilot_presentation_capability(snapshot) !==
    'propose-action'
  ) {
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
    removeWidget()
    return
  }
  const nookTypedArgs0_0: Parameters<typeof authWidgetStartsCollapsed>[0] = {
    savedLoginCapability,
    loginMatches,
  }
  widgetState.applyAutomaticCollapse(
    authWidgetStartsCollapsed(nookTypedArgs0_0),
  )

  const nookTypedArgs0_3: Parameters<typeof createWidgetShell>[0] = {
    copy: workflowCopy(snapshot.kind),
    currentStep: snapshot.currentStep,
    totalSteps: snapshot.totalSteps,
  }
  const shell = createWidgetShell(nookTypedArgs0_3)
  const { step, title, description, continueButton } = shell
  const continueMessageKey =
    snapshot.action === 'fill-totp'
      ? BROWSER_MESSAGE_KEYS.WidgetFillAuthenticator
      : snapshot.action === 'generate-password'
        ? BROWSER_MESSAGE_KEYS.WidgetGeneratePassword
        : snapshot.action === 'use-passkey'
          ? BROWSER_MESSAGE_KEYS.WidgetUsePasskey
          : snapshot.action === 'create-passkey'
            ? BROWSER_MESSAGE_KEYS.WidgetCreatePasskey
            : BROWSER_MESSAGE_KEYS.WidgetFillLogin
  continueButton.setAttribute(
    'aria-label',
    translatedMessage(continueMessageKey),
  )
  continueButton.textContent = translatedMessage(continueMessageKey)

  continueButton.addEventListener('click', (event) => {
    if (!isTrustedAuthAction(event.isTrusted)) return
    if (snapshot.action === 'fill-totp') {
      const nookTypedArgs0_4: Parameters<typeof continueWithAuthenticator>[0] =
        {
          workflow,
          step,
          title,
          description,
          continueButton,
        }
      void continueWithAuthenticator(nookTypedArgs0_4)
    } else if (snapshot.action === 'generate-password') {
      const nookTypedArgs0_5: Parameters<typeof generatePasswordWithNook>[0] = {
        workflow,
        step,
        title,
        description,
        continueButton,
      }
      void generatePasswordWithNook(nookTypedArgs0_5)
    } else if (
      snapshot.action === 'use-passkey' ||
      snapshot.action === 'create-passkey'
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
  widgetState.assignPresentationScope(presentationScope)
}
