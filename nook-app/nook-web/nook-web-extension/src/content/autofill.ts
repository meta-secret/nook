import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  authentication_enrollment_workflow_match,
  authentication_workflow_pilot_presentation_capability,
  AuthenticationWorkflowSnapshotResponseKind,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authenticationPageObservationFacts,
  pageHasManualCheckpoint,
  summarizeAuthenticationWorkflowForms,
} from '../../../nook-web-shared/src/extension/password-forms'
import { isRuntimeNookVaultAppUrl } from '../lib/simple-vault-runtime'
import { authenticationRecoveryCopy } from '../lib/backup-code-candidates'
import {
  AuthenticationWorkflowSnapshotMessageType,
  MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS,
} from '../lib/auth-workflow-messages'
import { cancelPendingAuthenticatorPickerRequest } from './autofill/authenticator-actions'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  AUTHENTICATION_VIEWPORT_EVENTS,
  mutationBelongsOnlyToMountedWidget,
  mutationCanChangeAuthenticationWorkflows,
  mutationTouchesAuthenticationWorkflow,
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
  WidgetHostKind,
  WidgetWorkflowKeyKind,
  WidgetWorkflowRootKind,
  authenticationActionState,
  invalidateAuthenticationActionContext,
  saveOfferState,
  scanState,
  widgetState,
} from './autofill/state'
import {
  renderEnrollmentWidget,
  renderWidget,
} from './autofill/widget-rendering'
import { clampMountedWidgetPosition } from './autofill/widget-position'
import { loadPilotVaultConnection, remountWidget } from './autofill/workflow-ui'
import {
  detectEnrollmentHints,
  enrollmentCeremonyActive,
} from './enrollment-flow'

async function performScanAndRender(): Promise<void> {
  if (widgetState.dismissed) return
  if (saveOfferState.confirmationActive) return
  if (enrollmentCeremonyActive()) return
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
  const enrollmentHints = detectEnrollmentHints()
  const recoveryCopy = authenticationRecoveryCopy()
  const workflowForms = summarizeAuthenticationWorkflowForms().slice(
    0,
    MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS,
  )
  // Setup material starts an enrollment ceremony. Recovery hints remain part
  // of an active OTP challenge so Rust can keep code fill as the primary action,
  // while a direct backup-code-only page still exposes the save ceremony.
  if (
    enrollmentHints.qr ||
    (enrollmentHints.backupCodes && workflowForms.length === 0)
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
      action: enrollmentMatch.snapshot.action,
      vaultConnection,
    }
    renderEnrollmentWidget(nookTypedArgs0_0)
    return
  }
  if (workflowForms.length === 0) {
    removeScannedWidget()
    return
  }

  const message: Parameters<
    typeof sendAuthenticationWorkflowSnapshotRuntimeMessage
  >[0] = {
    type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
    payload: {
      origin: location.origin,
      observations: workflowForms.map((observation) => {
        const factsRequest: Parameters<
          typeof authenticationPageObservationFacts
        >[0] = {
          observation,
          authenticatorSetupHint: enrollmentHints.qr,
          backupCodesCopy: recoveryCopy,
        }
        return authenticationPageObservationFacts(factsRequest)
      }),
    },
  }
  const delivery =
    await sendAuthenticationWorkflowSnapshotRuntimeMessage(message)
  if (sequence !== scanState.sequence) return
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    removeScannedWidget()
    return
  }
  const { workflow: response, loginMatches } = delivery.response
  if (
    response.kind !== AuthenticationWorkflowSnapshotResponseKind.Matched ||
    !('snapshot' in response)
  ) {
    removeScannedWidget()
    return
  }
  const { snapshot } = response
  if (
    authentication_workflow_pilot_presentation_capability(snapshot) === 'hidden'
  ) {
    removeScannedWidget()
    return
  }
  const selected = workflowForms[snapshot.observationIndex]
  if (!selected) {
    removeScannedWidget()
    return
  }
  const vaultConnection = await loadPilotVaultConnection()
  if (sequence !== scanState.sequence) return
  const nookTypedArgs0_1: Parameters<typeof renderWidget>[0] = {
    snapshot,
    workflow: selected,
    vaultConnection,
    loginMatches,
  }
  renderWidget(nookTypedArgs0_1)
}

async function scanAndRender(): Promise<void> {
  if (!scanState.beginScan()) return
  try {
    await performScanAndRender()
  } finally {
    if (scanState.finishScan()) scheduleScan()
  }
}

function scheduleScan(): void {
  if (scanState.requestFollowUpIfRunning()) return
  scanState.scheduleTimer(() =>
    window.setTimeout(() => {
      scanState.clearPendingTimer()
      void scanAndRender()
    }, 150),
  )
}

function invalidateRenderedAuthenticationAction(): void {
  const args: Parameters<typeof invalidateAuthenticationActionContext>[0] = {
    actionState: authenticationActionState,
    widget: widgetState,
  }
  invalidateAuthenticationActionContext(args)
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
      widgetState.detachRenderedWidget()
      scheduleScan()
      return
    }
  }
  const mountedHost =
    widgetState.host.kind === WidgetHostKind.Attached
      ? widgetState.host.element
      : undefined
  const pageMutations = records.filter((record) => {
    const request: Parameters<typeof mutationBelongsOnlyToMountedWidget>[0] = {
      record,
      mountedHost,
    }
    return !mutationBelongsOnlyToMountedWidget(request)
  })
  if (pageMutations.length === 0) return
  if (pageHasManualCheckpoint(document)) {
    invalidateRenderedAuthenticationAction()
    removeScannedWidget()
    scheduleScan()
    return
  }
  const renderedWorkflow = widgetState.renderedWorkflowRoot
  if (
    widgetState.host.kind === WidgetHostKind.Attached &&
    renderedWorkflow.kind === WidgetWorkflowRootKind.Assigned &&
    pageMutations.some((record) => {
      const request: Parameters<
        typeof mutationTouchesAuthenticationWorkflow
      >[0] = { record, workflow: renderedWorkflow.observation }
      return (
        mutationTouchesAuthenticationWorkflow(request) ||
        mutationCanChangeAuthenticationWorkflows(record)
      )
    })
  ) {
    invalidateRenderedAuthenticationAction()
    remountWidget()
  }
  scheduleScan()
}

function handleViewportChange(): void {
  clampMountedWidgetPosition()
  if (
    widgetState.host.kind === WidgetHostKind.Attached &&
    widgetState.renderedWorkflowRoot.kind === WidgetWorkflowRootKind.Assigned
  ) {
    invalidateRenderedAuthenticationAction()
    remountWidget()
  }
  scheduleScan()
}

scanState.schedule = scheduleScan

void companionWasmReady.then(() => {
  if (isRuntimeNookVaultAppUrl(location.href)) {
    return
  }
  document.addEventListener('submit', captureSubmittedLogin, true)
  void scanAndRender()

  const observer = new MutationObserver(handleAuthenticationMutations)
  const nookTypedArgs0_1: Parameters<typeof observer.observe>[1] = {
    attributes: true,
    attributeFilter: [...AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER],
    childList: true,
    characterData: true,
    subtree: true,
  }
  observer.observe(document.documentElement, nookTypedArgs0_1)
  for (const eventName of AUTHENTICATION_VIEWPORT_EVENTS) {
    const options: AddEventListenerOptions = {
      capture: eventName === 'scroll',
      passive: true,
    }
    window.addEventListener(eventName, handleViewportChange, options)
  }
})
