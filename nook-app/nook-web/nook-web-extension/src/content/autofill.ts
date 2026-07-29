import { summarizeAuthenticationWorkflowForms } from '../../../nook-web-shared/src/extension/password-forms'
import { isRuntimeNookVaultAppUrl } from '../lib/simple-vault-runtime'
import { cancelPendingAuthenticatorPickerRequest } from './autofill/authenticator-actions'
import {
  cancelPendingLoginPickerRequest,
  RuntimeMessageDeliveryKind,
  sendRuntimeMessage,
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
import type { WorkflowSnapshotResponse } from './autofill/workflow-ui'
import {
  MAX_WORKFLOW_OBSERVATIONS,
  loadPilotVaultConnection,
} from './autofill/workflow-ui'
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
    MAX_WORKFLOW_OBSERVATIONS,
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
    renderEnrollmentWidget(enrollmentHints, vaultConnection)
    return
  }
  if (workflowForms.length === 0) {
    removeScannedWidget()
    return
  }

  const boundedCount = (count: number) => Math.min(count, 100)
  const delivery = await sendRuntimeMessage<WorkflowSnapshotResponse>({
    type: 'nook:authentication-workflow-snapshot',
    payload: {
      origin: location.origin,
      observations: workflowForms.map(({ summary }) => ({
        usernameFieldCount: boundedCount(summary.usernameFieldCount),
        currentPasswordFieldCount: boundedCount(
          summary.currentPasswordFieldCount,
        ),
        newPasswordFieldCount: boundedCount(summary.newPasswordFieldCount),
        genericPasswordFieldCount: boundedCount(
          summary.genericPasswordFieldCount,
        ),
        oneTimeCodeFieldCount: boundedCount(summary.oneTimeCodeFieldCount),
        manualCheckpointPresent: summary.manualCheckpointPresent,
        authenticatorSetupHint: detectEnrollmentHints().qr,
        backupCodesHint: detectEnrollmentHints().backupCodes,
        passkeyControlPresent: summary.passkeyControlPresent,
        matchingPasskeyAccountCount: 0,
      })),
    },
  })
  if (sequence !== scanState.sequence) return
  if (
    delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
    !delivery.response?.ok ||
    !delivery.response.snapshot
  ) {
    removeScannedWidget()
    return
  }
  const { response } = delivery
  const selected = workflowForms[response.snapshot.observationIndex]
  if (!selected) {
    removeScannedWidget()
    return
  }
  const vaultConnection = await loadPilotVaultConnection()
  if (sequence !== scanState.sequence) return
  renderWidget(response.snapshot, selected, vaultConnection)
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

if (!isRuntimeNookVaultAppUrl(location.href)) {
  document.addEventListener('submit', captureSubmittedLogin, true)
  void scanAndRender()

  const observer = new MutationObserver(scheduleScan)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      'aria-hidden',
      'autocomplete',
      'class',
      'disabled',
      'hidden',
      'id',
      'name',
      'style',
      'type',
    ],
    childList: true,
    subtree: true,
  })
}
