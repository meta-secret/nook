import {
  AuthenticationWorkflowActivity,
  AuthenticationWorkflowKind,
  type SignInAttemptActionOffer,
  type SignInAttemptPresentation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authenticationActivityProgress,
  authentication_workflow_activity_progress,
} from './authentication-activity-progress'
import { LoginChecklistRendering } from './login-checklist-rendering'
import { SignInAttemptRendering } from './sign-in-attempt-rendering'
import {
  SignInAttemptPhaseKind,
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
    switch (this.phaseKind()) {
      case SignInAttemptPhaseKind.Fresh:
      case SignInAttemptPhaseKind.Unavailable:
        return SignInAttemptWidgetDisplay.NotPresented
      case SignInAttemptPhaseKind.Presented:
        break
    }
    // The step counter comes from this scan's Rust policy batch; without it
    // the attempt is not rendered on this page.
    switch (authenticationActivityProgress.prepare()) {
      case true:
        break
      case false:
        return SignInAttemptWidgetDisplay.NotPresented
    }
    this.mount(WidgetVaultPresentationProjection.forConnection(vaultConnection))
    return SignInAttemptWidgetDisplay.Shown
  }

  private phaseKind(): SignInAttemptPhaseKind {
    return signInAttemptSession.phase.kind
  }

  /** Whether this Pilot still holds the page for a presented attempt. */
  displayed(): SignInAttemptWidgetDisplay {
    switch (
      this.rendering.kind === SignInAttemptWidgetMount.Attached &&
      signInAttemptSession.phase.kind === SignInAttemptPhaseKind.Presented &&
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

  /** Follow-ups need a form Pilot: the rescan mounts it where the page has one. */
  run(action: SignInAttemptHostAction): void {
    switch (action.kind) {
      case SignInAttemptHostActionKind.RestartWithSameLogin:
      case SignInAttemptHostActionKind.OpenLoginPicker:
      case SignInAttemptHostActionKind.OpenAuthenticatorPicker:
        scanState.schedule()
    }
  }

  disable(offer: SignInAttemptActionOffer): void {
    switch (this.rendering.kind) {
      case SignInAttemptWidgetMount.Detached:
        return
      case SignInAttemptWidgetMount.Attached:
        this.rendering.attempt.disable(offer)
    }
  }

  private mount(
    vaultPresentation: ReturnType<
      typeof WidgetVaultPresentationProjection.forConnection
    >,
  ): void {
    workflowUi.removeWidget()
    const progress = authentication_workflow_activity_progress(
      AuthenticationWorkflowActivity.VerifyingLogin,
    )
    const shellRequest: Parameters<
      typeof authenticationWidgetShell.createWidgetShell
    >[0] = {
      copy: WorkflowCopy.forKind(AuthenticationWorkflowKind.Login),
      vaultPresentation,
      savedLoginAction: false,
      currentStep: progress.currentStep,
      totalSteps: progress.totalSteps,
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
        break
    }
    workflowUi.removeWidget()
    scanState.schedule()
  }
}

type SignInAttemptRenderingSlot =
  | { readonly kind: SignInAttemptWidgetMount.Detached }
  | {
      readonly kind: SignInAttemptWidgetMount.Attached
      readonly attempt: SignInAttemptRendering
    }

export const signInAttemptPageWidget = new SignInAttemptPageWidget()
