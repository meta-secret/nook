import {
  authenticationRouteBrowser,
  type AuthenticationSourceMessage,
} from '../../../nook-web-shared/src/extension/authentication-route-history'
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
import {
  AuthenticationGesture,
  NamecheapWidgetDisplayEligibility,
  NamecheapWidgetDisplayGate,
} from '../lib/auth-widget-policy'
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
  AuthenticationControlActivationDisposition,
  authenticationControlActivationDisposition,
} from './autofill/authentication-action-lifecycle'
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

enum AuthenticationScanOutcome {
  Removed = 'removed',
  Rendered = 'rendered',
  Stale = 'stale',
  Suppressed = 'suppressed',
  Watching = 'watching',
}

type AuthenticationScanRenderLifecycleRequest = {
  readonly scanState: typeof scanState
}

type AuthenticationMutationRecords = MutationRecord[]

/** Owns trusted recognition of Namecheap's same-document Sign in drawer control. */
class NamecheapLoginDrawerActivation {
  constructor(private readonly gate: NamecheapWidgetDisplayGate) {}

  observe(event: MouseEvent): boolean {
    if (!new AuthenticationGesture(event).trusted) return false
    const target = event.target
    if (!(target instanceof Element)) return false
    const control = target.closest(
      'a, button, input[type="button"], input[type="submit"], [role="button"]',
    )
    if (!(control instanceof HTMLElement)) return false
    const label =
      control instanceof HTMLInputElement ? control.value : control.textContent
    if (label?.trim().toLowerCase() !== 'sign in') return false
    this.gate.observeSignInGesture(new AuthenticationGesture(event))
    return true
  }
}

class AuthenticationScanRenderLifecycle {
  constructor(
    private readonly request: AuthenticationScanRenderLifecycleRequest,
  ) {}

  private async performScanAndRender(): Promise<AuthenticationScanOutcome> {
    if (widgetState.dismissed) return AuthenticationScanOutcome.Suppressed
    if (saveOfferState.confirmationActive)
      return AuthenticationScanOutcome.Suppressed
    if (authenticatorEnrollmentInteraction.enrollmentScanBlocked())
      return AuthenticationScanOutcome.Suppressed
    const sequence = ++this.request.scanState.sequence
    if (saveOfferState.display.kind === SaveOfferDisplayKind.Visible) {
      const { offer } = saveOfferState.display
      if (
        widgetState.workflowKey.kind !== WidgetWorkflowKeyKind.Assigned ||
        widgetState.workflowKey.key !== `save:${offer.offerId}`
      ) {
        loginSaveInteraction.renderSaveOfferWidget(offer)
      }
      return AuthenticationScanOutcome.Rendered
    }
    if (saveOfferState.watch.kind === SavePageWatchKind.Watching) {
      void loginSaveInteraction.evaluatePendingSaveEvidence()
      return AuthenticationScanOutcome.Watching
    }
    const pendingOffer = await loginSaveInteraction.loadPendingSaveOffer()
    if (sequence !== this.request.scanState.sequence)
      return AuthenticationScanOutcome.Stale
    if (pendingOffer.kind === PendingSaveOfferLoadKind.Loaded) {
      loginSaveInteraction.beginPendingSaveWatch(pendingOffer.offer)
      return AuthenticationScanOutcome.Watching
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
        return AuthenticationScanOutcome.Removed
      }
      authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
      loginPasskeyInteraction.cancelPendingLoginPickerRequest()
      const vaultConnection = await workflowUi.loadPilotVaultConnection()
      if (sequence !== this.request.scanState.sequence)
        return AuthenticationScanOutcome.Stale
      const nookTypedArgs0_0: Parameters<
        typeof authenticationWidgetRenderer.renderEnrollmentWidget
      >[0] = {
        hints: enrollmentHints,
        snapshot: enrollmentMatch.snapshot,
        vaultConnection,
      }
      authenticationWidgetRenderer.renderEnrollmentWidget(nookTypedArgs0_0)
      return AuthenticationScanOutcome.Rendered
    }
    if (workflowForms.length === 0) {
      removeScannedWidget()
      return AuthenticationScanOutcome.Removed
    }
    const namecheapDisplayRequest: Parameters<
      typeof namecheapWidgetDisplayGate.eligibility
    >[0] = {
      hostname: location.hostname,
      pathname: location.pathname,
    }
    if (
      namecheapWidgetDisplayGate.eligibility(namecheapDisplayRequest) ===
      NamecheapWidgetDisplayEligibility.AwaitingTrustedActivation
    ) {
      removeScannedWidget()
      return AuthenticationScanOutcome.Suppressed
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
      return AuthenticationScanOutcome.Removed
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
    if (sequence !== this.request.scanState.sequence)
      return AuthenticationScanOutcome.Stale
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      removeScannedWidget()
      return AuthenticationScanOutcome.Removed
    }
    const { response } = delivery
    const { verdict, loginMatches } = response
    if (
      verdict.kind !== AuthenticationWorkflowSnapshotResponseKind.Matched ||
      !('snapshot' in verdict) ||
      response.selectedFacts.state !== 'selected'
    ) {
      removeScannedWidget()
      return AuthenticationScanOutcome.Removed
    }
    const { snapshot } = verdict
    const selected = classifiedWorkflows[snapshot.observationIndex]
    if (
      authentication_workflow_pilot_presentation_capability(snapshot) ===
      'hidden'
    ) {
      removeScannedWidget()
      return AuthenticationScanOutcome.Removed
    }
    if (!selected) {
      removeScannedWidget()
      return AuthenticationScanOutcome.Removed
    }
    const vaultConnection = await workflowUi.loadPilotVaultConnection()
    if (sequence !== this.request.scanState.sequence)
      return AuthenticationScanOutcome.Stale
    const nookTypedArgs0_1: Parameters<
      typeof authenticationWidgetRenderer.renderWidget
    >[0] = {
      snapshot,
      workflow: selected.observation,
      facts: response.selectedFacts.facts,
      loginMatches,
      vaultConnection,
    }
    authenticationWidgetRenderer.renderWidget(nookTypedArgs0_1)
    return AuthenticationScanOutcome.Rendered
  }

  async scanAndRender(): Promise<void> {
    try {
      await this.performScanAndRender()
    } finally {
      authenticationSurfaceObservation.recordAuthenticationRecoveryEvidenceState()
    }
  }

  schedule(mutations?: AuthenticationScanMutationBatch): void {
    const { scanState } = this.request
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
        void this.scanAndRender()
      }, delay),
    )
  }

  handleMutations(records: AuthenticationMutationRecords): void {
    if (widgetState.host.kind === WidgetHostKind.Attached) {
      const mountedHost = widgetState.host.mountedElement
      const mountedHostWasRemoved = records.some(
        (record) =>
          record.type === 'childList' &&
          !mountedHost.isConnected &&
          [...record.removedNodes].some((node) => node === mountedHost),
      )
      if (mountedHostWasRemoved) {
        this.invalidateRenderedAuthenticationAction()
        widgetState.clearRenderedWidget()
        this.schedule()
        return
      }
    }
    const mountedHost =
      widgetState.host.kind === WidgetHostKind.Attached
        ? widgetState.host.mountedElement
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
      authenticationSurfaceObservation.authenticationMutationImpact(
        impactRequest,
      )
    if (!impact.shouldScheduleScan) return
    if (passwordFieldDiscovery.pageHasManualCheckpoint(document)) {
      this.invalidateRenderedAuthenticationAction()
      removeScannedWidget()
      this.schedule()
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
      this.invalidateRenderedAuthenticationAction()
      removeScannedWidget()
    }
    this.schedule()
  }

  handleAuthenticationControlActivation(target: Event['target']): void {
    const renderedWorkflow =
      widgetState.renderedWorkflowRoot.kind === WidgetWorkflowRootKind.Assigned
        ? widgetState.renderedWorkflowRoot.observation
        : false
    if (!renderedWorkflow || !(target instanceof Element)) return
    const control = target.closest(
      'a[href], button, input[type="submit"], input[type="button"], [role="button"]',
    )
    if (!(control instanceof HTMLElement)) return
    const mountedHost =
      widgetState.host.kind === WidgetHostKind.Attached
        ? widgetState.host.mountedElement
        : false
    const boundary =
      authenticationSurfaceObservation.authenticationWorkflowBoundary(
        renderedWorkflow,
      )
    const dispositionRequest: Parameters<
      typeof authenticationControlActivationDisposition
    >[0] = {
      controlTouchesRenderedWorkflow:
        boundary instanceof Node && boundary.contains(control),
      controlBelongsToMountedWidget: Boolean(
        mountedHost && mountedHost.contains(control),
      ),
      credentialActuationInFlight: widgetState.credentialActuationInFlight,
    }
    if (
      authenticationControlActivationDisposition(dispositionRequest) !==
      AuthenticationControlActivationDisposition.Invalidate
    ) {
      return
    }
    this.invalidateRenderedAuthenticationAction()
    this.request.scanState.invalidatePendingScan()
    removeScannedWidget()
    this.schedule()
  }

  private invalidateRenderedAuthenticationAction(): void {
    widgetState.busy = false
    authenticatorInteraction.cancelPendingAuthenticatorPickerRequest()
    loginPasskeyInteraction.cancelPendingLoginPickerRequest()
  }
}

const authenticationScanRenderLifecycleRequest: AuthenticationScanRenderLifecycleRequest =
  { scanState }
const authenticationScanRenderLifecycle = new AuthenticationScanRenderLifecycle(
  authenticationScanRenderLifecycleRequest,
)
const namecheapWidgetDisplayGate = new NamecheapWidgetDisplayGate()
const namecheapLoginDrawerActivation = new NamecheapLoginDrawerActivation(
  namecheapWidgetDisplayGate,
)

function handleViewportChange(): void {
  if (widgetState.host.kind !== WidgetHostKind.Attached) return
  const host = widgetState.host.mountedElement
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

scanState.schedule = authenticationScanRenderLifecycle.schedule.bind(
  authenticationScanRenderLifecycle,
)

void companionWasmReady.then(async () => {
  if (await simpleVaultRuntime.isRuntimeNookVaultAppUrl(location.href)) {
    return
  }
  document.addEventListener(
    'submit',
    loginSaveInteraction.captureSubmittedLogin.bind(loginSaveInteraction),
    true,
  )
  document.addEventListener(
    'click',
    (event) => {
      authenticationScanRenderLifecycle.handleAuthenticationControlActivation(
        event.target,
      )
      if (!namecheapLoginDrawerActivation.observe(event)) return
      authenticationScanRenderLifecycle.schedule()
    },
    true,
  )
  void authenticationScanRenderLifecycle.scanAndRender()

  const observer = new MutationObserver(
    authenticationScanRenderLifecycle.handleMutations.bind(
      authenticationScanRenderLifecycle,
    ),
  )
  const observerOptions: MutationObserverInit = {
    ...authenticationFactObserverOptions,
    attributeFilter: [...AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER],
  }
  observer.observe(document.documentElement, observerOptions)
  authenticationFactObserver.observeAuthenticationSubmitValueAssignments(
    authenticationScanRenderLifecycle.schedule.bind(
      authenticationScanRenderLifecycle,
    ),
  )
  const handleWindowMessage = (
    event: MessageEvent<AuthenticationSourceMessage>,
  ) => {
    if (
      !authenticationRouteBrowser.isAuthenticationRouteHistoryMessage(event) &&
      !authenticationFactObserver.isAuthenticationSubmitValueMessage(event)
    ) {
      return
    }
    authenticationScanRenderLifecycle.schedule()
  }
  window.addEventListener('message', handleWindowMessage)
  for (const eventName of AUTHENTICATION_VIEWPORT_EVENTS) {
    const options: AddEventListenerOptions = {
      capture: eventName === 'scroll',
      passive: true,
    }
    window.addEventListener(eventName, handleViewportChange, options)
  }
})
