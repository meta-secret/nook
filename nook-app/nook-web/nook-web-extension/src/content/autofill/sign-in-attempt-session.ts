import type {
  SignInAttemptActionOffer,
  SignInAttemptActivity,
  SignInAttemptDocumentRelation,
  SignInAttemptEvent,
  SignInAttemptFollowUp,
  SignInAttemptLoginReference,
  SignInAttemptPresentation,
  SignInAttemptSubmitBaseline,
  SignInAttemptUserAction,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { FormSubmissionResult } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  SignInAttemptLinkTargetKind,
  signInAttemptEvidenceSensor,
  type SignInAttemptEvidenceSensor,
} from './sign-in-attempt-evidence'
import {
  SignInAttemptDeliveryKind,
  SignInAttemptScope,
  signInAttemptTransport,
  type SignInAttemptDelivery,
  type SignInAttemptTransport,
} from './sign-in-attempt-transport'
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
export type SignInAttemptSubmission = {
  readonly result: FormSubmissionResult
  readonly baseline: SignInAttemptSubmitBaseline
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
  private phaseState: SignInAttemptPhase = {
    kind: SignInAttemptPhaseKind.Fresh,
  }
  private binding: SignInAttemptHostBinding = {
    kind: SignInAttemptHostBindingKind.Detached,
  }
  /** NewDocument until this document's own actuator reports the submit. */
  private relation: SignInAttemptDocumentRelation = 'NewDocument'
  private watch: EvidenceWatch = { kind: EvidenceWatchKind.Stopped }
  private report = EvidenceReport.Idle

  constructor(
    private readonly dependencies: SignInAttemptSessionDependencies,
  ) {}

  get phase(): SignInAttemptPhase {
    return this.phaseState
  }

  scope(): SignInAttemptScope {
    return this.dependencies.transport.scope()
  }

  /** Pilot mount on any top-level page: pick up this tab's attempt, if any. */
  async resume(): Promise<void> {
    switch (this.scope()) {
      case SignInAttemptScope.Frame:
        return
      case SignInAttemptScope.TopDocument:
        break
    }
    const event: SignInAttemptEvent = { kind: 'Resumed' }
    this.accept(await this.dependencies.transport.advance(event))
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
    this.relation = 'NewDocument'
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

  activity(activity: SignInAttemptActivity): Promise<void> {
    const event: SignInAttemptEvent = { kind: 'Activity', activity }
    return this.advance(event)
  }

  /** Reported right after the actuator submits, before the document can unload. */
  submitted(submission: SignInAttemptSubmission): Promise<void> {
    switch (submission.result) {
      case FormSubmissionResult.Rejected:
        return this.activity({ kind: 'SubmissionRejected' })
      case FormSubmissionResult.NotObserved:
        return this.activity({ kind: 'SubmissionUnobserved' })
      case FormSubmissionResult.Submitted:
        this.relation = 'SameDocument'
        return this.activity({
          kind: 'Submitted',
          baseline: submission.baseline,
        })
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
    const index = this.phaseState.presentation.resetLink
    switch (typeof index) {
      case 'number':
        break
      default:
        return { kind: SignInAttemptChoiceKind.Unavailable }
    }
    const target = this.dependencies.sensor.link(index)
    switch (target.kind) {
      case SignInAttemptLinkTargetKind.Unavailable:
        return { kind: SignInAttemptChoiceKind.Unavailable }
      case SignInAttemptLinkTargetKind.Available:
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
    this.follow(presentation.followUp)
    this.updateWatch(presentation)
  }

  /** Rust selects the follow-up; the page side only performs it. */
  private follow(followUp: SignInAttemptFollowUp): void {
    switch (followUp.kind) {
      case 'None':
        this.hostPresent()
        return
      case 'RestartWithSameLogin':
        this.release({
          kind: SignInAttemptHostActionKind.RestartWithSameLogin,
          login: followUp.login,
        })
        return
      case 'OpenLoginPicker':
        this.release({ kind: SignInAttemptHostActionKind.OpenLoginPicker })
        return
      case 'OpenAuthenticatorPicker':
        this.release({
          kind: SignInAttemptHostActionKind.OpenAuthenticatorPicker,
        })
        return
      case 'ActivateResetLink':
        this.phaseState = { kind: SignInAttemptPhaseKind.Fresh }
        this.hostRelease()
        this.activateResetLink(followUp.link)
        return
    }
  }

  private release(action: SignInAttemptHostAction): void {
    this.phaseState = { kind: SignInAttemptPhaseKind.Fresh }
    switch (this.binding.kind) {
      case SignInAttemptHostBindingKind.Detached:
        return
      case SignInAttemptHostBindingKind.Attached:
        this.binding.host.release()
        this.binding.host.run(action)
    }
  }

  /** DOM revalidation again right before activating the page's own link. */
  private activateResetLink(index: number): void {
    const target = this.dependencies.sensor.link(index)
    switch (target.kind) {
      case SignInAttemptLinkTargetKind.Unavailable:
        return
      case SignInAttemptLinkTargetKind.Available:
        target.element.click()
    }
  }

  private updateWatch(presentation: SignInAttemptPresentation): void {
    switch (
      presentation.pageEvidence === 'Wanted' &&
      presentation.checklist.outcome_polling === 'Wait'
    ) {
      case false:
        this.stopWatching()
        return
      case true:
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
    const timer = browser.setInterval(
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
        this.dependencies.browser.clearInterval(this.watch.timer)
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
    const event: SignInAttemptEvent = {
      kind: 'PageObserved',
      page: this.dependencies.sensor.page(this.relation),
    }
    void this.advance(event).finally(() => {
      this.report = EvidenceReport.Idle
    })
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
