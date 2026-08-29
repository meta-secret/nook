import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
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
  authenticationMutationImpact,
} from './autofill/authentication-surface-observation'
import { authenticationEnrollmentObservationFacts } from './autofill/authentication-enrollment-observation'
import {
  AuthenticationEnrollmentWorkflowDeliveryKind,
  performAuthenticationEnrollmentScan,
  postSaveEnrollmentHoldAllowsOrdinarySurface,
  refreshHeldEnrollmentRecoveryPresentation,
} from './autofill/authentication-enrollment-scan'
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
import {
  loadPilotVaultConnection,
  remountWidget,
  setFlightProgress,
} from './autofill/workflow-ui'
import {
  detectEnrollmentHints,
  enrollmentCeremonyActive,
  enrollmentWidgetHeldAfterSave,
  releaseEnrollmentWidgetHold,
  renderEnrollmentActions,
} from './enrollment-flow'

async function performScanAndRender(): Promise<void> {
  if (widgetState.dismissed) return
  if (saveOfferState.confirmationActive) return
  if (enrollmentCeremonyActive()) return
  const postSaveWidget = enrollmentWidgetHeldAfterSave()
  const preservePostSaveWidget = postSaveWidget.kind === 'held'
  const ordinarySurfacesAllowed = postSaveEnrollmentHoldAllowsOrdinarySurface(
    preservePostSaveWidget,
  )
  const removeUnavailableWidget = (): void => {
    if (!preservePostSaveWidget) removeScannedWidget()
  }
  const sequence = ++scanState.sequence
  if (
    ordinarySurfacesAllowed &&
    saveOfferState.display.kind === SaveOfferDisplayKind.Visible
  ) {
    const { offer } = saveOfferState.display
    if (
      widgetState.workflowKey.kind !== WidgetWorkflowKeyKind.Assigned ||
      widgetState.workflowKey.key !== `save:${offer.offerId}`
    ) {
      renderSaveOfferWidget(offer)
    }
    return
  }
  if (
    ordinarySurfacesAllowed &&
    saveOfferState.watch.kind === SavePageWatchKind.Watching
  ) {
    void evaluatePendingSaveEvidence()
    return
  }
  if (ordinarySurfacesAllowed) {
    const pendingOffer = await loadPendingSaveOffer()
    if (sequence !== scanState.sequence) return
    if (pendingOffer.kind === PendingSaveOfferLoadKind.Loaded) {
      beginPendingSaveWatch(pendingOffer.offer)
      return
    }
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
    const actionContextArgs: Parameters<
      typeof invalidateAuthenticationActionContext
    >[0] = {
      actionState: authenticationActionState,
      widget: widgetState,
    }
    invalidateAuthenticationActionContext(actionContextArgs)
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
    const observationRequest: Parameters<
      typeof authenticationEnrollmentObservationFacts
    >[0] = {
      authenticatorSetupPresent: enrollmentHints.qr,
      backupCodesCopy: recoveryCopy,
      manualCheckpointPresent: pageHasManualCheckpoint(document),
    }
    const message: Parameters<
      typeof sendAuthenticationWorkflowSnapshotRuntimeMessage
    >[0] = {
      type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
      payload: {
        origin: location.origin,
        observations: [
          authenticationEnrollmentObservationFacts(observationRequest),
        ],
      },
    }
    const postSaveHeld =
      postSaveWidget.kind === 'held' && postSaveWidget.host.panel.isConnected
    await performAuthenticationEnrollmentScan({
      hints: enrollmentHints,
      postSaveHeld,
      deliverWorkflow: async () => {
        const delivery =
          await sendAuthenticationWorkflowSnapshotRuntimeMessage(message)
        return delivery.kind === RuntimeMessageDeliveryKind.Unavailable
          ? {
              kind: AuthenticationEnrollmentWorkflowDeliveryKind.Unavailable,
            }
          : {
              kind: AuthenticationEnrollmentWorkflowDeliveryKind.Delivered,
              workflow: delivery.response.workflow,
            }
      },
      isCurrent: () => sequence === scanState.sequence,
      loadVaultConnection: loadPilotVaultConnection,
      removeUnavailable: removeUnavailableWidget,
      renderNew: ({ snapshot, vaultConnection }) => {
        const nookTypedArgs0_0: Parameters<typeof renderEnrollmentWidget>[0] = {
          hints: enrollmentHints,
          snapshot,
          vaultConnection,
        }
        releaseEnrollmentWidgetHold()
        renderEnrollmentWidget(nookTypedArgs0_0)
      },
      renderPostSaveRecovery: ({ hints, snapshot }) => {
        if (postSaveWidget.kind !== 'held') return
        const approvedActions: Parameters<typeof renderEnrollmentActions>[0] = {
          host: postSaveWidget.host,
          hints,
        }
        const presentationRequest: Parameters<
          typeof refreshHeldEnrollmentRecoveryPresentation
        >[0] = {
          host: postSaveWidget.host,
          snapshot,
          updateProgress: setFlightProgress,
        }
        refreshHeldEnrollmentRecoveryPresentation(presentationRequest)
        releaseEnrollmentWidgetHold()
        renderEnrollmentActions(approvedActions)
      },
    })
    return
  }
  if (!ordinarySurfacesAllowed) return
  if (workflowForms.length === 0) {
    removeUnavailableWidget()
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
    removeUnavailableWidget()
    return
  }
  const { workflow: response, loginMatches } = delivery.response
  if (
    response.kind !== AuthenticationWorkflowSnapshotResponseKind.Matched ||
    !('snapshot' in response)
  ) {
    removeUnavailableWidget()
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
    removeUnavailableWidget()
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
  const renderedWorkflow =
    widgetState.renderedWorkflowRoot.kind === WidgetWorkflowRootKind.Assigned
      ? widgetState.renderedWorkflowRoot.observation
      : undefined
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
    remountWidget()
  }
  scheduleScan()
}

function handleViewportChange(): void {
  clampMountedWidgetPosition()
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
