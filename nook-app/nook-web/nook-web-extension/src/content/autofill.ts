import { authenticationRouteBrowser } from '../../../nook-web-shared/src/extension/authentication-route-history'
import {
  AUTHENTICATION_FACT_SCAN_DEBOUNCE_MS,
  authenticationFactObserverOptions,
  authenticationFactObserver,
} from '../../../nook-web-shared/src/extension/authentication-fact-attributes'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  authentication_enrollment_workflow_match,
  authentication_workflow_pilot_presentation_capability,
  AuthenticationWorkflowSnapshotResponseKind,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { AuthenticationWorkflowClassification } from '../../../nook-web-shared/src/extension/password-form-classified-observations'
import {
  passwordFieldDiscovery,
  passwordFormInteraction,
} from '../../../nook-web-shared/src/extension/password-forms'
import { simpleVaultRuntime } from '../lib/simple-vault-runtime'
import { recoveryCopyObservation } from '../lib/backup-code-candidates'
import {
  AuthenticationWorkflowSnapshotMessageType,
  MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS,
} from '../lib/auth-workflow-messages'
import { authenticatorInteraction } from './autofill/authenticator-actions'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  AUTHENTICATION_VIEWPORT_EVENTS,
  authenticationSurfaceObservation,
} from './autofill/authentication-surface-observation'
import {
  RuntimeMessageDeliveryKind,
  loginPasskeyInteraction,
  authenticationRuntimeTransport,
} from './autofill/login-passkey-actions'
import {
  PendingSaveOfferLoadKind,
  loginSaveInteraction,
} from './autofill/login-save'
import { removeScannedWidget } from './autofill/message-router'
import {
  SaveOfferDisplayKind,
  SavePageWatchKind,
  ScanScheduleKind,
  WidgetHostKind,
  WidgetWorkflowKeyKind,
  WidgetWorkflowRootKind,
  type AuthenticationScanMutationBatch,
  saveOfferState,
  scanState,
  widgetState,
} from './autofill/state'
import { authenticationWidgetRenderer } from './autofill/widget-rendering'
import { authenticationWidgetPosition } from './autofill/widget-position'
import { workflowUi } from './autofill/workflow-ui'
import { authenticatorEnrollmentInteraction } from './enrollment-flow'

async function performScanAndRender(): Promise<void> {
  if (widgetState.dismissed) return
  if (saveOfferState.confirmationActive) return
  if (authenticatorEnrollmentInteraction.enrollmentScanBlocked()) return
  const sequence = ++scanState.sequence
  if (saveOfferState.display.kind === SaveOfferDisplayKind.Visible) {
    const { offer } = saveOfferState.display
    if (
      widgetState.workflowKey.kind !== WidgetWorkflowKeyKind.Assigned ||
      widgetState.workflowKey.key !== `save:${offer.offerId}`
    ) {
      loginSaveInteraction.renderSaveOfferWidget(offer)
    }
    return
  }
  if (saveOfferState.watch.kind === SavePageWatchKind.Watching) {
    void loginSaveInteraction.evaluatePendingSaveEvidence()
    return
  }
  const pendingOffer = await loginSaveInteraction.loadPendingSaveOffer()
  if (sequence !== scanState.sequence) return
  if (pendingOffer.kind === PendingSaveOfferLoadKind.Loaded) {
    loginSaveInteraction.beginPendingSaveWatch(pendingOffer.offer)
    return
  }
  const { copy: recoveryCopy, hint: backupCodesHint } =
    recoveryCopyObservation.authenticationRecoveryEvidence()
  const enrollmentHints =
    authenticatorEnrollmentInteraction.detectEnrollmentHintsFromRecoveryCopy(
      recoveryCopy,
    )
  enrollmentHints.backupCodes = backupCodesHint === 'present'
  const workflowForms = passwordFormInteraction
    .summarizeAuthenticationWorkflowForms()
    .slice(0, MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS)
  // Setup material starts an enrollment ceremony. Recovery hints remain part
  // of an active OTP challenge so Rust can keep code fill as the primary action,
  // while a direct backup-code-only page still exposes the save ceremony.
  if (
    (enrollmentHints.qr || enrollmentHints.backupCodes) &&
    workflowForms.length === 0
  ) {
    const enrollmentMatch = authentication_enrollment_workflow_match(
      enrollmentHints.qr,
      recoveryCopy,
      passwordFieldDiscovery.pageHasManualCheckpoint(document),
    )
    if (
      enrollmentMatch.kind !== 'matched' ||
      authentication_workflow_pilot_presentation_capability(
        enrollmentMatch.snapshot,
      ) !== 'propose-action'
    ) {
      removeScannedWidget()
      return
    }
    authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
    loginPasskeyInteraction.cancelPendingLoginPickerRequest()
    const vaultConnection = await workflowUi.loadPilotVaultConnection()
    if (sequence !== scanState.sequence) return
    const nookTypedArgs0_0: Parameters<
      typeof authenticationWidgetRenderer.renderEnrollmentWidget
    >[0] = {
      hints: enrollmentHints,
      snapshot: enrollmentMatch.snapshot,
      vaultConnection,
    }
    authenticationWidgetRenderer.renderEnrollmentWidget(nookTypedArgs0_0)
    return
  }
  if (workflowForms.length === 0) {
    removeScannedWidget()
    return
  }

  const classifiedRequest: ConstructorParameters<
    typeof AuthenticationWorkflowClassification
  >[0] = {
    workflowForms,
    authenticatorSetupHint: enrollmentHints.qr,
    backupCodesHint: enrollmentHints.backupCodes,
  }
  const classifiedWorkflows = new AuthenticationWorkflowClassification(
    classifiedRequest,
  ).observations
  if (classifiedWorkflows.length === 0) {
    removeScannedWidget()
    return
  }
  const message: Parameters<
    typeof authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage
  >[0] = {
    type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
    payload: {
      origin: location.origin,
      observations: classifiedWorkflows.map(({ facts }) => facts),
    },
  }
  const delivery =
    await authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage(
      message,
    )
  if (sequence !== scanState.sequence) return
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    removeScannedWidget()
    return
  }
  const { response } = delivery
  const { verdict, loginMatches } = response
  if (
    verdict.kind !== AuthenticationWorkflowSnapshotResponseKind.Matched ||
    !('snapshot' in verdict) ||
    !response.selectedFacts
  ) {
    removeScannedWidget()
    return
  }
  const { snapshot } = verdict
  const selected = classifiedWorkflows[snapshot.observationIndex]
  if (
    authentication_workflow_pilot_presentation_capability(snapshot) === 'hidden'
  ) {
    removeScannedWidget()
    return
  }
  if (!selected) {
    removeScannedWidget()
    return
  }
  const vaultConnection = await workflowUi.loadPilotVaultConnection()
  if (sequence !== scanState.sequence) return
  const nookTypedArgs0_1: Parameters<
    typeof authenticationWidgetRenderer.renderWidget
  >[0] = {
    snapshot,
    workflow: selected.observation,
    facts: response.selectedFacts,
    loginMatches,
    vaultConnection,
  }
  authenticationWidgetRenderer.renderWidget(nookTypedArgs0_1)
}

async function scanAndRender(): Promise<void> {
  try {
    await performScanAndRender()
  } finally {
    authenticationSurfaceObservation.recordAuthenticationRecoveryEvidenceState()
  }
}

function scheduleScan(mutations?: AuthenticationScanMutationBatch) {
  if (
    Array.isArray(mutations) &&
    mutations.length > 0 &&
    !mutations.some(
      authenticationFactObserver.authenticationFactMutationRequiresScan.bind(
        authenticationFactObserver,
      ),
    )
  ) {
    return
  }
  if (scanState.scheduleState.kind === ScanScheduleKind.Scheduled) {
    window.clearTimeout(scanState.scheduleState.timer)
  }
  const delay = scanState.remainingScanDelay(
    AUTHENTICATION_FACT_SCAN_DEBOUNCE_MS,
  )

  scanState.scheduleTimer(
    window.setTimeout(() => {
      scanState.clearPendingTimer()
      void scanAndRender()
    }, delay),
  )
}

function invalidateRenderedAuthenticationAction(): void {
  widgetState.busy = false
  authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
  loginPasskeyInteraction.cancelPendingLoginPickerRequest()
}

type AuthenticationMutationRecords = MutationRecord[]

function handleAuthenticationMutations(
  records: AuthenticationMutationRecords,
): void {
  if (widgetState.host.kind === WidgetHostKind.Attached) {
    const mountedHost = widgetState.host.element
    const mountedHostWasRemoved = records.some(
      (record) =>
        record.type === 'childList' &&
        !mountedHost.isConnected &&
        [...record.removedNodes].some((node) => node === mountedHost),
    )
    if (mountedHostWasRemoved) {
      invalidateRenderedAuthenticationAction()
      widgetState.clearRenderedWidget()
      scheduleScan()
      return
    }
  }
  const mountedHost =
    widgetState.host.kind === WidgetHostKind.Attached
      ? widgetState.host.element
      : false
  const renderedWorkflow =
    widgetState.renderedWorkflowRoot.kind === WidgetWorkflowRootKind.Assigned
      ? widgetState.renderedWorkflowRoot.observation
      : false
  const impactRequest: Parameters<
    typeof authenticationSurfaceObservation.authenticationMutationImpact
  >[0] = {
    records,
    mountedHost,
    renderedWorkflow,
  }
  const impact =
    authenticationSurfaceObservation.authenticationMutationImpact(impactRequest)
  if (!impact.shouldScheduleScan) return
  if (passwordFieldDiscovery.pageHasManualCheckpoint(document)) {
    invalidateRenderedAuthenticationAction()
    removeScannedWidget()
    scheduleScan()
    return
  }
  // Filling may synchronously schedule a framework update that enables the
  // observed advance control. Keep the mount through that update; the action
  // path still requires a fresh domain decision and exact control identity.
  if (
    widgetState.host.kind === WidgetHostKind.Attached &&
    renderedWorkflow &&
    impact.shouldRemountRenderedWorkflow &&
    !widgetState.credentialActuationInFlight
  ) {
    invalidateRenderedAuthenticationAction()
    removeScannedWidget()
  }
  scheduleScan()
}

function handleViewportChange(): void {
  if (widgetState.host.kind !== WidgetHostKind.Attached) return
  const host = widgetState.host.element
  const rect = host.getBoundingClientRect()
  const clampRequest: Parameters<
    typeof authenticationWidgetPosition.clampWidgetPosition
  >[0] = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
  const position =
    authenticationWidgetPosition.clampWidgetPosition(clampRequest)
  widgetState.setPosition(position)
  const applyRequest: Parameters<
    typeof authenticationWidgetPosition.applyWidgetPosition
  >[0] = {
    host,
    position,
  }
  authenticationWidgetPosition.applyWidgetPosition(applyRequest)
}

scanState.schedule = scheduleScan

void companionWasmReady.then(async () => {
  if (await simpleVaultRuntime.isRuntimeNookVaultAppUrl(location.href)) {
    return
  }
  document.addEventListener(
    'submit',
    loginSaveInteraction.captureSubmittedLogin.bind(loginSaveInteraction),
    true,
  )
  void scanAndRender()

  const observer = new MutationObserver(handleAuthenticationMutations)
  const observerOptions: MutationObserverInit = {
    ...authenticationFactObserverOptions,
    attributeFilter: [...AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER],
  }
  observer.observe(document.documentElement, observerOptions)
  authenticationFactObserver.observeAuthenticationSubmitValueAssignments(
    scheduleScan,
  )
  window.addEventListener('message', (event) => {
    if (
      !authenticationRouteBrowser.isAuthenticationRouteHistoryMessage(event) &&
      !authenticationFactObserver.isAuthenticationSubmitValueMessage(event)
    ) {
      return
    }
    scheduleScan()
  })
  for (const eventName of AUTHENTICATION_VIEWPORT_EVENTS) {
    const options: AddEventListenerOptions = {
      capture: eventName === 'scroll',
      passive: true,
    }
    window.addEventListener(eventName, handleViewportChange, options)
  }
})
