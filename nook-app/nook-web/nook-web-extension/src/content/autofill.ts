/* eslint-disable nook-typed-api/no-raw-object-arguments -- DOM observations are converted into typed Rust requests at this content boundary. */
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
import { AuthenticationWorkflowSnapshotResponseKind } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { CompanionWasmSessionMessageType } from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
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
  authenticationWidgetOwnsControl,
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
  AuthenticationDiagnosticAvailability,
  AuthenticationDiagnosticGate,
  AuthenticationDiagnosticGateOutcome,
  AuthenticationDiagnosticChannel,
  BrowserConsoleAuthenticationDiagnosticSink,
  type AuthenticationDiagnosticObservation,
} from './autofill/authentication-diagnostics'
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
import { runAfterCompanionWasmReady } from './autofill/companion-wasm-gate'
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

  private recordDiagnostic(
    observation: AuthenticationDiagnosticObservation,
  ): void {
    authenticationDiagnosticChannel.record(observation)
  }

  private async performScanAndRender(): Promise<AuthenticationScanOutcome> {
    if (widgetState.dismissed) {
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.Scan,
        outcome: AuthenticationDiagnosticGateOutcome.Skipped,
        candidateCount: 0,
      }
      this.recordDiagnostic(diagnostic)
      return AuthenticationScanOutcome.Suppressed
    }
    if (saveOfferState.confirmationActive) {
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.Scan,
        outcome: AuthenticationDiagnosticGateOutcome.Skipped,
        candidateCount: 0,
      }
      this.recordDiagnostic(diagnostic)
      return AuthenticationScanOutcome.Suppressed
    }
    if (authenticatorEnrollmentInteraction.enrollmentScanBlocked()) {
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.Scan,
        outcome: AuthenticationDiagnosticGateOutcome.Skipped,
        candidateCount: 0,
      }
      this.recordDiagnostic(diagnostic)
      return AuthenticationScanOutcome.Suppressed
    }
    const sequence = ++this.request.scanState.sequence
    const startedDiagnostic: AuthenticationDiagnosticObservation = {
      gate: AuthenticationDiagnosticGate.Scan,
      outcome: AuthenticationDiagnosticGateOutcome.Started,
      candidateCount: 0,
    }
    this.recordDiagnostic(startedDiagnostic)
    if (saveOfferState.display.kind === SaveOfferDisplayKind.Visible) {
      const { offer } = saveOfferState.display
      if (
        widgetState.workflowKey.kind !== WidgetWorkflowKeyKind.Assigned ||
        widgetState.workflowKey.key !== `save:${offer.offerId}`
      ) {
        loginSaveInteraction.renderSaveOfferWidget(offer)
      }
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.WidgetRendering,
        outcome: AuthenticationDiagnosticGateOutcome.Rendered,
        candidateCount: 0,
      }
      this.recordDiagnostic(diagnostic)
      return AuthenticationScanOutcome.Rendered
    }
    if (saveOfferState.watch.kind === SavePageWatchKind.Watching) {
      void loginSaveInteraction.evaluatePendingSaveEvidence()
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.Scan,
        outcome: AuthenticationDiagnosticGateOutcome.Skipped,
        candidateCount: 0,
      }
      this.recordDiagnostic(diagnostic)
      return AuthenticationScanOutcome.Watching
    }
    const pendingOffer = await loginSaveInteraction.loadPendingSaveOffer()
    if (sequence !== this.request.scanState.sequence)
      return AuthenticationScanOutcome.Stale
    if (pendingOffer.kind === PendingSaveOfferLoadKind.Loaded) {
      loginSaveInteraction.beginPendingSaveWatch(pendingOffer.offer)
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.Scan,
        outcome: AuthenticationDiagnosticGateOutcome.Skipped,
        candidateCount: 0,
      }
      this.recordDiagnostic(diagnostic)
      return AuthenticationScanOutcome.Watching
    }
    await passwordFieldDiscovery.prepareCompanionClassification(document)
    await recoveryCopyObservation.prepareAuthenticationRecoveryEvidence()
    const { copy: recoveryCopy, hint: backupCodesHint } =
      recoveryCopyObservation.authenticationRecoveryEvidence()
    const enrollmentHints =
      authenticatorEnrollmentInteraction.detectEnrollmentHintsFromRecoveryCopy(
        recoveryCopy,
      )
    enrollmentHints.backupCodes = backupCodesHint === 'present'
    const companionPoliciesRequest: Parameters<
      typeof passwordFormInteraction.prepareCompanionWorkflowPolicies
    >[0] = {
      authenticatorSetupHint: enrollmentHints.qr,
      backupCodesHint: enrollmentHints.backupCodes,
    }
    await passwordFormInteraction.prepareCompanionWorkflowPolicies(
      companionPoliciesRequest,
    )
    const workflowForms = passwordFormInteraction
      .summarizeAuthenticationWorkflowForms()
      .slice(0, MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS)
    const workflowFormsDiagnostic: AuthenticationDiagnosticObservation = {
      gate: AuthenticationDiagnosticGate.WorkflowFormDiscovery,
      outcome:
        workflowForms.length === 0
          ? AuthenticationDiagnosticGateOutcome.Empty
          : AuthenticationDiagnosticGateOutcome.CandidatesFound,
      candidateCount: workflowForms.length,
    }
    this.recordDiagnostic(workflowFormsDiagnostic)
    // Setup material starts an enrollment ceremony. Recovery hints remain part
    // of an active OTP challenge so Rust can keep code fill as the primary action,
    // while a direct backup-code-only page still exposes the save ceremony.
    if (
      (enrollmentHints.qr || enrollmentHints.backupCodes) &&
      workflowForms.length === 0
    ) {
      const enrollmentMatchDelivery =
        await authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage({
          type: CompanionWasmSessionMessageType.AuthenticationEnrollmentWorkflowMatch,
          payload: {
            authenticatorSetupHint: enrollmentHints.qr,
            backupCodesCopy: recoveryCopy,
            manualCheckpointPresent:
              passwordFieldDiscovery.pageHasManualCheckpoint(document),
          },
        })
      if (
        enrollmentMatchDelivery.kind ===
          RuntimeMessageDeliveryKind.Unavailable ||
        typeof enrollmentMatchDelivery.response !== 'object' ||
        !('kind' in enrollmentMatchDelivery.response)
      ) {
        removeScannedWidget()
        return AuthenticationScanOutcome.Removed
      }
      const enrollmentMatch = enrollmentMatchDelivery.response
      if (enrollmentMatch.kind !== 'matched') {
        const diagnostic: AuthenticationDiagnosticObservation = {
          gate: AuthenticationDiagnosticGate.RustAdmission,
          outcome: AuthenticationDiagnosticGateOutcome.Rejected,
          candidateCount: 0,
        }
        this.recordDiagnostic(diagnostic)
        removeScannedWidget()
        return AuthenticationScanOutcome.Removed
      }
      const enrollmentCapability =
        await authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage({
          type: CompanionWasmSessionMessageType.AuthenticationWorkflowPilotPresentationCapability,
          payload: { snapshot: enrollmentMatch.snapshot },
        })
      if (
        enrollmentCapability.kind === RuntimeMessageDeliveryKind.Unavailable ||
        enrollmentCapability.response !== 'propose-action'
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
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.WidgetRendering,
        outcome: AuthenticationDiagnosticGateOutcome.Rendered,
        candidateCount: 0,
      }
      this.recordDiagnostic(diagnostic)
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
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.Scan,
        outcome: AuthenticationDiagnosticGateOutcome.Skipped,
        candidateCount: workflowForms.length,
      }
      this.recordDiagnostic(diagnostic)
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
    const classifiedDiagnostic: AuthenticationDiagnosticObservation = {
      gate: AuthenticationDiagnosticGate.WorkflowClassification,
      outcome:
        classifiedWorkflows.length === 0
          ? AuthenticationDiagnosticGateOutcome.Empty
          : AuthenticationDiagnosticGateOutcome.CandidatesFound,
      candidateCount: classifiedWorkflows.length,
    }
    this.recordDiagnostic(classifiedDiagnostic)
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
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.RuntimeTransport,
        outcome: AuthenticationDiagnosticGateOutcome.Unavailable,
        candidateCount: classifiedWorkflows.length,
      }
      this.recordDiagnostic(diagnostic)
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
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.RustAdmission,
        outcome: AuthenticationDiagnosticGateOutcome.Rejected,
        candidateCount: classifiedWorkflows.length,
      }
      this.recordDiagnostic(diagnostic)
      removeScannedWidget()
      return AuthenticationScanOutcome.Removed
    }
    const { snapshot } = verdict
    const selected = classifiedWorkflows[snapshot.observationIndex]
    if (response.pilotCapability === 'hidden') {
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.RustAdmission,
        outcome: AuthenticationDiagnosticGateOutcome.Hidden,
        candidateCount: classifiedWorkflows.length,
      }
      this.recordDiagnostic(diagnostic)
      removeScannedWidget()
      return AuthenticationScanOutcome.Removed
    }
    if (!selected) {
      const diagnostic: AuthenticationDiagnosticObservation = {
        gate: AuthenticationDiagnosticGate.RustAdmission,
        outcome: AuthenticationDiagnosticGateOutcome.Missing,
        candidateCount: classifiedWorkflows.length,
      }
      this.recordDiagnostic(diagnostic)
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
      factsBindingToken: response.factsBindingToken,
      savedLoginActionAvailable: response.savedLoginActionAvailable,
    }
    await authenticationWidgetRenderer.renderWidget(nookTypedArgs0_1)
    const diagnostic: AuthenticationDiagnosticObservation = {
      gate: AuthenticationDiagnosticGate.WidgetRendering,
      outcome: AuthenticationDiagnosticGateOutcome.Rendered,
      candidateCount: classifiedWorkflows.length,
    }
    this.recordDiagnostic(diagnostic)
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
    this.request.scanState.invalidatePendingScan()
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

  handleAuthenticationControlActivation(event: Event): void {
    const { target } = event
    const mountedHost =
      widgetState.host.kind === WidgetHostKind.Attached
        ? widgetState.host.mountedElement
        : false
    const renderedWorkflow =
      widgetState.renderedWorkflowRoot.kind === WidgetWorkflowRootKind.Assigned
        ? widgetState.renderedWorkflowRoot.observation
        : false
    if (!renderedWorkflow || !(target instanceof Element)) return
    const control = target.closest(
      'a[href], button, input[type="submit"], input[type="button"], [role="button"]',
    )
    if (!(control instanceof HTMLElement)) return
    const boundary =
      authenticationSurfaceObservation.authenticationWorkflowBoundary(
        renderedWorkflow,
      )
    const dispositionRequest: Parameters<
      typeof authenticationControlActivationDisposition
    >[0] = {
      controlTouchesRenderedWorkflow:
        boundary instanceof Node && boundary.contains(control),
      controlBelongsToMountedWidget: authenticationWidgetOwnsControl({
        lightTreeContainsControl: Boolean(
          mountedHost && mountedHost.contains(control),
        ),
        shadowTreeContainsControl: Boolean(
          mountedHost && event.composedPath().includes(mountedHost),
        ),
      }),
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

const authenticationDiagnosticChannelRequest = {
  availability: __NOOK_EXTENSION_DIAGNOSTICS_ENABLED__
    ? AuthenticationDiagnosticAvailability.Enabled
    : AuthenticationDiagnosticAvailability.Disabled,
  sink: new BrowserConsoleAuthenticationDiagnosticSink(),
}
const authenticationDiagnosticChannel = new AuthenticationDiagnosticChannel(
  authenticationDiagnosticChannelRequest,
)
if (__NOOK_EXTENSION_DIAGNOSTICS_ENABLED__) {
  passwordFieldDiscovery.setWorkflowScopeDiagnosticSink(
    authenticationDiagnosticChannel,
  )
  passwordFieldDiscovery.setFieldCandidateDiagnosticSink(
    authenticationDiagnosticChannel,
  )
  passwordFieldDiscovery.setSelectorEntryDiagnosticSink(
    authenticationDiagnosticChannel,
  )
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

void runAfterCompanionWasmReady({
  companionWasmReady,
  start: async () => {
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
          event,
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
        !authenticationRouteBrowser.isAuthenticationRouteHistoryMessage(
          event,
        ) &&
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
  },
})
