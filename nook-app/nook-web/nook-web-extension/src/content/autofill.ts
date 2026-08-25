import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import type {
  AuthenticationPageObservationFacts,
  AuthenticationWorkflowRuntimeResponse,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  pageHasManualCheckpoint,
  PasswordFormScopeKind,
} from '../../../nook-web-shared/src/extension/password-form-fields'
import {
  summarizeAuthenticationWorkflowForms,
  type PasswordFormObservation,
} from '../../../nook-web-shared/src/extension/password-forms'
import { isRuntimeNookVaultAppUrl } from '../lib/simple-vault-runtime'
import {
  AuthenticationWorkflowSnapshotMessageType,
  MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS,
} from '../lib/auth-workflow-messages'
import { cancelPendingAuthenticatorPickerRequest } from './autofill/authenticator-actions'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  AUTHENTICATION_VIEWPORT_EVENTS,
  authenticationEnrollmentObservation,
  authenticationPageObservation,
} from './autofill/authentication-observation'
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
  cancelActiveEnrollmentCeremony,
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
  const removeUnavailableWidget = (): void => {
    if (!preservePostSaveWidget) removeScannedWidget()
  }
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
      typeof authenticationEnrollmentObservation
    >[0] = {
      authenticatorSetupPresent: enrollmentHints.qr,
      backupCodesPresent: enrollmentHints.backupCodes,
      manualCheckpointPresent: pageHasManualCheckpoint(document),
    }
    const message: Parameters<
      typeof sendAuthenticationWorkflowSnapshotRuntimeMessage
    >[0] = {
      type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
      payload: {
        origin: location.origin,
        observations: [authenticationEnrollmentObservation(observationRequest)],
      },
    }
    const delivery =
      await sendAuthenticationWorkflowSnapshotRuntimeMessage(message)
    if (sequence !== scanState.sequence) return
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      removeUnavailableWidget()
      return
    }
    const { workflow: response } = delivery.response
    if (response.kind !== 'matched' || !('snapshot' in response)) {
      removeUnavailableWidget()
      return
    }
    const vaultConnection = await loadPilotVaultConnection()
    if (sequence !== scanState.sequence) return
    if (
      postSaveWidget.kind === 'held' &&
      postSaveWidget.host.panel.isConnected
    ) {
      const approvedHints: Parameters<typeof renderEnrollmentActions>[0] = {
        host: postSaveWidget.host,
        hints: {
          qr:
            response.snapshot.action === 'enroll-authenticator' &&
            enrollmentHints.qr,
          backupCodes:
            response.snapshot.action === 'save-backup-codes' &&
            enrollmentHints.backupCodes,
        },
      }
      releaseEnrollmentWidgetHold()
      renderEnrollmentActions(approvedHints)
    } else {
      const nookTypedArgs0_0: Parameters<typeof renderEnrollmentWidget>[0] = {
        hints: enrollmentHints,
        snapshot: response.snapshot,
        vaultConnection,
      }
      releaseEnrollmentWidgetHold()
      renderEnrollmentWidget(nookTypedArgs0_0)
    }
    return
  }
  if (workflowForms.length === 0) {
    removeUnavailableWidget()
    return
  }

  const observations: AuthenticationPageObservationFacts[] = workflowForms.map(
    ({ summary }) => {
      const observationRequest: Parameters<
        typeof authenticationPageObservation
      >[0] = {
        summary,
        authenticatorSetupPresent: enrollmentHints.qr,
        backupCodesPresent: enrollmentHints.backupCodes,
        manualCheckpointPresent: pageHasManualCheckpoint(document),
      }
      return authenticationPageObservation(observationRequest)
    },
  )
  const message: Parameters<
    typeof sendAuthenticationWorkflowSnapshotRuntimeMessage
  >[0] = {
    type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
    payload: {
      origin: location.origin,
      observations,
    },
  }
  const delivery =
    await sendAuthenticationWorkflowSnapshotRuntimeMessage(message)
  if (sequence !== scanState.sequence) return
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    removeUnavailableWidget()
    return
  }
  const runtimeResponse: AuthenticationWorkflowRuntimeResponse =
    delivery.response
  const { workflow: response, loginMatches } = runtimeResponse
  if (response.kind !== 'matched' || !('snapshot' in response)) {
    removeUnavailableWidget()
    return
  }
  const { snapshot } = response
  if (
    (snapshot.action === 'enroll-authenticator' && enrollmentHints.qr) ||
    (snapshot.action === 'save-backup-codes' && enrollmentHints.backupCodes)
  ) {
    const vaultConnection = await loadPilotVaultConnection()
    if (sequence !== scanState.sequence) return
    if (
      postSaveWidget.kind === 'held' &&
      postSaveWidget.host.panel.isConnected
    ) {
      const approvedHints: Parameters<typeof renderEnrollmentActions>[0] = {
        host: postSaveWidget.host,
        hints: {
          qr: snapshot.action === 'enroll-authenticator' && enrollmentHints.qr,
          backupCodes:
            snapshot.action === 'save-backup-codes' &&
            enrollmentHints.backupCodes,
        },
      }
      releaseEnrollmentWidgetHold()
      renderEnrollmentActions(approvedHints)
    } else {
      const nookTypedArgs0_1: Parameters<typeof renderEnrollmentWidget>[0] = {
        hints: enrollmentHints,
        snapshot,
        vaultConnection,
      }
      releaseEnrollmentWidgetHold()
      renderEnrollmentWidget(nookTypedArgs0_1)
    }
    return
  }
  const selected = workflowForms[snapshot.observationIndex]
  if (!selected) {
    removeUnavailableWidget()
    return
  }
  const vaultConnection = await loadPilotVaultConnection()
  if (sequence !== scanState.sequence) return
  const nookTypedArgs0_2: Parameters<typeof renderWidget>[0] = {
    snapshot,
    workflow: selected,
    vaultConnection,
    loginMatches,
  }
  releaseEnrollmentWidgetHold()
  renderWidget(nookTypedArgs0_2)
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

function isExtensionWidgetMutation(record: MutationRecord): boolean {
  if (widgetState.host.kind !== WidgetHostKind.Attached) return false
  const mountedHost = widgetState.host.element
  if (record.target === mountedHost || mountedHost.contains(record.target)) {
    return true
  }
  if (record.type !== 'childList') return false
  const changedNodes = [...record.addedNodes, ...record.removedNodes]
  return (
    changedNodes.length > 0 &&
    changedNodes.every((node) => node === mountedHost)
  )
}

type AuthenticationMutationRecords = MutationRecord[]

function authenticationWorkflowBoundary(
  workflow: PasswordFormObservation,
): ParentNode {
  return workflow.formScope.kind === PasswordFormScopeKind.Unowned
    ? workflow.root
    : workflow.formScope.owner
}

function mutationTouchesRenderedWorkflow(record: MutationRecord): boolean {
  if (
    widgetState.renderedWorkflowRoot.kind !== WidgetWorkflowRootKind.Assigned
  ) {
    return false
  }
  const boundary = authenticationWorkflowBoundary(
    widgetState.renderedWorkflowRoot.observation,
  )
  if (!(boundary instanceof Node)) return true
  const touchesOwnedFormAssociation = (node: Node): boolean => {
    if (!(boundary instanceof HTMLFormElement)) return false
    const controlBelongsToBoundary = (control: HTMLElement): boolean =>
      (control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement ||
        control instanceof HTMLOutputElement) &&
      control.form === boundary
    const element =
      node instanceof Element
        ? node
        : node.parentElement instanceof Element
          ? node.parentElement
          : false
    if (!element) return false
    const formControls = Array.from(boundary.elements)
    if (
      formControls.some(
        (control) =>
          control === element ||
          control.contains(element) ||
          element.contains(control),
      )
    ) {
      return true
    }
    const associatedLabel = element.closest('label')
    if (
      associatedLabel?.control &&
      controlBelongsToBoundary(associatedLabel.control)
    ) {
      return true
    }
    return Array.from(element.querySelectorAll('label')).some(
      (label) =>
        Boolean(label.control) &&
        controlBelongsToBoundary(label.control as HTMLElement),
    )
  }
  if (boundary === record.target || boundary.contains(record.target)) {
    return true
  }
  if (
    record.type === 'attributes' &&
    record.target instanceof Element &&
    record.target.contains(boundary)
  ) {
    return true
  }
  if (touchesOwnedFormAssociation(record.target)) return true
  if (record.type !== 'childList') return false
  return [...record.addedNodes, ...record.removedNodes].some(
    (node) =>
      boundary.contains(node) ||
      node.contains(boundary) ||
      touchesOwnedFormAssociation(node),
  )
}

const AUTHENTICATION_WORKFLOW_MUTATION_SELECTOR = [
  'form',
  'input',
  'button',
  'select',
  'textarea',
  '[role="button"]',
  '[data-nook-manual-checkpoint]',
  '[data-nook-passkey-control]',
].join(',')

function mutationCanIntroduceCompetingWorkflow(
  record: MutationRecord,
): boolean {
  const containsAuthenticationControl = (node: Node): boolean =>
    node instanceof Element &&
    (node.matches(AUTHENTICATION_WORKFLOW_MUTATION_SELECTOR) ||
      Boolean(node.querySelector(AUTHENTICATION_WORKFLOW_MUTATION_SELECTOR)))
  if (record.type === 'childList') {
    return [...record.addedNodes, ...record.removedNodes].some(
      containsAuthenticationControl,
    )
  }
  if (record.type === 'attributes') {
    return containsAuthenticationControl(record.target)
  }
  return Boolean(
    record.target.parentElement?.closest(
      AUTHENTICATION_WORKFLOW_MUTATION_SELECTOR,
    ),
  )
}

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
      authenticationActionState.invalidate()
      widgetState.busy = false
      cancelPendingAuthenticatorPickerRequest()
      cancelPendingLoginPickerRequest()
      widgetState.detachRenderedWidget()
      if (enrollmentCeremonyActive()) {
        void cancelActiveEnrollmentCeremony().finally(() => scheduleScan())
      } else {
        scheduleScan()
      }
      return
    }
  }
  const pageMutations = records.filter(
    (record) => !isExtensionWidgetMutation(record),
  )
  if (pageMutations.length === 0) return
  if (pageHasManualCheckpoint(document)) {
    authenticationActionState.invalidate()
    widgetState.busy = false
    const enrollmentCancellation = cancelActiveEnrollmentCeremony()
    removeScannedWidget()
    void enrollmentCancellation.finally(() => scheduleScan())
    return
  }
  if (
    !enrollmentCeremonyActive() &&
    widgetState.host.kind === WidgetHostKind.Attached &&
    pageMutations.some(
      (record) =>
        mutationTouchesRenderedWorkflow(record) ||
        mutationCanIntroduceCompetingWorkflow(record),
    )
  ) {
    authenticationActionState.invalidate()
    widgetState.busy = false
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
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
    authenticationActionState.invalidate()
    widgetState.busy = false
    cancelPendingAuthenticatorPickerRequest()
    cancelPendingLoginPickerRequest()
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

  const observer = new MutationObserver((records) =>
    handleAuthenticationMutations(records),
  )
  const nookTypedArgs0_1: Parameters<typeof observer.observe>[1] = {
    attributes: true,
    attributeFilter: [...AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER],
    childList: true,
    characterData: true,
    subtree: true,
  }
  observer.observe(document.documentElement, nookTypedArgs0_1)
  for (const eventName of AUTHENTICATION_VIEWPORT_EVENTS) {
    const nookTypedArgs0_2: AddEventListenerOptions = {
      capture: eventName === 'scroll',
      passive: true,
    }
    window.addEventListener(eventName, handleViewportChange, nookTypedArgs0_2)
  }
})
