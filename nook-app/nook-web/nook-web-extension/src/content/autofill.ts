import { isAuthenticationRouteHistoryMessage } from '../../../nook-web-shared/src/extension/authentication-route-history'
import {
  authenticationFactObserverOptions,
  observeAuthenticationSubmitValueAssignments,
} from '../../../nook-web-shared/src/extension/authentication-fact-attributes'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import { AuthenticationWorkflowSnapshotResponseKind } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { classifiedAuthenticationWorkflowObservations } from '../../../nook-web-shared/src/extension/password-form-classified-observations'
import { summarizeAuthenticationWorkflowForms } from '../../../nook-web-shared/src/extension/password-forms'
import { isRuntimeNookVaultAppUrl } from '../lib/simple-vault-runtime'
import {
  AuthenticationWorkflowSnapshotMessageType,
  MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS,
} from '../lib/auth-workflow-messages'
import { cancelPendingAuthenticatorPickerRequest } from './autofill/authenticator-actions'
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
  WidgetWorkflowKeyKind,
  saveOfferState,
  scanState,
  widgetState,
} from './autofill/state'
import {
  renderEnrollmentWidget,
  renderWidget,
} from './autofill/widget-rendering'
import { loadPilotVaultConnection } from './autofill/workflow-ui'
import {
  detectEnrollmentHints,
  enrollmentCeremonyActive,
} from './enrollment-flow'

async function scanAndRender(): Promise<void> {
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
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
    const vaultConnection = await loadPilotVaultConnection()
    if (sequence !== scanState.sequence) return
    const nookTypedArgs0_0: Parameters<typeof renderEnrollmentWidget>[0] = {
      hints: enrollmentHints,
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
  if (
    response.kind !== AuthenticationWorkflowSnapshotResponseKind.Matched ||
    !('snapshot' in response)
  ) {
    removeScannedWidget()
    return
  }
  const { snapshot } = response
  const selected = classifiedWorkflows[snapshot.observationIndex]
  if (!selected) {
    removeScannedWidget()
    return
  }
  const vaultConnection = await loadPilotVaultConnection()
  if (sequence !== scanState.sequence) return
  const nookTypedArgs0_1: Parameters<typeof renderWidget>[0] = {
    snapshot,
    workflow: selected.observation,
    facts: selected.facts,
    vaultConnection,
  }
  renderWidget(nookTypedArgs0_1)
}

function scheduleScan() {
  if (scanState.scheduleState.kind === ScanScheduleKind.Scheduled) {
    window.clearTimeout(scanState.scheduleState.timer)
  }

  scanState.scheduleTimer(
    window.setTimeout(() => {
      scanState.clearPendingTimer()
      void scanAndRender()
    }, 150),
  )
}

scanState.schedule = scheduleScan

void companionWasmReady.then(() => {
  if (isRuntimeNookVaultAppUrl(location.href)) {
    return
  }
  document.addEventListener('submit', captureSubmittedLogin, true)
  void scanAndRender()

  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.documentElement, authenticationFactObserverOptions)
  observeAuthenticationSubmitValueAssignments(scheduleScan)
  window.addEventListener('message', (event) => {
    if (!isAuthenticationRouteHistoryMessage(event)) return
    scheduleScan()
  })
})
