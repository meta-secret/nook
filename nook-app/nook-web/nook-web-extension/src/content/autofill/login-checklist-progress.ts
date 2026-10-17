import { LoginChecklistMountKind, type LoginChecklistMountState } from './state'
import { Effect } from 'effect'
import type {
  AuthenticationLoginChecklistActivity,
  AuthenticationLoginChecklistObservation,
  AuthenticationLoginChecklistPresentation,
  AuthenticationLoginChecklistState,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { CompanionWasmSessionMessageType } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendLoginChecklistProjection,
  type LoginChecklistProjectionRequest,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'
import {
  LoginChecklistRendering,
  type LoginChecklistSurface,
} from './login-checklist-rendering'
import {
  authenticationOutcomeObservation,
  AuthenticationOutcomeReadKind,
  type AuthenticationOutcomeObservationContext,
} from './authentication-outcome-observation'
import { OUTCOME_EVIDENCE_POLL_MS } from './workflow-ui'
import type {
  SignInAttemptActionOffer,
  SignInAttemptLoginReference,
  SignInAttemptPresentation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { SignInAttemptRendering } from './sign-in-attempt-rendering'
import {
  SignInAttemptPhaseKind,
  signInAttemptSession,
  type SignInAttemptHost,
  type SignInAttemptHostAction,
  type SignInAttemptStartKind,
} from './sign-in-attempt-session'
import { SignInAttemptScope } from './sign-in-attempt-transport'

/** Follow-ups a sign-in attempt runs with this mount's live form controls. */
export interface LoginChecklistAttemptActions {
  run(action: SignInAttemptHostAction): void
}

type LoginChecklistMount = {
  surface: LoginChecklistSurface
  control: HTMLButtonElement
  workflow: PasswordFormObservation
  attemptActions: LoginChecklistAttemptActions
}

enum ChecklistAttemptBinding {
  Unbound = 'unbound',
  Bound = 'bound',
}
type ChecklistFreshCopy = {
  readonly title: string
  readonly description: string
}

enum ChecklistActionLifecycle {
  Active = 'active',
  Cancelled = 'cancelled',
}
enum ChecklistEvaluation {
  Idle = 'idle',
  Running = 'running',
}
enum ChecklistWatchKind {
  Stopped = 'stopped',
  Watching = 'watching',
}
type ChecklistWatch =
  | { kind: ChecklistWatchKind.Stopped }
  | {
      kind: ChecklistWatchKind.Watching
      timer: number
      observer: MutationObserver
    }
enum ChecklistMountLifecycle {
  Mounted = 'mounted',
  Disposed = 'disposed',
}
enum ChecklistOwnership {
  Current = 'current',
  Replaced = 'replaced',
  Disposed = 'disposed',
}
enum ChecklistPresentationMode {
  Initial = 'initial',
  Activity = 'activity',
}
enum ChecklistProjectionFailureCode {
  Unavailable = 'projection-unavailable',
}
type ChecklistProjectionFailureContext = {
  operation: CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist
}
class ChecklistProjectionFailure extends Error {
  readonly code = ChecklistProjectionFailureCode.Unavailable
  constructor(readonly context: ChecklistProjectionFailureContext) {
    super(ChecklistProjectionFailureCode.Unavailable)
  }
}

/** Owns one actual action's browser resources and pending evaluation. */
class LoginChecklistAction {
  lifecycle = ChecklistActionLifecycle.Active
  evaluation = ChecklistEvaluation.Idle
  private resources: ChecklistWatch = { kind: ChecklistWatchKind.Stopped }
  readonly context: AuthenticationOutcomeObservationContext = {
    startedAt: Date.now(),
    authPath: location.pathname,
    sawMutation: false,
  }

  watch(evaluate: () => void): void {
    const observer = new MutationObserver(() => {
      this.context.sawMutation = true
      evaluate()
    })
    const options: MutationObserverInit = {
      childList: true,
      subtree: true,
      attributes: true,
    }
    observer.observe(document.documentElement, options)
    const timer = window.setInterval(evaluate, OUTCOME_EVIDENCE_POLL_MS)
    this.resources = { kind: ChecklistWatchKind.Watching, timer, observer }
    evaluate()
  }
  stop(): void {
    switch (this.resources.kind) {
      case ChecklistWatchKind.Stopped:
        return
      case ChecklistWatchKind.Watching:
        window.clearInterval(this.resources.timer)
        this.resources.observer.disconnect()
        this.resources = { kind: ChecklistWatchKind.Stopped }
    }
  }
  cancel(): void {
    this.lifecycle = ChecklistActionLifecycle.Cancelled
    this.stop()
  }
  finishEvaluation(): void {
    this.evaluation = ChecklistEvaluation.Idle
  }
}

type ChecklistPresentationDelivery = {
  action: LoginChecklistAction
  presentation: AuthenticationLoginChecklistPresentation
  mode: ChecklistPresentationMode
}
type ChecklistExecution = { readonly self: LoginChecklistProgress }

/** Owns only mounted login presentation and the existing non-secret result observation. */
export class LoginChecklistProgress implements SignInAttemptHost {
  private readonly rendering: LoginChecklistRendering
  private readonly attemptRendering: SignInAttemptRendering
  private readonly freshCopy: ChecklistFreshCopy
  private attempt = ChecklistAttemptBinding.Unbound
  private state: AuthenticationLoginChecklistState = {
    kind: 'Activity',
    activity: 'Ready',
  }
  private action = new LoginChecklistAction()
  private lifecycle = ChecklistMountLifecycle.Mounted

  constructor(private readonly mount: LoginChecklistMount) {
    this.rendering = new LoginChecklistRendering(mount.surface)
    this.freshCopy = {
      title: String(mount.surface.title.textContent),
      description: String(mount.surface.description.textContent),
    }
    const attemptSurface: ConstructorParameters<
      typeof SignInAttemptRendering
    >[0] = {
      surface: { ...mount.surface, continueButton: mount.control },
      checklist: this.rendering,
      choose: (offer) => void signInAttemptSession.choose(offer),
    }
    this.attemptRendering = new SignInAttemptRendering(attemptSurface)
  }

  /** A top-level mount shows this tab's attempt instead of starting at Ready. */
  initialize(): Promise<void> {
    switch (signInAttemptSession.scope()) {
      case SignInAttemptScope.Frame:
        return this.initializeFresh()
      case SignInAttemptScope.TopDocument:
        break
    }
    switch (signInAttemptSession.phase.kind) {
      case SignInAttemptPhaseKind.Presented:
      case SignInAttemptPhaseKind.Unavailable:
        signInAttemptSession.attach(this)
        return Promise.resolve()
      case SignInAttemptPhaseKind.Fresh:
        return this.initializeFresh()
    }
  }

  beginAttempt(
    login: SignInAttemptLoginReference,
  ): Promise<SignInAttemptStartKind> {
    const request: Parameters<typeof signInAttemptSession.begin>[0] = {
      login,
      host: this,
    }
    return signInAttemptSession.begin(request)
  }

  present(presentation: SignInAttemptPresentation): void {
    switch (this.ownership(this.action)) {
      case ChecklistOwnership.Replaced:
      case ChecklistOwnership.Disposed:
        signInAttemptSession.detach(this)
        return
      case ChecklistOwnership.Current:
        break
    }
    this.attempt = ChecklistAttemptBinding.Bound
    this.action.stop()
    this.attemptRendering.render(presentation)
  }

  release(): void {
    switch (this.attempt) {
      case ChecklistAttemptBinding.Unbound:
        return
      case ChecklistAttemptBinding.Bound:
        break
    }
    this.attempt = ChecklistAttemptBinding.Unbound
    signInAttemptSession.detach(this)
    this.attemptRendering.clear()
    this.mount.surface.title.textContent = this.freshCopy.title
    this.mount.surface.description.textContent = this.freshCopy.description
    this.state = { kind: 'Activity', activity: 'Ready' }
    void this.initializeFresh()
  }

  unavailable(): void {
    this.attemptRendering.clear()
    this.rendering.unavailable()
  }

  run(action: SignInAttemptHostAction): void {
    this.mount.attemptActions.run(action)
  }

  disable(offer: SignInAttemptActionOffer): void {
    this.attemptRendering.disable(offer)
  }

  private initializeFresh(): Promise<void> {
    const action = this.action
    const observation: AuthenticationLoginChecklistObservation = {
      kind: 'Activity',
      activity: 'Ready',
    }
    return Effect.runPromise(
      this.project(observation).pipe(
        Effect.map((presentation) => {
          const delivery: ChecklistPresentationDelivery = {
            action,
            presentation,
            mode: ChecklistPresentationMode.Initial,
          }
          this.acceptPresentation(delivery)
        }),
        Effect.catch(() => Effect.sync(this.invalidated.bind(this, action))),
      ),
    )
  }

  activity(activity: AuthenticationLoginChecklistActivity): Promise<void> {
    switch (this.attempt) {
      case ChecklistAttemptBinding.Bound:
        return Promise.resolve()
      case ChecklistAttemptBinding.Unbound:
        break
    }
    switch (this.ownership(this.action)) {
      case ChecklistOwnership.Replaced:
        return Promise.resolve()
      case ChecklistOwnership.Disposed:
        this.invalidated(this.action)
        return Promise.resolve()
      case ChecklistOwnership.Current:
        break
    }
    this.action.cancel()
    const action = new LoginChecklistAction()
    this.action = action
    const observation: AuthenticationLoginChecklistObservation = {
      kind: 'Activity',
      activity,
    }
    return Effect.runPromise(
      this.project(observation).pipe(
        Effect.map((presentation) => {
          const delivery: ChecklistPresentationDelivery = {
            action,
            presentation,
            mode: ChecklistPresentationMode.Activity,
          }
          this.acceptPresentation(delivery)
        }),
        Effect.catch(() => Effect.sync(this.invalidated.bind(this, action))),
      ),
    )
  }

  cancel(): void {
    switch (this.lifecycle) {
      case ChecklistMountLifecycle.Mounted:
        this.rendering.unavailable()
        break
      case ChecklistMountLifecycle.Disposed:
        break
    }
    this.lifecycle = ChecklistMountLifecycle.Disposed
    this.action.cancel()
    signInAttemptSession.detach(this)
  }

  controlOwnership(control: HTMLButtonElement): ChecklistOwnership {
    switch (this.mount.control === control) {
      case true:
        return this.ownership(this.action)
      case false:
        return ChecklistOwnership.Replaced
    }
  }

  private invalidated(action: LoginChecklistAction): void {
    switch (this.action === action) {
      case false:
        action.cancel()
        return
      case true:
        break
    }
    action.cancel()
    this.rendering.unavailable()
  }

  private ownership(action: LoginChecklistAction): ChecklistOwnership {
    switch (this.action === action) {
      case false:
        return ChecklistOwnership.Replaced
      case true:
        break
    }
    switch (this.lifecycle) {
      case ChecklistMountLifecycle.Disposed:
        return ChecklistOwnership.Disposed
      case ChecklistMountLifecycle.Mounted:
        break
    }
    switch (action.lifecycle) {
      case ChecklistActionLifecycle.Cancelled:
        return ChecklistOwnership.Disposed
      case ChecklistActionLifecycle.Active:
        break
    }
    // Original form and pathname are observations; the live mount owns cancellation.
    switch (
      this.mount.control.isConnected &&
      this.mount.surface.body.isConnected &&
      this.mount.surface.body.contains(this.mount.control) &&
      this.mount.control.ownerDocument === document
    ) {
      case true:
        return ChecklistOwnership.Current
      case false:
        return ChecklistOwnership.Disposed
    }
  }

  private acceptPresentation(delivery: ChecklistPresentationDelivery): void {
    const { action, presentation, mode } = delivery
    switch (this.ownership(action)) {
      case ChecklistOwnership.Replaced:
        return
      case ChecklistOwnership.Disposed:
        this.invalidated(action)
        return
      case ChecklistOwnership.Current:
        break
    }
    this.state = presentation.state
    switch (mode) {
      case ChecklistPresentationMode.Initial:
        this.rendering.render(presentation)
        break
      case ChecklistPresentationMode.Activity:
        this.rendering.renderStatus(presentation)
        break
    }
    switch (presentation.outcome_polling) {
      case 'Stop':
        action.stop()
        break
      case 'Wait':
        action.watch(this.evaluate.bind(this, action))
        break
    }
  }

  private project(observation: AuthenticationLoginChecklistObservation) {
    const request: LoginChecklistProjectionRequest = {
      browser: globalThis,
      message: {
        type: CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist,
        origin: location.origin,
        payload: { state: this.state, observation },
      },
    }
    return Effect.tryPromise(
      sendLoginChecklistProjection.bind(globalThis, request),
    ).pipe(
      Effect.flatMap((delivery) => {
        switch (delivery.kind) {
          case CompanionWasmRuntimeDeliveryKind.Delivered:
            return Effect.succeed(delivery.response)
          case CompanionWasmRuntimeDeliveryKind.Unavailable: {
            const context: ConstructorParameters<
              typeof ChecklistProjectionFailure
            >[0] = {
              operation:
                CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist,
            }
            return Effect.fail(new ChecklistProjectionFailure(context))
          }
        }
      }),
    )
  }

  private evaluate(action: LoginChecklistAction): void {
    switch (this.ownership(action)) {
      case ChecklistOwnership.Replaced:
        return
      case ChecklistOwnership.Disposed:
        this.invalidated(action)
        return
      case ChecklistOwnership.Current:
        break
    }
    switch (action.evaluation) {
      case ChecklistEvaluation.Running:
        return
      case ChecklistEvaluation.Idle:
        action.evaluation = ChecklistEvaluation.Running
    }
    Effect.runFork(this.evaluateEffect(action))
  }

  private evaluateEffect(action: LoginChecklistAction) {
    const request: Parameters<
      typeof authenticationOutcomeObservation.collectWorkflowOutcomeObservation
    >[0] = {
      context: action.context,
      workflow: this.mount.workflow,
    }
    const observation =
      authenticationOutcomeObservation.collectWorkflowOutcomeObservation(
        request,
      )
    const execution: ChecklistExecution = { self: this }
    return Effect.gen(execution, function* () {
      const classified = yield* Effect.tryPromise(
        authenticationOutcomeObservation.classifyOutcomeEvidence.bind(
          authenticationOutcomeObservation,
          observation,
        ),
      )
      switch (this.ownership(action)) {
        case ChecklistOwnership.Replaced:
          return
        case ChecklistOwnership.Disposed:
          this.invalidated(action)
          return
        case ChecklistOwnership.Current:
          break
      }
      switch (classified.kind) {
        case AuthenticationOutcomeReadKind.Unavailable:
          this.invalidated(action)
          return
        case AuthenticationOutcomeReadKind.Available:
          break
      }
      const input: AuthenticationLoginChecklistObservation = {
        kind: 'Outcome',
        verdict: classified.verdict.verdict,
        observation,
      }
      const presentation = yield* this.project(input)
      switch (this.ownership(action)) {
        case ChecklistOwnership.Replaced:
          return
        case ChecklistOwnership.Disposed:
          this.invalidated(action)
          return
        case ChecklistOwnership.Current:
          break
      }
      this.state = presentation.state
      this.rendering.renderStatus(presentation)
      switch (presentation.outcome_polling) {
        case 'Stop':
          action.stop()
          break
        case 'Wait':
          break
      }
    }).pipe(
      Effect.catch(() => Effect.sync(this.invalidated.bind(this, action))),
      Effect.ensuring(Effect.sync(action.finishEvaluation.bind(action))),
    )
  }
}

export enum LoginChecklistControlKind {
  Owned = 'owned',
  Unowned = 'unowned',
}
export type LoginChecklistControl =
  | { kind: LoginChecklistControlKind.Owned; progress: LoginChecklistProgress }
  | { kind: LoginChecklistControlKind.Unowned }

type LoginChecklistControlRequest = {
  mount: LoginChecklistMountState
  control: HTMLButtonElement
}
export function loginChecklistForControl(
  request: LoginChecklistControlRequest,
): LoginChecklistControl {
  switch (request.mount.kind) {
    case LoginChecklistMountKind.Unmounted:
      return { kind: LoginChecklistControlKind.Unowned }
    case LoginChecklistMountKind.Mounted:
      switch (request.mount.progress.controlOwnership(request.control)) {
        case ChecklistOwnership.Current:
          return {
            kind: LoginChecklistControlKind.Owned,
            progress: request.mount.progress,
          }
        case ChecklistOwnership.Disposed:
        case ChecklistOwnership.Replaced:
          return { kind: LoginChecklistControlKind.Unowned }
      }
  }
}
