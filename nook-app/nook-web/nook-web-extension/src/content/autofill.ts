import { isAuthenticationRouteHistoryMessage } from '../../../nook-web-shared/src/extension/authentication-route-history'
import {
  AUTHENTICATION_FACT_SCAN_DEBOUNCE_MS,
  authenticationFactMutationRequiresScan,
  authenticationFactObserverOptions,
  isAuthenticationSubmitValueMessage,
  observeAuthenticationSubmitValueAssignments,
} from '../../../nook-web-shared/src/extension/authentication-fact-attributes'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  authentication_enrollment_workflow_match,
  authentication_workflow_pilot_presentation_capability,
  AuthenticationWorkflowSnapshotResponseKind,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { classifiedAuthenticationWorkflowObservations } from '../../../nook-web-shared/src/extension/password-form-classified-observations'
import {
  pageHasManualCheckpoint,
  summarizeAuthenticationWorkflowForms,
} from '../../../nook-web-shared/src/extension/password-forms'
import { isRuntimeNookVaultAppUrl } from '../lib/simple-vault-runtime'
import { authenticationRecoveryEvidence } from '../lib/backup-code-candidates'
import {
  AuthenticationWorkflowSnapshotMessageType,
  MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS,
} from '../lib/auth-workflow-messages'
import { cancelPendingAuthenticatorPickerRequest } from './autofill/authenticator-actions'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  AUTHENTICATION_VIEWPORT_EVENTS,
  authenticationMutationImpact,
  recordAuthenticationRecoveryEvidenceState,
} from './autofill/authentication-surface-observation'
import {
  cancelPendingLoginPickerRequest,
  RuntimeMessageDeliveryKind,
  sendAuthenticationWorkflowSnapshotRuntimeMessage,
} from './autofill/login-passkey-actions'
import {
  beginPendingSaveWatch,
  captureSubmittedLogin,
  evaluatePendingSaveEvidence,
  loadPendingSaveOffer,
  PendingSaveOfferLoadKind,
  renderSaveOfferWidget,
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
import {
  renderEnrollmentWidget,
  renderWidget,
} from './autofill/widget-rendering'
import {
  applyWidgetPosition,
  clampWidgetPosition,
} from './autofill/widget-position'
import { loadPilotVaultConnection } from './autofill/workflow-ui'
import {
  detectEnrollmentHintsFromRecoveryCopy,
  enrollmentScanBlocked,
} from './enrollment-flow'

async function performScanAndRender(): Promise<void> {
  if (widgetState.dismissed) return
  if (saveOfferState.confirmationActive) return
  if (enrollmentScanBlocked()) return
  const sequence = ++scanState.sequence
  if (saveOfferState.display.kind === SaveOfferDisplayKind.Visible) {
    const { offer } = saveOfferState.display
    if (
      widgetState.workflowKey.kind !== WidgetWorkflowKeyKind.Assigned ||
      widgetState.workflowKey.key !== `save:${offer.offerId}`
    ) {
      renderSaveOfferWidget(offer)
    }
    return
  }
  if (saveOfferState.watch.kind === SavePageWatchKind.Watching) {
    void evaluatePendingSaveEvidence()
    return
  }
  const pendingOffer = await loadPendingSaveOffer()
  if (sequence !== scanState.sequence) return
  if (pendingOffer.kind === PendingSaveOfferLoadKind.Loaded) {
    beginPendingSaveWatch(pendingOffer.offer)
    return
  }
  const [recoveryCopy, backupCodesHint] = authenticationRecoveryEvidence()
  const enrollmentHints = detectEnrollmentHintsFromRecoveryCopy(recoveryCopy)
  enrollmentHints.backupCodes = backupCodesHint
  const workflowForms = summarizeAuthenticationWorkflowForms().slice(
    0,
    MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS,
  )
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
      pageHasManualCheckpoint(document),
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
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
    const vaultConnection = await loadPilotVaultConnection()
    if (sequence !== scanState.sequence) return
    const nookTypedArgs0_0: Parameters<typeof renderEnrollmentWidget>[0] = {
      hints: enrollmentHints,
      snapshot: enrollmentMatch.snapshot,
      vaultConnection,
    }
    renderEnrollmentWidget(nookTypedArgs0_0)
    return
  }
  if (workflowForms.length === 0) {
    removeScannedWidget()
    return
  }

  const classifiedRequest: Parameters<
    typeof classifiedAuthenticationWorkflowObservations
  >[0] = {
    workflowForms,
    authenticatorSetupHint: enrollmentHints.qr,
    backupCodesHint: enrollmentHints.backupCodes,
  }
  const classifiedWorkflows =
    classifiedAuthenticationWorkflowObservations(classifiedRequest)
  if (classifiedWorkflows.length === 0) {
    removeScannedWidget()
    return
  }
  const message: Parameters<
    typeof sendAuthenticationWorkflowSnapshotRuntimeMessage
  >[0] = {
    type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
    payload: {
      origin: location.origin,
      observations: classifiedWorkflows.map(({ facts }) => facts),
    },
  }
  const delivery =
    await sendAuthenticationWorkflowSnapshotRuntimeMessage(message)
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
  const vaultConnection = await loadPilotVaultConnection()
  if (sequence !== scanState.sequence) return
  const nookTypedArgs0_1: Parameters<typeof renderWidget>[0] = {
    snapshot,
    workflow: selected.observation,
    facts: response.selectedFacts,
    loginMatches,
    vaultConnection,
  }
  renderWidget(nookTypedArgs0_1)
}

async function scanAndRender(): Promise<void> {
  try {
    await performScanAndRender()
  } finally {
    recordAuthenticationRecoveryEvidenceState()
  }
}

function scheduleScan(mutations?: AuthenticationScanMutationBatch) {
  if (
    Array.isArray(mutations) &&
    mutations.length > 0 &&
    !mutations.some(authenticationFactMutationRequiresScan)
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
  cancelPendingAuthenticatorPickerRequest()
  cancelPendingLoginPickerRequest()
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
  const impactRequest: Parameters<typeof authenticationMutationImpact>[0] = {
    records,
    mountedHost,
    renderedWorkflow,
  }
  const impact = authenticationMutationImpact(impactRequest)
  if (!impact.shouldScheduleScan) return
  if (pageHasManualCheckpoint(document)) {
    invalidateRenderedAuthenticationAction()
    removeScannedWidget()
    scheduleScan()
    return
  }
  if (
    widgetState.host.kind === WidgetHostKind.Attached &&
    renderedWorkflow &&
    impact.shouldRemountRenderedWorkflow
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
  const clampRequest: Parameters<typeof clampWidgetPosition>[0] = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
  const position = clampWidgetPosition(clampRequest)
  widgetState.setPosition(position)
  const applyRequest: Parameters<typeof applyWidgetPosition>[0] = {
    host,
    position,
  }
  applyWidgetPosition(applyRequest)
}

scanState.schedule = scheduleScan

void companionWasmReady.then(() => {
  if (isRuntimeNookVaultAppUrl(location.href)) {
    return
  }
  document.addEventListener('submit', captureSubmittedLogin, true)
  void scanAndRender()

  const observer = new MutationObserver(handleAuthenticationMutations)
  const observerOptions: MutationObserverInit = {
    ...authenticationFactObserverOptions,
    attributeFilter: [...AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER],
  }
  observer.observe(document.documentElement, observerOptions)
  observeAuthenticationSubmitValueAssignments(scheduleScan)
  window.addEventListener('message', (event) => {
    if (
      !isAuthenticationRouteHistoryMessage(event) &&
      !isAuthenticationSubmitValueMessage(event)
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
