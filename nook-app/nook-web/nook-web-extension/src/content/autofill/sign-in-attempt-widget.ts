import {
  AuthenticationWorkflowKind,
  type AuthenticationDisplayProgress,
  type SignInAttemptActionOffer,
  type SignInAttemptPresentation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { LoginChecklistRendering } from './login-checklist-rendering'
import { SignInAttemptRendering } from './sign-in-attempt-rendering'
import {
  SignInAttemptPhaseKind,
  type SignInAttemptPhase,
  signInAttemptSession,
  type SignInAttemptHost,
  SignInAttemptHostActionKind,
  type SignInAttemptHostAction,
} from './sign-in-attempt-session'
import {
  WidgetRenderDisposition,
  WidgetWorkflowRootKind,
  scanState,
  widgetState,
} from './state'
import { authenticationWidgetShell } from './widget-shell'
import { WidgetVaultPresentationProjection } from './widget-presentation-state'
import { WorkflowCopy, workflowUi } from './workflow-ui'

export enum SignInAttemptWidgetDisplay {
  Shown = 'shown',
  NotPresented = 'not-presented',
}

enum SignInAttemptWidgetMount {
  Detached = 'detached',
  Attached = 'attached',
  /** A follow-up could not run: the refusal stays until the user closes it. */
  Refused = 'refused',
}

/**
 * Pilot for a tab's attempt on a page without a login form Pilot, such as
 * the signed-in page after navigation or a verification checkpoint.
 */
class SignInAttemptPageWidget implements SignInAttemptHost {
  static readonly WORKFLOW_KEY = 'sign-in-attempt'
  private rendering: SignInAttemptRenderingSlot = {
    kind: SignInAttemptWidgetMount.Detached,
  }

  /** Shows the presented attempt when no other Pilot claimed the page. */
  async show(): Promise<SignInAttemptWidgetDisplay> {
    switch (signInAttemptSession.phase.kind) {
      case SignInAttemptPhaseKind.Fresh:
      case SignInAttemptPhaseKind.Unavailable:
        return SignInAttemptWidgetDisplay.NotPresented
      case SignInAttemptPhaseKind.Presented:
        break
    }
    switch (
      widgetState.enrollmentRenderDisposition(
        SignInAttemptPageWidget.WORKFLOW_KEY,
      )
    ) {
      case WidgetRenderDisposition.Reuse:
        return SignInAttemptWidgetDisplay.Shown
      case WidgetRenderDisposition.Replace:
        break
    }
    const vaultConnection = await workflowUi.loadPilotVaultConnection()
    // Re-read after the await: the attempt may have moved on meanwhile.
    const phase = this.currentPhase()
    switch (phase.kind) {
      case SignInAttemptPhaseKind.Fresh:
      case SignInAttemptPhaseKind.Unavailable:
        return SignInAttemptWidgetDisplay.NotPresented
      case SignInAttemptPhaseKind.Presented:
        break
    }
    const request: SignInAttemptPageMount = {
      vaultPresentation:
        WidgetVaultPresentationProjection.forConnection(vaultConnection),
      progress: phase.presentation.progress,
    }
    this.mount(request)
    return SignInAttemptWidgetDisplay.Shown
  }

  private currentPhase(): SignInAttemptPhase {
    return signInAttemptSession.phase
  }

  /** Whether this Pilot still holds the page for a presented attempt or its refusal. */
  displayed(): SignInAttemptWidgetDisplay {
    const holding =
      (this.rendering.kind === SignInAttemptWidgetMount.Attached &&
        signInAttemptSession.phase.kind === SignInAttemptPhaseKind.Presented) ||
      this.rendering.kind === SignInAttemptWidgetMount.Refused
    switch (
      holding &&
      widgetState.enrollmentRenderDisposition(
        SignInAttemptPageWidget.WORKFLOW_KEY,
      ) === WidgetRenderDisposition.Reuse
    ) {
      case true:
        return SignInAttemptWidgetDisplay.Shown
      case false:
        return SignInAttemptWidgetDisplay.NotPresented
    }
  }

  present(presentation: SignInAttemptPresentation): void {
    switch (this.rendering.kind) {
      case SignInAttemptWidgetMount.Detached:
      case SignInAttemptWidgetMount.Refused:
        return
      case SignInAttemptWidgetMount.Attached:
        this.rendering.attempt.render(presentation)
    }
  }

  /** The attempt ended: hand the page back to the normal Pilot scan. */
  release(): void {
    this.remove()
  }

  unavailable(): void {
    this.remove()
  }

  /**
   * This Pilot has no login form controls, so it cannot run a follow-up; it
   * stays visible with a refusal instead of disappearing.
   */
  run(action: SignInAttemptHostAction): void {
    switch (action.kind) {
      case SignInAttemptHostActionKind.RestartWithSameLogin:
      case SignInAttemptHostActionKind.OpenLoginPicker:
      case SignInAttemptHostActionKind.OpenAuthenticatorPicker:
        this.refuse()
    }
  }

  refuse(): void {
    switch (this.rendering.kind) {
      case SignInAttemptWidgetMount.Detached:
        return
      case SignInAttemptWidgetMount.Attached:
      case SignInAttemptWidgetMount.Refused:
        break
    }
    this.rendering.attempt.refuse()
    this.rendering = {
      kind: SignInAttemptWidgetMount.Refused,
      attempt: this.rendering.attempt,
    }
  }

  disable(offer: SignInAttemptActionOffer): void {
    switch (this.rendering.kind) {
      case SignInAttemptWidgetMount.Detached:
      case SignInAttemptWidgetMount.Refused:
        return
      case SignInAttemptWidgetMount.Attached:
        this.rendering.attempt.disable(offer)
    }
  }

  /** The shell opens at the attempt's own Rust progress. */
  private mount(request: SignInAttemptPageMount): void {
    workflowUi.removeWidget()
    const shellRequest: Parameters<
      typeof authenticationWidgetShell.createWidgetShell
    >[0] = {
      copy: WorkflowCopy.forKind(AuthenticationWorkflowKind.Login),
      vaultPresentation: request.vaultPresentation,
      savedLoginAction: false,
      currentStep: request.progress.currentStep,
      totalSteps: request.progress.totalSteps,
    }
    const shell = authenticationWidgetShell.createWidgetShell(shellRequest)
    const mountRequest: Parameters<
      typeof authenticationWidgetShell.mountWidgetShell
    >[0] = {
      shell,
      workflowKey: SignInAttemptPageWidget.WORKFLOW_KEY,
      workflowRoot: { kind: WidgetWorkflowRootKind.Unassigned },
    }
    authenticationWidgetShell.mountWidgetShell(mountRequest)
    const checklist = new LoginChecklistRendering(shell)
    const attemptRequest: ConstructorParameters<
      typeof SignInAttemptRendering
    >[0] = {
      surface: shell,
      checklist,
      choose: (offer) => void signInAttemptSession.choose(offer),
    }
    this.rendering = {
      kind: SignInAttemptWidgetMount.Attached,
      attempt: new SignInAttemptRendering(attemptRequest),
    }
    widgetState.setRenderedCleanup(this.detach.bind(this))
    signInAttemptSession.attach(this)
  }

  private detach(): void {
    this.rendering = { kind: SignInAttemptWidgetMount.Detached }
    signInAttemptSession.detach(this)
  }

  private remove(): void {
    switch (this.rendering.kind) {
      case SignInAttemptWidgetMount.Detached:
        return
      case SignInAttemptWidgetMount.Attached:
      case SignInAttemptWidgetMount.Refused:
        break
    }
    workflowUi.removeWidget()
    scanState.schedule()
  }
}

type SignInAttemptPageMount = {
  readonly vaultPresentation: ReturnType<
    typeof WidgetVaultPresentationProjection.forConnection
  >
  readonly progress: AuthenticationDisplayProgress
}

type SignInAttemptRenderingSlot =
  | { readonly kind: SignInAttemptWidgetMount.Detached }
  | {
      readonly kind:
        SignInAttemptWidgetMount.Attached | SignInAttemptWidgetMount.Refused
      readonly attempt: SignInAttemptRendering
    }

export const signInAttemptPageWidget = new SignInAttemptPageWidget()
