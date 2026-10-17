import type { SignInAttemptLoginReference } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { AuthenticationWorkflowActivity } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  FormSubmissionResult,
  passwordFieldDiscovery,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'
import { authentication_workflow_activity_progress } from './authentication-activity-progress'
import { authenticationWorkflowUi } from './authentication-workflow-ui-state'
import {
  LoginChecklistControlKind,
  loginChecklistForControl,
  type LoginChecklistControl,
  type LoginChecklistProgress,
} from './login-checklist-progress'
import { signInAttemptEvidenceSensor } from './sign-in-attempt-evidence'
import {
  signInAttemptSession,
  SignInAttemptStartKind,
} from './sign-in-attempt-session'
import { SignInAttemptScope } from './sign-in-attempt-transport'
import { widgetState } from './state'
import { workflowUi } from './workflow-ui'

export type LoginFillControls = {
  readonly step: HTMLParagraphElement
  readonly title: HTMLHeadingElement
  readonly description: HTMLParagraphElement
  readonly continueButton: HTMLButtonElement
}

export type LoginFillProgressRequest = {
  readonly controls: LoginFillControls
  readonly login: SignInAttemptLoginReference
}

/**
 * How this fill reports progress: a top-level Pilot sign-in attempt owned by
 * the service worker, the in-memory checklist (iframe logins), or no
 * checklist mount at all.
 */
enum LoginFillTrackingKind {
  Attempt = 'attempt',
  Checklist = 'checklist',
  Untracked = 'untracked',
}
type LoginFillTracking =
  | { readonly kind: LoginFillTrackingKind.Attempt }
  | {
      readonly kind: LoginFillTrackingKind.Checklist
      readonly progress: LoginChecklistProgress
    }
  | { readonly kind: LoginFillTrackingKind.Untracked }

export enum LoginFillStartKind {
  Started = 'started',
  /** The attempt owner was unreachable; nothing is filled. */
  Unavailable = 'unavailable',
}
export type LoginFillStart =
  | {
      readonly kind: LoginFillStartKind.Started
      readonly progress: LoginFillProgress
    }
  | {
      readonly kind: LoginFillStartKind.Unavailable
      readonly progress: LoginFillProgress
    }

type LoginFillFlight = {
  readonly activity: AuthenticationWorkflowActivity
  readonly titleKey: BrowserMessageKey
}
type LoginFillTrackingRequest = {
  readonly controls: LoginFillControls
  readonly tracking: LoginFillTracking
}
export type LoginFillSubmit = () => FormSubmissionResult

/** Reports one fill-and-submit to the Pilot: attempt events or the in-memory checklist. */
export class LoginFillProgress {
  static readonly FILLED: LoginFillAttemptActivity = { kind: 'Filled' }
  static readonly FILL_FAILED: LoginFillAttemptActivity = { kind: 'FillFailed' }

  private constructor(private readonly request: LoginFillTrackingRequest) {}

  /** Progress before the fill path is chosen: the existing Pilot copy only. */
  static untracked(controls: LoginFillControls): LoginFillProgress {
    const request: LoginFillTrackingRequest = {
      controls,
      tracking: { kind: LoginFillTrackingKind.Untracked },
    }
    return new LoginFillProgress(request)
  }

  /** Sign in (or a picker choice) begins one attempt for a top-level Pilot mount. */
  static async start(
    request: LoginFillProgressRequest,
  ): Promise<LoginFillStart> {
    const checklistRequest: Parameters<typeof loginChecklistForControl>[0] = {
      mount: widgetState.loginChecklist,
      control: request.controls.continueButton,
    }
    const checklist = loginChecklistForControl(checklistRequest)
    const selection: LoginFillTrackingSelection = { checklist, request }
    const tracking = await LoginFillProgress.tracking(selection)
    const trackingRequest: LoginFillTrackingRequest = {
      controls: request.controls,
      tracking: tracking.tracking,
    }
    const progress = new LoginFillProgress(trackingRequest)
    switch (tracking.start) {
      case SignInAttemptStartKind.Started:
        return { kind: LoginFillStartKind.Started, progress }
      case SignInAttemptStartKind.Unavailable:
        return { kind: LoginFillStartKind.Unavailable, progress }
    }
  }

  private static async tracking(
    selection: LoginFillTrackingSelection,
  ): Promise<LoginFillTrackingStart> {
    const untracked: LoginFillTrackingStart = {
      tracking: { kind: LoginFillTrackingKind.Untracked },
      start: SignInAttemptStartKind.Started,
    }
    switch (selection.checklist.kind) {
      case LoginChecklistControlKind.Unowned:
        return LoginFillProgress.unownedTracking(untracked)
      case LoginChecklistControlKind.Owned:
        break
    }
    const progress = selection.checklist.progress
    switch (signInAttemptSession.scope()) {
      case SignInAttemptScope.Frame:
        await progress.activity('Filling')
        return {
          tracking: { kind: LoginFillTrackingKind.Checklist, progress },
          start: SignInAttemptStartKind.Started,
        }
      case SignInAttemptScope.TopDocument:
        break
    }
    const start = await progress.beginAttempt(selection.request.login)
    switch (start) {
      case SignInAttemptStartKind.Started:
        return { tracking: { kind: LoginFillTrackingKind.Attempt }, start }
      case SignInAttemptStartKind.Unavailable:
        return { tracking: { kind: LoginFillTrackingKind.Untracked }, start }
    }
  }

  /**
   * Only the approved Google username advance runs untracked at top level.
   * A top-level fill whose control no login Pilot owns has no attempt host,
   * so it does not fill; an iframe keeps its existing untracked path.
   */
  private static unownedTracking(
    untracked: LoginFillTrackingStart,
  ): LoginFillTrackingStart {
    switch (signInAttemptSession.scope()) {
      case SignInAttemptScope.Frame:
        return untracked
      case SignInAttemptScope.TopDocument:
        return {
          tracking: { kind: LoginFillTrackingKind.Untracked },
          start: SignInAttemptStartKind.Unavailable,
        }
    }
  }

  async fillFailed(): Promise<false> {
    const flight: LoginFillFlight = {
      activity: AuthenticationWorkflowActivity.ReadyLogin,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetLoginTitle,
    }
    this.showFlight(flight)
    this.showStatus(BROWSER_MESSAGE_KEYS.WidgetFillFailed)
    await this.report(LoginFillProgress.FILL_FAILED)
    return false
  }

  async filled(): Promise<void> {
    await this.report(LoginFillProgress.FILLED)
  }

  async submitting(): Promise<void> {
    switch (this.request.tracking.kind) {
      case LoginFillTrackingKind.Checklist:
        await this.request.tracking.progress.activity('Submitting')
        return
      case LoginFillTrackingKind.Attempt:
        // The synchronous submit baseline reads the refreshed field classification.
        await passwordFieldDiscovery.prepareCompanionClassification(document)
        return
      case LoginFillTrackingKind.Untracked:
        return
    }
  }

  /**
   * Reports Submitted with the baseline collected right before the actuator
   * submits, in the same task and before a navigating page can unload.
   */
  submit(submit: LoginFillSubmit): FormSubmissionResult {
    switch (this.request.tracking.kind) {
      case LoginFillTrackingKind.Checklist:
      case LoginFillTrackingKind.Untracked:
        return submit()
      case LoginFillTrackingKind.Attempt:
        break
    }
    void signInAttemptSession.submitting(signInAttemptEvidenceSensor.capture())
    const result = submit()
    void signInAttemptSession.submission(result)
    return result
  }

  /** Mirrors the observed submission into the existing Pilot copy and checklist. */
  async submission(result: FormSubmissionResult): Promise<boolean> {
    switch (result) {
      case FormSubmissionResult.Rejected:
        return this.submissionRejected()
      case FormSubmissionResult.NotObserved:
        return this.submissionUnobserved()
      case FormSubmissionResult.Submitted:
        return this.submitted()
    }
  }

  async aborted(): Promise<void> {
    await this.report(LoginFillProgress.FILL_FAILED)
  }

  private async submissionRejected(): Promise<false> {
    const flight: LoginFillFlight = {
      activity: AuthenticationWorkflowActivity.FillingLogin,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
    }
    this.showFlight(flight)
    this.showStatus(BROWSER_MESSAGE_KEYS.WidgetFillFailed)
    switch (this.request.tracking.kind) {
      case LoginFillTrackingKind.Attempt:
        return false
      case LoginFillTrackingKind.Checklist:
        this.request.controls.continueButton.hidden = false
        await this.request.tracking.progress.activity('SubmissionRejected')
        return false
      case LoginFillTrackingKind.Untracked:
        this.request.controls.continueButton.hidden = false
        return false
    }
  }

  private async submissionUnobserved(): Promise<true> {
    const flight: LoginFillFlight = {
      activity: AuthenticationWorkflowActivity.FillingLogin,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetFillingTitle,
    }
    this.showFlight(flight)
    this.showDescription(BROWSER_MESSAGE_KEYS.WidgetFilledManual)
    switch (this.request.tracking.kind) {
      case LoginFillTrackingKind.Checklist:
        await this.request.tracking.progress.activity('SubmissionUnobserved')
        return true
      case LoginFillTrackingKind.Attempt:
      case LoginFillTrackingKind.Untracked:
        return true
    }
  }

  private async submitted(): Promise<true> {
    const flight: LoginFillFlight = {
      activity: AuthenticationWorkflowActivity.VerifyingLogin,
      titleKey: BROWSER_MESSAGE_KEYS.WidgetVerifyingTitle,
    }
    this.showFlight(flight)
    this.showDescription(BROWSER_MESSAGE_KEYS.WidgetSubmitted)
    switch (this.request.tracking.kind) {
      case LoginFillTrackingKind.Checklist:
        await this.request.tracking.progress.activity('Submitted')
        return true
      case LoginFillTrackingKind.Attempt:
      case LoginFillTrackingKind.Untracked:
        return true
    }
  }

  /** Attempt activity goes to Rust; the in-memory checklist keeps its own vocabulary. */
  private async report(activity: LoginFillAttemptActivity): Promise<void> {
    switch (this.request.tracking.kind) {
      case LoginFillTrackingKind.Attempt:
        await signInAttemptSession.activity(activity)
        return
      case LoginFillTrackingKind.Checklist:
        await this.request.tracking.progress.activity(activity.kind)
        return
      case LoginFillTrackingKind.Untracked:
        return
    }
  }

  /** The Rust attempt presentation owns the surface while an attempt is tracked. */
  private showFlight(flight: LoginFillFlight): void {
    switch (this.request.tracking.kind) {
      case LoginFillTrackingKind.Attempt:
        return
      case LoginFillTrackingKind.Checklist:
      case LoginFillTrackingKind.Untracked:
        break
    }
    const { step, title } = this.request.controls
    const flightProgress: Parameters<typeof workflowUi.setFlightProgress>[0] = {
      step,
      title,
      ...authentication_workflow_activity_progress(flight.activity),
      titleKey: flight.titleKey,
    }
    workflowUi.setFlightProgress(flightProgress)
  }

  private showStatus(key: BrowserMessageKey): void {
    switch (this.request.tracking.kind) {
      case LoginFillTrackingKind.Attempt:
        return
      case LoginFillTrackingKind.Checklist:
      case LoginFillTrackingKind.Untracked:
        break
    }
    const status: Parameters<typeof authenticationWorkflowUi.setStatus>[0] = {
      description: this.request.controls.description,
      continueButton: this.request.controls.continueButton,
      text: workflowUi.translatedMessage(key),
      enableContinue: true,
    }
    authenticationWorkflowUi.setStatus(status)
  }

  private showDescription(key: BrowserMessageKey): void {
    switch (this.request.tracking.kind) {
      case LoginFillTrackingKind.Attempt:
        return
      case LoginFillTrackingKind.Checklist:
      case LoginFillTrackingKind.Untracked:
        break
    }
    this.request.controls.description.textContent =
      workflowUi.translatedMessage(key)
    this.request.controls.continueButton.hidden = true
  }
}

type LoginFillAttemptActivity =
  { readonly kind: 'Filled' } | { readonly kind: 'FillFailed' }
type LoginFillTrackingSelection = {
  readonly checklist: LoginChecklistControl
  readonly request: LoginFillProgressRequest
}
type LoginFillTrackingStart = {
  readonly tracking: LoginFillTracking
  readonly start: SignInAttemptStartKind
}
