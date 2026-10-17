import type {
  SignInAttemptActionOffer,
  SignInAttemptActivity,
  SignInAttemptEvent,
  SignInAttemptLoginReference,
  SignInAttemptPresentation,
  SignInAttemptUserAction,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { FormSubmissionResult } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  SignInAttemptLinkTargetKind,
  signInAttemptEvidenceSensor,
  type SignInAttemptEvidenceSensor,
  type SignInAttemptLinkTarget,
} from './sign-in-attempt-evidence'
import {
  SignInAttemptDeliveryKind,
  SignInAttemptScope,
  signInAttemptTransport,
  type SignInAttemptDelivery,
  type SignInAttemptTransport,
} from './sign-in-attempt-transport'
import {
  SignInAttemptObservation,
  SignInAttemptObservationKind,
  type SignInAttemptObservationContext,
  type SignInAttemptSubmitCapture,
} from './sign-in-attempt-observation'
import { OUTCOME_EVIDENCE_POLL_MS } from './workflow-ui'

export enum SignInAttemptPhaseKind {
  /** No attempt for this tab and site: the normal fresh Pilot. */
  Fresh = 'fresh',
  Presented = 'presented',
  /** The attempt owner could not be reached; Pilot shows its manual state. */
  Unavailable = 'unavailable',
}
export type SignInAttemptPhase =
  | { readonly kind: SignInAttemptPhaseKind.Fresh }
  | {
      readonly kind: SignInAttemptPhaseKind.Presented
      readonly presentation: SignInAttemptPresentation
    }
  | { readonly kind: SignInAttemptPhaseKind.Unavailable }

/** Follow-ups that need a Pilot host's live form controls. */
export enum SignInAttemptHostActionKind {
  RestartWithSameLogin = 'restart-with-same-login',
  OpenLoginPicker = 'open-login-picker',
  OpenAuthenticatorPicker = 'open-authenticator-picker',
}
export type SignInAttemptHostAction =
  | {
      readonly kind: SignInAttemptHostActionKind.RestartWithSameLogin
      readonly login: SignInAttemptLoginReference
    }
  | { readonly kind: SignInAttemptHostActionKind.OpenLoginPicker }
  | { readonly kind: SignInAttemptHostActionKind.OpenAuthenticatorPicker }

/** A Pilot surface that renders the attempt and owns its page controls. */
export interface SignInAttemptHost {
  present(presentation: SignInAttemptPresentation): void
  /** The attempt ended through an explicit choice: show the normal fresh state. */
  release(): void
  /** The attempt owner is unreachable: show the existing manual state. */
  unavailable(): void
  /** Performs a follow-up; the host leaves the attempt presentation itself. */
  run(action: SignInAttemptHostAction): void
  disable(offer: SignInAttemptActionOffer): void
}

export enum SignInAttemptStartKind {
  Started = 'started',
  Unavailable = 'unavailable',
}

export type SignInAttemptBeginRequest = {
  readonly login: SignInAttemptLoginReference
  readonly host: SignInAttemptHost
}

enum SignInAttemptHostBindingKind {
  Detached = 'detached',
  Attached = 'attached',
}
type SignInAttemptHostBinding =
  | { readonly kind: SignInAttemptHostBindingKind.Detached }
  | {
      readonly kind: SignInAttemptHostBindingKind.Attached
      readonly host: SignInAttemptHost
    }
enum EvidenceWatchKind {
  Stopped = 'stopped',
  Watching = 'watching',
}
type EvidenceWatch =
  | { readonly kind: EvidenceWatchKind.Stopped }
  | {
      readonly kind: EvidenceWatchKind.Watching
      readonly timer: number
      readonly observer: MutationObserver
    }
enum EvidenceReport {
  Idle = 'idle',
  Sending = 'sending',
}
enum PendingResetKind {
  None = 'none',
  Chosen = 'chosen',
}
/** The exact element and link facts sent to Rust for revalidation. */
type PendingReset =
  | { readonly kind: PendingResetKind.None }
  | {
      readonly kind: PendingResetKind.Chosen
      readonly target: Extract<
        SignInAttemptLinkTarget,
        { readonly kind: SignInAttemptLinkTargetKind.Available }
      >
    }
type SignInAttemptChoice = {
  readonly offer: SignInAttemptActionOffer
  readonly action: SignInAttemptUserAction
}

export type SignInAttemptSessionDependencies = {
  readonly browser: typeof globalThis
  readonly transport: SignInAttemptTransport
  readonly sensor: SignInAttemptEvidenceSensor
}

/**
 * Thin page-side client of the service-worker attempt: it renders Rust's
 * presentation, reports activity and raw evidence, and performs the chosen
 * DOM action. It holds no state of record and decides nothing about the page.
 */
export class SignInAttemptSession {
  static readonly SUBMISSION_REJECTED: SignInAttemptActivity = {
    kind: 'SubmissionRejected',
  }
  static readonly SUBMISSION_UNOBSERVED: SignInAttemptActivity = {
    kind: 'SubmissionUnobserved',
  }
  static readonly OPEN_LOGIN_PICKER: SignInAttemptHostAction = {
    kind: SignInAttemptHostActionKind.OpenLoginPicker,
  }
  static readonly OPEN_AUTHENTICATOR_PICKER: SignInAttemptHostAction = {
    kind: SignInAttemptHostActionKind.OpenAuthenticatorPicker,
  }
  static readonly UNAVAILABLE: SignInAttemptDelivery = {
    kind: SignInAttemptDeliveryKind.Unavailable,
  }
  private phaseState: SignInAttemptPhase = {
    kind: SignInAttemptPhaseKind.Fresh,
  }
  private binding: SignInAttemptHostBinding = {
    kind: SignInAttemptHostBindingKind.Detached,
  }
  /** A new document until this document's own actuator reports the submit. */
  private observation: SignInAttemptObservationContext =
    SignInAttemptObservation.NEW_DOCUMENT
  private watch: EvidenceWatch = { kind: EvidenceWatchKind.Stopped }
  private report = EvidenceReport.Idle
  private pendingReset: PendingReset = { kind: PendingResetKind.None }
  private resumption: Promise<void> = Promise.resolve()

  constructor(
    private readonly dependencies: SignInAttemptSessionDependencies,
  ) {}

  get phase(): SignInAttemptPhase {
    return this.phaseState
  }

  scope(): SignInAttemptScope {
    return this.dependencies.transport.scope()
  }

  /**
   * Pilot mount on any top-level page: pick up this tab's attempt, if any.
   * When Rust wants this page's evidence, the first observation is reported
   * before anything renders, so the page shows Rust's verdict on this page
   * and never the resumed record's earlier presentation.
   */
  resume(): Promise<void> {
    switch (this.scope()) {
      case SignInAttemptScope.Frame:
        return this.resumption
      case SignInAttemptScope.TopDocument:
        break
    }
    this.resumption = this.resumeTopDocument()
    return this.resumption
  }

  /** Settles once this document's resume has; scans wait for it, start does not. */
  resumed(): Promise<void> {
    return this.resumption
  }

  /** Never rejects: a resume that cannot complete shows the unavailable state. */
  private async resumeTopDocument(): Promise<void> {
    try {
      const event: SignInAttemptEvent = { kind: 'Resumed' }
      const resumed = await this.dependencies.transport.advance(event)
      this.accept(await this.observedOnResume(resumed))
    } catch {
      this.accept(SignInAttemptSession.UNAVAILABLE)
    }
  }

  private async observedOnResume(
    resumed: SignInAttemptDelivery,
  ): Promise<SignInAttemptDelivery> {
    switch (resumed.kind) {
      case SignInAttemptDeliveryKind.Fresh:
      case SignInAttemptDeliveryKind.Unavailable:
        return resumed
      case SignInAttemptDeliveryKind.Presented:
        break
    }
    switch (resumed.presentation.page_evidence) {
      case 'NotWanted':
        return resumed
      case 'Wanted':
        break
    }
    const page = await this.dependencies.sensor.observe(this.observation)
    const observed: SignInAttemptEvent = { kind: 'PageObserved', page }
    return this.dependencies.transport.advance(observed)
  }

  attach(host: SignInAttemptHost): void {
    this.binding = { kind: SignInAttemptHostBindingKind.Attached, host }
    switch (this.phaseState.kind) {
      case SignInAttemptPhaseKind.Presented:
        host.present(this.phaseState.presentation)
        return
      case SignInAttemptPhaseKind.Unavailable:
        host.unavailable()
        return
      case SignInAttemptPhaseKind.Fresh:
        return
    }
  }

  detach(host: SignInAttemptHost): void {
    switch (
      this.binding.kind === SignInAttemptHostBindingKind.Attached &&
      this.binding.host === host
    ) {
      case true:
        this.binding = { kind: SignInAttemptHostBindingKind.Detached }
        return
      case false:
        return
    }
  }

  /** The user's explicit Sign in or picker choice begins one attempt. */
  async begin(
    request: SignInAttemptBeginRequest,
  ): Promise<SignInAttemptStartKind> {
    this.observation = SignInAttemptObservation.NEW_DOCUMENT
    this.pendingReset = { kind: PendingResetKind.None }
    this.binding = {
      kind: SignInAttemptHostBindingKind.Attached,
      host: request.host,
    }
    const delivery = await this.dependencies.transport.begin(request.login)
    switch (delivery.kind) {
      case SignInAttemptDeliveryKind.Presented:
        this.accept(delivery)
        return SignInAttemptStartKind.Started
      case SignInAttemptDeliveryKind.Fresh:
      case SignInAttemptDeliveryKind.Unavailable:
        return SignInAttemptStartKind.Unavailable
    }
  }

  /**
   * A top-level fill whose control no mounted login Pilot owns still begins
   * the tab's attempt; the next Pilot that mounts on this or the following
   * document attaches to it.
   */
  async beginDetached(
    login: SignInAttemptLoginReference,
  ): Promise<SignInAttemptStartKind> {
    this.observation = SignInAttemptObservation.NEW_DOCUMENT
    this.pendingReset = { kind: PendingResetKind.None }
    this.binding = { kind: SignInAttemptHostBindingKind.Detached }
    const delivery = await this.dependencies.transport.begin(login)
    switch (delivery.kind) {
      case SignInAttemptDeliveryKind.Presented:
        this.accept(delivery)
        return SignInAttemptStartKind.Started
      case SignInAttemptDeliveryKind.Fresh:
      case SignInAttemptDeliveryKind.Unavailable:
        return SignInAttemptStartKind.Unavailable
    }
  }

  activity(activity: SignInAttemptActivity): Promise<void> {
    const event: SignInAttemptEvent = { kind: 'Activity', activity }
    return this.advance(event)
  }

  /**
   * Reported with the baseline right before the actuator submits, so the
   * report leaves before a navigating document can unload.
   */
  submitting(capture: SignInAttemptSubmitCapture): Promise<void> {
    this.observation = {
      kind: SignInAttemptObservationKind.SameDocument,
      snapshot: capture.snapshot,
    }
    const activity: SignInAttemptActivity = {
      kind: 'Submitted',
      baseline: capture.baseline,
    }
    return this.activity(activity)
  }

  /** A submit the actuator could not perform or observe follows the Submitted report. */
  submission(result: FormSubmissionResult): Promise<void> {
    switch (result) {
      case FormSubmissionResult.Rejected:
        return this.activity(SignInAttemptSession.SUBMISSION_REJECTED)
      case FormSubmissionResult.NotObserved:
        return this.activity(SignInAttemptSession.SUBMISSION_UNOBSERVED)
      case FormSubmissionResult.Submitted:
        return Promise.resolve()
    }
  }

  /** The Pilot close button on a presented attempt is the explicit Dismiss. */
  close(): Promise<void> {
    this.binding = { kind: SignInAttemptHostBindingKind.Detached }
    switch (this.phaseState.kind) {
      case SignInAttemptPhaseKind.Fresh:
      case SignInAttemptPhaseKind.Unavailable:
        return Promise.resolve()
      case SignInAttemptPhaseKind.Presented:
        break
    }
    this.stopWatching()
    this.phaseState = { kind: SignInAttemptPhaseKind.Fresh }
    const event: SignInAttemptEvent = {
      kind: 'UserAction',
      action: { kind: 'Dismiss' },
    }
    return this.dependencies.transport.advance(event).then(() => {})
  }

  /** The 2FA Pilot shows the attempt's Verification needed copy while it is presented. */
  challenge(): SignInAttemptChallenge {
    switch (this.phaseState.kind) {
      case SignInAttemptPhaseKind.Fresh:
      case SignInAttemptPhaseKind.Unavailable:
        return { kind: SignInAttemptChallengeKind.Absent }
      case SignInAttemptPhaseKind.Presented:
        break
    }
    const presentation = this.phaseState.presentation
    switch (presentation.status) {
      case 'ChallengeRequired':
        return { kind: SignInAttemptChallengeKind.Presented, presentation }
      case 'SigningIn':
      case 'SignedIn':
      case 'Failed':
      case 'TimedOut':
      case 'Dismissed':
      case 'StepAdvanced':
      case 'WorkflowLeft':
        return { kind: SignInAttemptChallengeKind.Absent }
    }
  }

  /** Fill 2FA code on the existing 2FA Pilot resolves the challenge (Rust closes it). */
  handOffToAuthenticator(): Promise<void> {
    switch (this.challenge().kind) {
      case SignInAttemptChallengeKind.Absent:
        return Promise.resolve()
      case SignInAttemptChallengeKind.Presented:
        break
    }
    this.stopWatching()
    this.binding = { kind: SignInAttemptHostBindingKind.Detached }
    const event: SignInAttemptEvent = {
      kind: 'UserAction',
      action: { kind: 'FillAuthenticator' },
    }
    return this.advance(event)
  }

  async choose(offer: SignInAttemptActionOffer): Promise<void> {
    const action = this.userAction(offer)
    switch (action.kind) {
      case SignInAttemptChoiceKind.Unavailable:
        this.hostDisable(offer)
        return
      case SignInAttemptChoiceKind.Chosen:
        break
    }
    const choice: SignInAttemptChoice = { offer, action: action.action }
    const event: SignInAttemptEvent = {
      kind: 'UserAction',
      action: choice.action,
    }
    await this.advance(event)
  }

  private userAction(
    offer: SignInAttemptActionOffer,
  ): SignInAttemptChoiceResult {
    switch (offer.action) {
      case 'TryAgain':
      case 'ChooseAnotherLogin':
      case 'FillAuthenticator':
      case 'Dismiss':
        return {
          kind: SignInAttemptChoiceKind.Chosen,
          action: { kind: offer.action },
        }
      case 'ResetPassword':
        return this.resetPasswordAction()
    }
  }

  /** Fresh, revalidated link facts at click time; Rust reclassifies them. */
  private resetPasswordAction(): SignInAttemptChoiceResult {
    switch (this.phaseState.kind) {
      case SignInAttemptPhaseKind.Fresh:
      case SignInAttemptPhaseKind.Unavailable:
        return { kind: SignInAttemptChoiceKind.Unavailable }
      case SignInAttemptPhaseKind.Presented:
        break
    }
    const index = this.phaseState.presentation.reset_link
    switch (true) {
      case typeof index === 'number':
        return this.resetLinkAction(index)
      case true:
        break
    }
    return { kind: SignInAttemptChoiceKind.Unavailable }
  }

  /** Keeps the exact element and facts Rust is asked to revalidate. */
  private resetLinkAction(index: number): SignInAttemptChoiceResult {
    const target = this.dependencies.sensor.link(index)
    switch (target.kind) {
      case SignInAttemptLinkTargetKind.Unavailable:
        this.pendingReset = { kind: PendingResetKind.None }
        return { kind: SignInAttemptChoiceKind.Unavailable }
      case SignInAttemptLinkTargetKind.Available:
        this.pendingReset = { kind: PendingResetKind.Chosen, target }
        return {
          kind: SignInAttemptChoiceKind.Chosen,
          action: { kind: 'ResetPassword', link: target.link },
        }
    }
  }

  private async advance(event: SignInAttemptEvent): Promise<void> {
    this.accept(await this.dependencies.transport.advance(event))
  }

  private accept(delivery: SignInAttemptDelivery): void {
    switch (delivery.kind) {
      case SignInAttemptDeliveryKind.Unavailable:
        this.stopWatching()
        this.phaseState = { kind: SignInAttemptPhaseKind.Unavailable }
        this.hostUnavailable()
        return
      case SignInAttemptDeliveryKind.Fresh:
        this.stopWatching()
        this.phaseState = { kind: SignInAttemptPhaseKind.Fresh }
        this.hostRelease()
        return
      case SignInAttemptDeliveryKind.Presented:
        this.present(delivery.presentation)
        return
    }
  }

  private present(presentation: SignInAttemptPresentation): void {
    this.phaseState = { kind: SignInAttemptPhaseKind.Presented, presentation }
    this.updateWatch(presentation)
    this.follow(presentation)
  }

  /** Rust selects the follow-up; the page side only performs it. */
  private follow(presentation: SignInAttemptPresentation): void {
    const followUp = presentation.follow_up
    switch (followUp.kind) {
      case 'None':
        this.display(presentation)
        return
      case 'RestartWithSameLogin': {
        const restart: SignInAttemptHostAction = {
          kind: SignInAttemptHostActionKind.RestartWithSameLogin,
          login: followUp.login,
        }
        this.release(restart)
        return
      }
      case 'OpenLoginPicker':
        this.release(SignInAttemptSession.OPEN_LOGIN_PICKER)
        return
      case 'OpenAuthenticatorPicker':
        this.release(SignInAttemptSession.OPEN_AUTHENTICATOR_PICKER)
        return
      case 'ActivateResetLink':
        this.stopWatching()
        this.phaseState = { kind: SignInAttemptPhaseKind.Fresh }
        this.activateResetLink(followUp.link)
        return
    }
  }

  /**
   * A concluded dismissal or an advanced username step (checklist Ready)
   * returns the Pilot to its fresh state; a take-over dismissal (checklist
   * Inactive) stays visible. A left login workflow claims no outcome: the
   * fresh Pilot where the page has a login form, otherwise nothing.
   */
  private display(presentation: SignInAttemptPresentation): void {
    switch (presentation.status) {
      case 'Dismissed':
      case 'StepAdvanced':
        this.dismissed(presentation)
        return
      case 'WorkflowLeft':
        this.stopWatching()
        this.phaseState = { kind: SignInAttemptPhaseKind.Fresh }
        this.hostRelease()
        return
      case 'SigningIn':
      case 'SignedIn':
      case 'Failed':
      case 'ChallengeRequired':
      case 'TimedOut':
        this.hostPresent()
        return
    }
  }

  private dismissed(presentation: SignInAttemptPresentation): void {
    this.stopWatching()
    this.phaseState = { kind: SignInAttemptPhaseKind.Fresh }
    switch (presentation.checklist.status) {
      case 'Ready':
        this.hostRelease()
        return
      case 'Inactive':
      case 'Working':
      case 'Waiting':
      case 'Attention':
      case 'Complete':
        this.hostPresentation(presentation)
        return
    }
  }

  private hostPresentation(presentation: SignInAttemptPresentation): void {
    switch (this.binding.kind) {
      case SignInAttemptHostBindingKind.Detached:
        return
      case SignInAttemptHostBindingKind.Attached:
        this.binding.host.present(presentation)
    }
  }

  private release(action: SignInAttemptHostAction): void {
    this.stopWatching()
    this.phaseState = { kind: SignInAttemptPhaseKind.Fresh }
    switch (this.binding.kind) {
      case SignInAttemptHostBindingKind.Detached:
        return
      case SignInAttemptHostBindingKind.Attached:
        this.binding.host.run(action)
    }
  }

  /**
   * Clicks the very element whose facts Rust revalidated, and only while it
   * is connected, visible, at the same handle and with unchanged facts.
   */
  private activateResetLink(index: number): void {
    const pending = this.pendingReset
    this.pendingReset = { kind: PendingResetKind.None }
    switch (pending.kind) {
      case PendingResetKind.None:
        return
      case PendingResetKind.Chosen:
        break
    }
    // On any mismatch nothing is clicked or reported: the Pilot stays as it is.
    switch (
      pending.target.link.index === index &&
      this.dependencies.sensor.confirm(pending.target)
    ) {
      case true:
        this.hostRelease()
        pending.target.element.click()
        return
      case false:
        return
    }
  }

  private updateWatch(presentation: SignInAttemptPresentation): void {
    switch (presentation.page_evidence) {
      case 'NotWanted':
        this.stopWatching()
        return
      case 'Wanted':
        break
    }
    switch (this.watch.kind) {
      case EvidenceWatchKind.Watching:
        return
      case EvidenceWatchKind.Stopped:
        break
    }
    const browser = this.dependencies.browser
    const observer = new browser.MutationObserver(
      this.reportEvidence.bind(this),
    )
    const options: MutationObserverInit = {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    }
    observer.observe(browser.document.documentElement, options)
    const timer = browser.window.setInterval(
      this.reportEvidence.bind(this),
      OUTCOME_EVIDENCE_POLL_MS,
    )
    this.watch = { kind: EvidenceWatchKind.Watching, timer, observer }
    this.reportEvidence()
  }

  private stopWatching(): void {
    switch (this.watch.kind) {
      case EvidenceWatchKind.Stopped:
        return
      case EvidenceWatchKind.Watching:
        this.dependencies.browser.window.clearInterval(this.watch.timer)
        this.watch.observer.disconnect()
        this.watch = { kind: EvidenceWatchKind.Stopped }
    }
  }

  /** One evidence report in flight at a time; mutations and the timer coalesce. */
  private reportEvidence(): void {
    switch (this.report) {
      case EvidenceReport.Sending:
        return
      case EvidenceReport.Idle:
        break
    }
    this.report = EvidenceReport.Sending
    // A report that fails is retried on the next mutation or tick.
    const idle = () => {
      this.report = EvidenceReport.Idle
    }
    void this.observe().then(idle, idle)
  }

  /** A page that cannot be observed now is observed again on the next tick. */
  private async observe(): Promise<void> {
    const page = await this.dependencies.sensor.observe(this.observation)
    const event: SignInAttemptEvent = { kind: 'PageObserved', page }
    await this.advance(event)
  }

  private hostPresent(): void {
    switch (this.binding.kind) {
      case SignInAttemptHostBindingKind.Detached:
        return
      case SignInAttemptHostBindingKind.Attached:
        break
    }
    switch (this.phaseState.kind) {
      case SignInAttemptPhaseKind.Presented:
        this.binding.host.present(this.phaseState.presentation)
        return
      case SignInAttemptPhaseKind.Fresh:
      case SignInAttemptPhaseKind.Unavailable:
        return
    }
  }

  private hostRelease(): void {
    switch (this.binding.kind) {
      case SignInAttemptHostBindingKind.Detached:
        return
      case SignInAttemptHostBindingKind.Attached:
        this.binding.host.release()
    }
  }

  private hostUnavailable(): void {
    switch (this.binding.kind) {
      case SignInAttemptHostBindingKind.Detached:
        return
      case SignInAttemptHostBindingKind.Attached:
        this.binding.host.unavailable()
    }
  }

  private hostDisable(offer: SignInAttemptActionOffer): void {
    switch (this.binding.kind) {
      case SignInAttemptHostBindingKind.Detached:
        return
      case SignInAttemptHostBindingKind.Attached:
        this.binding.host.disable(offer)
    }
  }
}

export enum SignInAttemptChallengeKind {
  Absent = 'absent',
  Presented = 'presented',
}
export type SignInAttemptChallenge =
  | { readonly kind: SignInAttemptChallengeKind.Absent }
  | {
      readonly kind: SignInAttemptChallengeKind.Presented
      readonly presentation: SignInAttemptPresentation
    }

enum SignInAttemptChoiceKind {
  Chosen = 'chosen',
  Unavailable = 'unavailable',
}
type SignInAttemptChoiceResult =
  | {
      readonly kind: SignInAttemptChoiceKind.Chosen
      readonly action: SignInAttemptUserAction
    }
  | { readonly kind: SignInAttemptChoiceKind.Unavailable }

const signInAttemptSessionDependencies: SignInAttemptSessionDependencies = {
  browser: globalThis,
  transport: signInAttemptTransport,
  sensor: signInAttemptEvidenceSensor,
}
export const signInAttemptSession = new SignInAttemptSession(
  signInAttemptSessionDependencies,
)
