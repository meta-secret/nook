import { LoginSaveNavigationMode, LoginSaveOutcomeSensor, type LoginSaveOutcomeSensorRequest } from './login-save-outcome-sensor'
import {
  authenticationOutcomeObservation,
  AuthenticationOutcomeReadKind,
  type AuthenticationOutcomeObservationContext,
} from './authentication-outcome-observation'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'
import type { LoginCredentials } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  LoginCredentialsLookupKind,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  AuthenticationWorkflowActivity,
  type AuthenticationDisplayProgress,
  AuthenticationOutcomeVerdict,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { Effect, Schema } from 'effect'
import {
  CompanionWasmSessionMessageType,
  CompanionWasmActivityProgressDecoder,
  type CompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'
import { AuthenticationGesture } from '../../lib/auth-widget-policy'
import {
  NookWebsiteLoginSaveDecision,
  WebsiteLoginSaveCommitMessageType,
  WebsiteLoginSaveDismissMessageType,
  WebsiteLoginSaveOfferMessageType,
  WebsiteLoginSavePendingMessageType,
  type WebsiteLoginSaveOfferView,
} from '../../lib/login-save-messages'
import {
  RuntimeMessageDeliveryKind,
  authenticationRuntimeTransport,
} from './login-passkey-actions'
import {
  SaveOfferDisplayKind,
  SavePageWatchKind,
  WidgetPlacementKind,
  saveOfferState,
  scanState,
  widgetState,
  type PendingSaveWatch,
} from './state'
import {
  PointerDragBehaviorKind,
  authenticationWidgetPosition,
} from './widget-position'
import { authenticationWidgetShell } from './widget-shell'
import { LoginSubmissionCapture, type CapturedLoginSubmission, type LoginSubmissionCaptureRuntime } from './login-submission-capture'
import type { LoginSubmissionDomSnapshot } from './login-submission-dom-sensor'
import {
  OUTCOME_EVIDENCE_POLL_MS,
  OUTCOME_EVIDENCE_TIMEOUT_MS,
  WIDGET_HOST_ID,
  workflowUi,
} from './workflow-ui'

type StageSaveOfferRequest = {
  credentials: LoginCredentials
  snapshot: LoginSubmissionDomSnapshot
}
type PendingSaveSensorRequest = {offer: WebsiteLoginSaveOfferView; sensor: LoginSaveOutcomeSensor}
type FreshSaveEvidence = Awaited<ReturnType<LoginSaveOutcomeSensor['collect']>>

export enum PendingSaveOfferLoadKind {
  Absent = 'absent',
  Loaded = 'loaded',
}

export type PendingSaveOfferLoad =
  | { kind: PendingSaveOfferLoadKind.Absent }
  | { kind: PendingSaveOfferLoadKind.Loaded; offer: WebsiteLoginSaveOfferView }

/** Owns the browser runtime resources shared by these interactions. */
class LoginSaveInteraction {
  private readonly offerSensors = new Map<string, LoginSaveOutcomeSensor>()
  private pendingSaveOfferRequests = new Set<Promise<void>>()
  private readonly captureRuntime: LoginSubmissionCaptureRuntime = {stage: this.stageSubmittedLogin.bind(this)}
  private readonly submissionCapture = new LoginSubmissionCapture(this.captureRuntime)

  readonly captureSubmissionIntent = (event: Event): void => {
    const capture = this.submissionCapture.captureEffect(event)
    Effect.runFork(capture.pipe(Effect.catchTag('LoginSubmissionCaptureFailure', () => Effect.sync(() => this.presentSubmissionFailure()))))
  }
  captureSubmission(event: Event): Promise<void> {return this.submissionCapture.capture(event)}

  private presentSubmissionFailure(): void {
    const description = document.getElementById(WIDGET_HOST_ID)?.shadowRoot?.querySelector<HTMLParagraphElement>('.description')
    switch (true) {
      case description instanceof HTMLParagraphElement:
        description.textContent = workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetSaveLoginFailed)
        break
      case true: break
    }
  }

  rememberSubmissionPasswordFields(): void {
    this.submissionCapture.sensor.rememberPasswordFields()
  }

  rememberSubmissionPasswordMutations(mutations: readonly MutationRecord[]): void {this.submissionCapture.sensor.rememberPasswordMutations(mutations)}

  enableSubmissionCapture(): void { this.submissionCapture.enable() }
  discardSubmissionCapture(): void { this.submissionCapture.discard() }

  private stageSubmittedLogin({ snapshot }: CapturedLoginSubmission): Promise<void> {
    let credentials: LoginCredentials = {username: '', password: ''}
    switch (snapshot.explicitCredentials.kind) {
      case LoginCredentialsLookupKind.Absent: break
      case LoginCredentialsLookupKind.Found: credentials = {...snapshot.explicitCredentials.credentials}; break
    }
    const request: StageSaveOfferRequest = {credentials, snapshot}
    return this.trackSaveOffer(request)
  }
  stopPendingSaveWatch(): void {
    if (saveOfferState.watch.kind === SavePageWatchKind.Idle) return
    const { watch } = saveOfferState.watch
    if ('timer' in watch) {
      window.clearInterval(watch.timer)
    }
    watch.observer?.disconnect()
    saveOfferState.clearPendingWatch()
  }

  private async dismissSaveOffer(
    offer: WebsiteLoginSaveOfferView,
  ): Promise<void> {
    saveOfferState.dismissedOfferIds.add(offer.offerId)
    this.offerSensors.delete(offer.offerId)
    const message: Parameters<
      typeof authenticationRuntimeTransport.sendLoginSaveActionRuntimeMessage
    >[0] = {
      type: WebsiteLoginSaveDismissMessageType.NookWebsiteLoginSaveDismiss,
      payload: { origin: location.origin, offerId: offer.offerId },
    }
    const delivery =
      await authenticationRuntimeTransport.sendLoginSaveActionRuntimeMessage(
        message,
      )
    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      delivery.response.kind !== 'completed'
    ) {
      throw new Error('login save dismissal failed')
    }
  }

  async dismissPendingSaveOffer(): Promise<void> {
    await Promise.all([...this.pendingSaveOfferRequests])
    let offer: WebsiteLoginSaveOfferView | false = false
    if (saveOfferState.watch.kind === SavePageWatchKind.Watching) {
      offer = saveOfferState.watch.watch.offer
    } else if (saveOfferState.display.kind === SaveOfferDisplayKind.Visible) {
      offer = saveOfferState.display.offer
    }
    this.stopPendingSaveWatch()
    saveOfferState.clearActiveOffer()
    if (!offer) return
    await this.dismissSaveOffer(offer)
  }

  async evaluatePendingSaveEvidence(): Promise<void> {
    if (saveOfferState.watch.kind === SavePageWatchKind.Idle) return
    const { watch } = saveOfferState.watch
    const evidence = await watch.sensor.collect()
    switch (evidence.kind) {
      case 'SubmittedLogin': {
        const decision = await watch.sensor.eligibility(evidence)
        switch (saveOfferState.watch.kind === SavePageWatchKind.Watching && saveOfferState.watch.watch === watch) {
          case false: return
          case true: break
        }
        switch (decision.eligibility) {
          case 'Eligible':
            this.stopPendingSaveWatch()
            widgetState.dismissed = false
            saveOfferState.showOffer(watch.offer)
            await this.renderSaveOfferWidget(watch.offer)
            return
          case 'Rejected':
          case 'Expired':
            this.stopPendingSaveWatch()
            await this.dismissSaveOffer(watch.offer)
            return
          case 'Waiting': return
        }
        break
      }
      case 'ExplicitAuthentication': break
    }
    const observationContext:
 AuthenticationOutcomeObservationContext = {
      startedAt: watch.startedAt,
      authPath: watch.authPath,
      sawMutation: watch.sawMutation,
    }
    const observation =
      authenticationOutcomeObservation.collectOutcomeObservation(
        observationContext,
      )
    const verdictRead =
      await authenticationOutcomeObservation.classifyOutcomeEvidence(
        observation,
      )
    if (
      verdictRead.kind === AuthenticationOutcomeReadKind.Unavailable ||
      saveOfferState.watch.kind !== SavePageWatchKind.Watching ||
      saveOfferState.watch.watch.offer.offerId !== watch.offer.offerId
    ) {
      return
    }
    const { verdict } = verdictRead
    if (verdict.allowsCredentialCommit) {
      this.stopPendingSaveWatch()
      if (saveOfferState.dismissedOfferIds.has(watch.offer.offerId)) return
      widgetState.dismissed = false
      saveOfferState.showOffer(watch.offer)
      await this.renderSaveOfferWidget(watch.offer)
      return
    }
    if (
      verdict.verdict === AuthenticationOutcomeVerdict.Conflicting ||
      verdict.verdict === AuthenticationOutcomeVerdict.Timeout ||
      (verdict.verdict === AuthenticationOutcomeVerdict.Insufficient &&
        observation.errorMarkerPresent)
    ) {
      this.stopPendingSaveWatch()
      const message: Parameters<
        typeof authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse
      >[0] = {
        type: WebsiteLoginSaveDismissMessageType.NookWebsiteLoginSaveDismiss,
        payload: { origin: location.origin, offerId: watch.offer.offerId },
      }
      authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse(message)
    }
  }

  beginPendingSaveWatch(offer: WebsiteLoginSaveOfferView): void {
    const sensorRequest: LoginSaveOutcomeSensorRequest = { baseline: offer.baseline, submittedNodes: [], navigationMode: LoginSaveNavigationMode.DocumentNavigation }
    const request: PendingSaveSensorRequest = { offer, sensor: new LoginSaveOutcomeSensor(sensorRequest) }
    this.beginPendingSaveWatchWithSensor(request)
  }

  private beginPendingSaveWatchWithSensor({offer, sensor}: PendingSaveSensorRequest): void {
    this.stopPendingSaveWatch()
    this.offerSensors.clear()
    this.offerSensors.set(offer.offerId, sensor)
    const startedAt = offer.baseline.submitted_at
    const authPath = new URL(offer.baseline.submitted_url).pathname
    const watch: PendingSaveWatch = {
      offer,
      sensor,
      startedAt,
      authPath,
      sawMutation: false,
    }
    watch.observer = new MutationObserver(() => {
      if (saveOfferState.watch.kind === SavePageWatchKind.Idle) return
      saveOfferState.watch.watch.sawMutation = true
      sensor.sawMutation = true
      void this.evaluatePendingSaveEvidence()
    })
    const nookTypedArgs0_2: Parameters<typeof watch.observer.observe>[1] = {
      childList: true,
      subtree: true,
      attributes: true,
    }
    watch.observer.observe(document.documentElement, nookTypedArgs0_2)
    watch.timer = window.setInterval(() => {
      void this.evaluatePendingSaveEvidence()
    }, OUTCOME_EVIDENCE_POLL_MS)
    saveOfferState.watchPage(watch)
    void this.evaluatePendingSaveEvidence()
  }

  private trackSaveOffer(stageRequest: StageSaveOfferRequest): Promise<void> {

    const operation = this.stageSaveOfferForCredentials(stageRequest)
    const trackedOperation = operation.finally(() => {
      this.pendingSaveOfferRequests.delete(trackedOperation)
    })
    this.pendingSaveOfferRequests.add(trackedOperation)
    return trackedOperation
  }

  private async stageSaveOfferForCredentials({
    credentials, snapshot,
  }: StageSaveOfferRequest): Promise<void> {
    const message: Parameters<
      typeof authenticationRuntimeTransport.sendLoginSaveOfferRuntimeMessage
    >[0] = {
      type: WebsiteLoginSaveOfferMessageType.NookWebsiteLoginSaveOffer,
      payload: {
        origin: location.origin,
        username: credentials.username,
        password: credentials.password,
        capture: snapshot.captureRecord(),
        capturedValues: snapshot.capturedValues(),
      },
    }
    const delivery =
      await authenticationRuntimeTransport.sendLoginSaveOfferRuntimeMessage(
        message,
      ).finally(() => {
        credentials.password = ''; credentials.username = ''; message.payload.password = ''; message.payload.username = ''; message.payload.capturedValues.fill('')
      })
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      return
    }
    const { response } = delivery
    switch (response.kind) {
      case 'not-required': {
        const display = saveOfferState.display
        this.stopPendingSaveWatch()
        this.offerSensors.clear()
        switch (display.kind) {
          case SaveOfferDisplayKind.Visible: workflowUi.removeWidget(); break
          case SaveOfferDisplayKind.Hidden: saveOfferState.clearActiveOffer(); break
        }
        return
      }
      case 'locked': case 'rejected': case 'unavailable': return
      case 'offer-available': break
    }
    const { offer } = response
    if (saveOfferState.dismissedOfferIds.has(offer.offerId)) return
    let submittedNodes: HTMLInputElement[] = []
    switch (offer.selection.kind) {
      case 'ExplicitAuthentication': break
      case 'SubmittedLogin': {
        const indices: Parameters<typeof snapshot.credentialNodes>[0] = {usernameIndex: offer.selection.username_field_index.value, passwordIndex: offer.selection.password_field_index.value}
        submittedNodes = snapshot.credentialNodes(indices)
        break
      }
    }

    const sensorRequest: LoginSaveOutcomeSensorRequest = { baseline: offer.baseline, submittedNodes, navigationMode: LoginSaveNavigationMode.SameDocument }
    const sensor = new LoginSaveOutcomeSensor(sensorRequest)
    sensor.sawMutation = snapshot.mutationOccurred()
    const watchRequest: {offer: WebsiteLoginSaveOfferView; sensor: LoginSaveOutcomeSensor} = {offer, sensor}
    this.beginPendingSaveWatchWithSensor(watchRequest)
  }

  async loadPendingSaveOffer(): Promise<PendingSaveOfferLoad> {
    const recoveryStartedAt = Date.now()
    for (;;) {
      const message: Parameters<
        typeof authenticationRuntimeTransport.sendLoginSavePendingRuntimeMessage
      >[0] = {
        type: WebsiteLoginSavePendingMessageType.NookWebsiteLoginSavePending,
        payload: { origin: location.origin },
      }
      const delivery =
        await authenticationRuntimeTransport.sendLoginSavePendingRuntimeMessage(
          message,
        )
      if (
        delivery.kind === RuntimeMessageDeliveryKind.Delivered &&
        delivery.response.ok &&
        'state' in delivery.response &&
        delivery.response.state === 'available' &&
        'offer' in delivery.response
      ) {
        const { offer } = delivery.response
        if (saveOfferState.dismissedOfferIds.has(offer.offerId)) {
          return { kind: PendingSaveOfferLoadKind.Absent }
        }
        return { kind: PendingSaveOfferLoadKind.Loaded, offer }
      }
      if (
        delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
        !delivery.response.ok ||
        !('state' in delivery.response) ||
        delivery.response.state !== 'unavailable' ||
        passwordFormInteraction.summarizeAuthenticationWorkflowForms().some((form) => form.summary.passwordFieldCount > 0 || form.summary.usernameFieldCount > 0 || form.summary.oneTimeCodeFieldCount > 0) ||
        Date.now() - recoveryStartedAt >= OUTCOME_EVIDENCE_TIMEOUT_MS
      ) {
        return { kind: PendingSaveOfferLoadKind.Absent }
      }
      await this.waitForPendingSaveOffer()
    }
  }

  private waitForPendingSaveOffer(): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, OUTCOME_EVIDENCE_POLL_MS)
    })
  }

  private async freshSaveEvidence(offer: WebsiteLoginSaveOfferView): Promise<FreshSaveEvidence> {
    const sensor = this.offerSensors.get(offer.offerId)
    switch (true) {case typeof sensor === 'object': break; case true: default: throw new Error('login save baseline unavailable')}
    const evidence = await sensor.collect()
    switch (evidence.kind) {
      case 'SubmittedLogin': {
        const decision = await sensor.eligibility(evidence)
        switch (decision.eligibility) {case 'Eligible': break; case 'Waiting': case 'Rejected': case 'Expired': throw new Error('login save no longer eligible')}
        break
      }
      case 'ExplicitAuthentication': await authenticationOutcomeObservation.prepareOutcomeNavigationPath(evidence.observation); break
    }
    return evidence
  }

  async renderSaveOfferWidget(
    offer: WebsiteLoginSaveOfferView,
  ): Promise<boolean> {
    const sequence = scanState.sequence
    const currentDisplay = saveOfferState.display
    if (
      currentDisplay.kind !== SaveOfferDisplayKind.Visible ||
      currentDisplay.offer !== offer ||
      saveOfferState.dismissedOfferIds.has(offer.offerId)
    )
      return false
    const request: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.GetAuthenticationActivityProgress,
      origin: location.origin,
      payload: { activity: AuthenticationWorkflowActivity.SaveOffer },
    }
    let activityProgress: AuthenticationDisplayProgress
    try {
      const delivery = await sendCompanionWasmRuntimeMessage(
        globalThis,
        request,
      )
      if (delivery.kind !== CompanionWasmRuntimeDeliveryKind.Delivered)
        return false
      activityProgress = Schema.decodeUnknownSync(
        CompanionWasmActivityProgressDecoder,
      )(delivery.response).activityProgress
    } catch {
      return false
    }
    const display = saveOfferState.display
    if (
      sequence !== scanState.sequence ||
      display.kind !== SaveOfferDisplayKind.Visible ||
      display.offer !== offer ||
      display.offer.offerId !== offer.offerId ||
      saveOfferState.dismissedOfferIds.has(offer.offerId)
    )
      return false
    workflowUi.removeWidget()
    saveOfferState.showOffer(offer)
    const host = document.createElement('div')
    host.id = WIDGET_HOST_ID
    host.setAttribute('data-testid', 'nook-auth-widget')
    host.setAttribute('role', 'dialog')
    host.setAttribute(
      'aria-label',
      workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetPilotLabel),
    )
    host.setAttribute('aria-expanded', 'true')
    const nookTypedArgs0_5: Parameters<typeof host.attachShadow>[0] = {
      mode: 'open',
    }
    const shadow = host.attachShadow(nookTypedArgs0_5)

    const panel = document.createElement('div')
    panel.className = 'panel'
    panel.setAttribute('data-testid', 'nook-auth-gate')

    const toolbar = document.createElement('div')
    toolbar.className = 'toolbar'
    toolbar.setAttribute('data-testid', 'nook-auth-gate-drag')

    const step = document.createElement('p')
    step.className = 'step-label'
    const nookTypedArgs0_2: Parameters<typeof workflowUi.progressLabel>[0] = {
      ...activityProgress,
    }
    step.textContent = workflowUi.progressLabel(nookTypedArgs0_2)

    const dismissButton = document.createElement('button')
    dismissButton.type = 'button'
    dismissButton.className = 'icon-button dismiss-button'
    dismissButton.textContent = '×'
    dismissButton.setAttribute(
      'aria-label',
      workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetDismiss),
    )
    dismissButton.addEventListener('click', () => {
      saveOfferState.dismissedOfferIds.add(offer.offerId)
      this.offerSensors.delete(offer.offerId)
      const message: Parameters<
        typeof authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse
      >[0] = {
        type: WebsiteLoginSaveDismissMessageType.NookWebsiteLoginSaveDismiss,
        payload: { origin: location.origin, offerId: offer.offerId },
      }
      authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse(message)
      widgetState.dismissed = true
      workflowUi.removeWidget()
    })
    toolbar.append(step, dismissButton)

    const body = document.createElement('div')
    body.className = 'body'

    const nookTypedArgs0_3: Parameters<
      typeof authenticationWidgetShell.createWidgetMark
    >[0] = {
      className: 'mark',
      size: 52,
    }
    const mark = authenticationWidgetShell.createWidgetMark(nookTypedArgs0_3)

    const title = document.createElement('h1')
    title.textContent = workflowUi.translatedMessage(
      offer.decision === NookWebsiteLoginSaveDecision.Update
        ? BROWSER_MESSAGE_KEYS.WidgetUpdateLoginTitle
        : BROWSER_MESSAGE_KEYS.WidgetSaveLoginTitle,
    )

    const site = document.createElement('p')
    site.className = 'site-context'
    site.textContent = location.hostname

    const description = document.createElement('p')
    description.className = 'description'
    description.textContent = workflowUi.translatedMessage(
      offer.decision === NookWebsiteLoginSaveDecision.Update
        ? BROWSER_MESSAGE_KEYS.WidgetUpdateLoginDescription
        : BROWSER_MESSAGE_KEYS.WidgetSaveLoginDescription,
    )
    description.setAttribute('data-testid', 'nook-auth-gate-save-description')

    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.className = 'primary-button'
    saveButton.setAttribute('data-testid', 'nook-auth-gate-save')
    saveButton.textContent = workflowUi.translatedMessage(
      offer.decision === NookWebsiteLoginSaveDecision.Update
        ? BROWSER_MESSAGE_KEYS.WidgetUpdateLogin
        : BROWSER_MESSAGE_KEYS.WidgetSaveLogin,
    )
    saveButton.addEventListener('click', (event) => {
      if (!new AuthenticationGesture(event).trusted || widgetState.busy) return
      widgetState.busy = true
      saveButton.disabled = true
      Effect.runFork(
        Effect.tryPromise(async () => {
          const evidence = await this.freshSaveEvidence(offer)
          const message: Parameters<
            typeof authenticationRuntimeTransport.sendLoginSaveActionRuntimeMessage
          >[0] = {
            type: WebsiteLoginSaveCommitMessageType.NookWebsiteLoginSaveCommit,
            payload: {
              origin: location.origin,
              offerId: offer.offerId,
              evidence,
            },
          }
          await authenticationRuntimeTransport
            .sendLoginSaveActionRuntimeMessage(message)
            .then((delivery) => {
              if (
                delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
                delivery.response.kind !== 'completed'
              ) {
                description.textContent = workflowUi.translatedMessage(
                  BROWSER_MESSAGE_KEYS.WidgetSaveLoginFailed,
                )
                saveButton.disabled = false
                return
              }
              title.textContent = workflowUi.translatedMessage(
                BROWSER_MESSAGE_KEYS.WidgetSaveLoginSavedTitle,
              )
              title.setAttribute('data-testid', 'nook-auth-gate-save-saved')
              description.textContent = workflowUi.translatedMessage(
                BROWSER_MESSAGE_KEYS.WidgetSaveLoginSavedDescription,
              )
              saveButton.hidden = true
              notNowButton.hidden = true
              saveOfferState.clearActiveOffer()
              this.offerSensors.delete(offer.offerId)
              // Hold confirmation through the dismiss window so formless success
              // pages cannot scan-away "Login saved" before the user sees it.
              saveOfferState.confirmationActive = true
              window.setTimeout(() => {
                widgetState.dismissed = false
                workflowUi.removeWidget()
                scanState.schedule()
              }, 1200)
            })
            .finally(() => {
              widgetState.busy = false
            })
        }).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              description.textContent = workflowUi.translatedMessage(
                BROWSER_MESSAGE_KEYS.WidgetSaveLoginFailed,
              )
              saveButton.disabled = false
              widgetState.busy = false
            }),
          ),
        ),
      )
    })

    const notNowButton = document.createElement('button')
    notNowButton.type = 'button'
    notNowButton.className = 'text-button'
    notNowButton.setAttribute('data-testid', 'nook-auth-gate-save-dismiss')
    notNowButton.textContent = workflowUi.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetSaveLoginNotNow,
    )
    notNowButton.addEventListener('click', (event) => {
      if (!new AuthenticationGesture(event).trusted) return
      saveOfferState.dismissedOfferIds.add(offer.offerId)
      const message: Parameters<
        typeof authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse
      >[0] = {
        type: WebsiteLoginSaveDismissMessageType.NookWebsiteLoginSaveDismiss,
        payload: { origin: location.origin, offerId: offer.offerId },
      }
      authenticationRuntimeTransport.sendRuntimeMessageWithoutResponse(message)
      widgetState.dismissed = true
      workflowUi.removeWidget()
    })

    body.append(mark, site, title, description, saveButton, notNowButton)

    const style = document.createElement('style')
    style.textContent = `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      top: 18px;
      right: 18px;
      color-scheme: dark;
    }
    :host(.dragging) {
      cursor: grabbing;
      user-select: none;
    }
    [hidden] { display: none !important; }
    .panel {
      width: min(292px, calc(100vw - 24px));
      border: 1px solid rgb(255 255 255 / 10%);
      border-radius: 18px;
      background: oklch(0.21 0.006 285.885);
      box-shadow: 0 18px 48px rgb(0 0 0 / 35%);
      color: oklch(0.985 0 0);
      font: 400 13px/1.35 Inter, ui-sans-serif, system-ui, sans-serif;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 0;
      cursor: grab;
    }
    .step-label {
      flex: 1;
      margin: 0;
      color: oklch(0.705 0.015 286.067);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .icon-button {
      appearance: none;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: oklch(0.705 0.015 286.067);
      cursor: pointer;
      font: 700 16px/1 Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .body {
      display: grid;
      gap: 10px;
      padding: 8px 18px 18px;
      justify-items: center;
      text-align: center;
    }
    .mark { display: block; }
    .site-context {
      margin: 0;
      color: oklch(0.705 0.015 286.067);
      font-size: 12px;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 750;
      letter-spacing: -0.02em;
    }
    .description {
      margin: 0;
      color: oklch(0.85 0.01 286);
      line-height: 1.4;
    }
    button.primary-button {
      appearance: none;
      width: 100%;
      min-height: 40px;
      border-radius: 9px;
      border: 1px solid transparent;
      background: oklch(0.92 0.004 286.32);
      color: oklch(0.21 0.006 285.885);
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      padding: 9px 12px;
    }
    button.primary-button:hover:not(:disabled) {
      background: color-mix(in oklab, oklch(0.92 0.004 286.32) 90%, black);
    }
    button:disabled { cursor: wait; opacity: 0.68; }
    .text-button {
      appearance: none;
      width: fit-content;
      margin: -4px auto 0;
      padding: 4px 8px;
      border: 0;
      background: transparent;
      color: oklch(0.705 0.015 286.067);
      cursor: pointer;
      font: 650 12px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .text-button:hover { color: oklch(0.985 0 0); }
  `

    panel.append(toolbar, body)
    shadow.append(style, panel)
    document.documentElement.append(host)
    widgetState.attachHost(host)
    widgetState.assignWorkflowKey(`save:${offer.offerId}`)
    const pointerDragArgs: Parameters<
      typeof authenticationWidgetPosition.attachPointerDrag
    >[0] = {
      host,
      handle: toolbar,
      behavior: { kind: PointerDragBehaviorKind.DragOnly },
    }
    authenticationWidgetPosition.attachPointerDrag(pointerDragArgs)
    if (widgetState.placement.kind === WidgetPlacementKind.Positioned) {
      const nookTypedArgs0_6: Parameters<
        typeof authenticationWidgetPosition.applyWidgetPosition
      >[0] = {
        host,
        position: widgetState.placement.position,
      }
      authenticationWidgetPosition.applyWidgetPosition(nookTypedArgs0_6)
    }
    return true
  }
}

export const loginSaveInteraction = new LoginSaveInteraction()
