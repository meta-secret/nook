/// <reference types="chrome" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  classify_companion_authentication_outcome,
  type AuthenticationOutcomeClassification,
  type AuthenticationOutcomeResponseWire,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
  type CompanionWasmSessionResponse,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { GoogleLoginContinuationMessageType } from '../../../../nook-web-shared/src/extension/google-login-continuation-messages'
import { handleCompanionWasmMessage } from '../../../../nook-web-extension/src/offscreen/session-companion-wasm-operations'
import {
  AuthenticationOutcomeClassifyMessageType,
  type AuthenticationOutcomeClassifyMessage,
} from '../../../../nook-web-extension/src/lib/outcome-evidence-messages'
import { LoginChecklistProgress } from '../../../../nook-web-extension/src/content/autofill/login-checklist-progress'
import { authenticationOutcomeObservation } from '../../../../nook-web-extension/src/content/autofill/authentication-outcome-observation'
import { PasswordFormScopeKind } from '../../../../nook-web-shared/src/extension/password-form-fields'
import { emptyPasswordFormSummary } from '../../../../nook-web-shared/src/extension/password-form-summary-state'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  widgetState,
  LoginChecklistMountKind,
} from '../../../../nook-web-extension/src/content/autofill/state'

type BrowserDelivery =
  | { ok: true; result: CompanionWasmSessionResponse }
  | { ok: false }
  | AuthenticationOutcomeResponseWire
type BrowserMessage =
  CompanionWasmSessionMessage | AuthenticationOutcomeClassifyMessage
type DeliveryOperation = BrowserMessage['type']
type BrowserReply = {
  type: DeliveryOperation
  value: BrowserDelivery
  callback: (value: BrowserDelivery) => void
}
enum DeliveryModeKind {
  Live = 'live',
  Held = 'held',
  Unavailable = 'unavailable',
}
type DeliveryMode =
  | { kind: DeliveryModeKind.Live }
  | {
      kind: DeliveryModeKind.Held | DeliveryModeKind.Unavailable
      type: DeliveryOperation
    }
enum ReplyDisposition {
  Deliver = 'deliver',
  Hold = 'hold',
  Unavailable = 'unavailable',
}
type ReplyRequest = {
  fixture: ChecklistBrowserFixture
  message: BrowserMessage
  callback: (value: BrowserDelivery) => void
}

/** Owns only delivery of the actual offscreen/Rust reply. */
class ChecklistBrowserReply {
  constructor(private readonly request: ReplyRequest) {}
  complete(
    result: Awaited<ReturnType<typeof handleCompanionWasmMessage>>,
  ): void {
    result.match(this.accept.bind(this), this.reject.bind(this))
  }
  accept(result: CompanionWasmSessionResponse): void {
    const value: BrowserDelivery = { ok: true, result }
    this.deliver(value)
  }
  reject(): void {
    const value: BrowserDelivery = { ok: false }
    this.deliver(value)
  }
  deliver(value: BrowserDelivery): void {
    const reply: BrowserReply = {
      type: this.request.message.type,
      callback: this.request.callback,
      value,
    }
    this.request.fixture.deliver(reply)
  }
}

/** Delays only Chrome delivery; all policy/decoding/presentations use shipping Rust. */
class ChecklistBrowserFixture {
  readonly delivered: DeliveryOperation[] = []
  private mode: DeliveryMode = { kind: DeliveryModeKind.Live }
  private pending: BrowserReply[] = []
  get pendingCount(): number {
    return this.pending.length
  }
  hold(type: DeliveryOperation): void {
    this.mode = { kind: DeliveryModeKind.Held, type }
  }
  unavailable(type: DeliveryOperation): void {
    this.mode = { kind: DeliveryModeKind.Unavailable, type }
  }
  release(): void {
    this.mode = { kind: DeliveryModeKind.Live }
    for (const reply of this.pending.splice(0)) reply.callback(reply.value)
  }
  assertPending(): void {
    expect(this.pendingCount).toBeGreaterThan(0)
  }
  assertClassified(): void {
    expect(this.delivered).toContain(
      AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
    )
  }
  private disposition(type: DeliveryOperation): ReplyDisposition {
    switch (this.mode.kind) {
      case DeliveryModeKind.Live:
        return ReplyDisposition.Deliver
      case DeliveryModeKind.Held:
        switch (this.mode.type === type) {
          case true:
            return ReplyDisposition.Hold
          case false:
            return ReplyDisposition.Deliver
        }
        break
      case DeliveryModeKind.Unavailable:
        switch (this.mode.type === type) {
          case true:
            return ReplyDisposition.Unavailable
          case false:
            return ReplyDisposition.Deliver
        }
    }
  }
  deliver(reply: BrowserReply): void {
    switch (this.disposition(reply.type)) {
      case ReplyDisposition.Deliver:
        reply.callback(reply.value)
        return
      case ReplyDisposition.Hold:
        this.pending.push(reply)
        return
      case ReplyDisposition.Unavailable: {
        const value: BrowserDelivery = { ok: false }
        reply.callback(value)
      }
    }
  }
  sendMessage(
    message: BrowserMessage,
    callback: (value: BrowserDelivery) => void,
  ): void {
    this.delivered.push(message.type)
    const request: ReplyRequest = { fixture: this, message, callback }
    const reply = new ChecklistBrowserReply(request)
    switch (message.type) {
      case AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify: {
        const classification: AuthenticationOutcomeClassification = {
          observation: message.payload.observation,
          timeoutMs: message.payload.timeoutMs,
        }
        const verdict =
          classify_companion_authentication_outcome(classification)
        const value: AuthenticationOutcomeResponseWire = { ok: true, verdict }
        reply.deliver(value)
        return
      }
      case GoogleLoginContinuationMessageType.Session:
      case CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist:
      case CompanionWasmSessionMessageType.ClassifyLoginSaveOutcome:
      case CompanionWasmSessionMessageType.ClassifyFocusedCredentialField:
      case CompanionWasmSessionMessageType.RevalidateFocusedCredentialField:
      case CompanionWasmSessionMessageType.GetAuthenticationActivityProgress:
      case CompanionWasmSessionMessageType.ExtractAuthenticationBackupCodeCandidates:
      case CompanionWasmSessionMessageType.ProjectAuthenticationNavigationPath:
      case CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation:
      case CompanionWasmSessionMessageType.AuthenticationWorkflowPilotPresentationCapability:
      case CompanionWasmSessionMessageType.PasswordWorkflowActivity:
      case CompanionWasmSessionMessageType.BindAuthenticationPageObservationFacts:
      case CompanionWasmSessionMessageType.AuthenticationPageObservationFactsMatchBinding:
      case CompanionWasmSessionMessageType.AuthenticationEnrollmentWorkflowMatch:
      case CompanionWasmSessionMessageType.HasLoginContext:
      case CompanionWasmSessionMessageType.ClassifyPageInputField:
      case CompanionWasmSessionMessageType.ClassifyPageInputs:
      case CompanionWasmSessionMessageType.LooksLikeLoginAdvanceControlLabel:
      case CompanionWasmSessionMessageType.LooksLikeManualCheckpointLabel:
      case CompanionWasmSessionMessageType.LooksLikePasskeyControlLabel:
      case CompanionWasmSessionMessageType.LooksLikeEmailVerificationBody:
      case CompanionWasmSessionMessageType.LooksLikeOneTimeCodeAutoSubmitSignal:
      case CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence:
      case CompanionWasmSessionMessageType.IsNookVaultAppUrl:
      case CompanionWasmSessionMessageType.DecodeAuthenticationWorkflowRuntimeResponse:
      case CompanionWasmSessionMessageType.DecodeContentRuntimeResponse:
      case CompanionWasmSessionMessageType.EvaluateAuthenticationPolicies:
      case CompanionWasmSessionMessageType.RevalidateApprovedAuthenticationWorkflow:
        void handleCompanionWasmMessage(message).then(
          reply.complete.bind(reply),
        )
    }
  }
}

type ChecklistChromeFixture = {
  runtime: { sendMessage: ChecklistBrowserFixture['sendMessage'] }
  i18n: Pick<typeof chrome.i18n, 'getMessage'>
}
enum OutcomeScopeCase {
  ConcreteUnowned = 'concrete-unowned',
  Body = 'body',
  Document = 'document',
  DocumentElement = 'document-element',
  Detached = 'detached',
  Unrelated = 'unrelated',
}
enum PendingStage {
  Classification = 'classification',
  Projection = 'projection',
}
enum SpaTransition {
  FormRemoved = 'form-removed',
  PathChanged = 'path-changed',
}
enum ProjectionPhase {
  Initialize = 'initialize',
  Activity = 'activity',
}
enum MountInvalidation {
  Control = 'control',
  Hud = 'hud',
}

class MountedChecklistFixture {
  readonly body = document.createElement('div')
  readonly form = document.createElement('form')
  readonly title = document.createElement('h1')
  readonly description = document.createElement('p')
  readonly control = document.createElement('button')
  readonly workflow: PasswordFormObservation
  readonly progress: LoginChecklistProgress

  constructor() {
    this.body.append(this.title, this.description, this.control)
    document.body.append(this.form, this.body)
    this.workflow = {
      root: document,
      formScope: { kind: PasswordFormScopeKind.Owned, owner: this.form },
      summary: emptyPasswordFormSummary,
    }
    const mount: ConstructorParameters<typeof LoginChecklistProgress>[0] = {
      surface: {
        body: this.body,
        title: this.title,
        description: this.description,
      },
      control: this.control,
      workflow: this.workflow,
    }
    this.progress = new LoginChecklistProgress(mount)
  }
  get currentRows() {
    return this.body.querySelectorAll('[aria-current="step"]')
  }
  get list() {
    return this.body.querySelector('ol')
  }
  assertComplete(): void {
    expect(this.list?.dataset.status).toBe('Complete')
  }
  assertAttention(): void {
    expect(this.list?.dataset.status).toBe('Attention')
  }
  assertUnavailable(): void {
    expect(this.list?.hidden).toBe(true)
    expect(this.currentRows).toHaveLength(0)
    expect(this.description.textContent).toBe('widgetManualDescription')
  }
  addSuccess(): void {
    const marker = document.createElement('p')
    marker.dataset.nookAuthOutcome = 'success'
    document.body.append(marker)
  }
  addError(boundary: Element): void {
    const marker = document.createElement('p')
    marker.setAttribute('role', 'alert')
    boundary.append(marker)
  }
  transition(transition: SpaTransition): void {
    switch (transition) {
      case SpaTransition.FormRemoved:
        this.form.remove()
        return
      case SpaTransition.PathChanged: {
        const state: Parameters<typeof history.replaceState>[0] = {}
        history.replaceState(state, '', '/checklist-new-stage')
      }
    }
  }
  invalidate(reason: MountInvalidation): void {
    switch (reason) {
      case MountInvalidation.Control:
        this.control.remove()
        return
      case MountInvalidation.Hud:
        this.body.remove()
    }
  }
}

type HeldProjectionInvalidation = {
  phase: ProjectionPhase
  invalidation: MountInvalidation
}
enum ChecklistFixturePreparationKind {
  Unprepared = 'unprepared',
  Prepared = 'prepared',
}
type ChecklistFixturePreparation =
  | { kind: ChecklistFixturePreparationKind.Unprepared }
  | {
      kind: ChecklistFixturePreparationKind.Prepared
      mounted: MountedChecklistFixture
    }
enum ChecklistFixtureFailureCode {
  NotPrepared = 'fixture-not-prepared',
}
class ChecklistFixtureFailure extends Error {
  readonly code = ChecklistFixtureFailureCode.NotPrepared
  constructor(readonly context: ChecklistFixturePreparationKind.Unprepared) {
    super(ChecklistFixtureFailureCode.NotPrepared)
  }
}
class ChecklistLifecycleTests {
  browser = new ChecklistBrowserFixture()
  private preparation: ChecklistFixturePreparation = {
    kind: ChecklistFixturePreparationKind.Unprepared,
  }
  get mounted(): MountedChecklistFixture {
    switch (this.preparation.kind) {
      case ChecklistFixturePreparationKind.Prepared:
        return this.preparation.mounted
      case ChecklistFixturePreparationKind.Unprepared:
        throw new ChecklistFixtureFailure(this.preparation.kind)
    }
  }
  set mounted(mounted: MountedChecklistFixture) {
    this.preparation = {
      kind: ChecklistFixturePreparationKind.Prepared,
      mounted,
    }
  }
  setup(): void {
    document.body.replaceChildren()
    this.browser = new ChecklistBrowserFixture()
    const fixture: ChecklistChromeFixture = {
      runtime: { sendMessage: this.browser.sendMessage.bind(this.browser) },
      i18n: { getMessage: this.message },
    }
    vi.stubGlobal('chrome', fixture)
    this.mounted = new MountedChecklistFixture()
  }
  message(key: string): string {
    return key
  }
  cleanup(): void {
    switch (this.preparation.kind) {
      case ChecklistFixturePreparationKind.Prepared:
        this.preparation.mounted.progress.cancel()
        break
      case ChecklistFixturePreparationKind.Unprepared:
        break
    }
    this.preparation = { kind: ChecklistFixturePreparationKind.Unprepared }
    vi.unstubAllGlobals()
    const state: Parameters<typeof history.replaceState>[0] = {}
    history.replaceState(state, '', '/')
    document.body.replaceChildren()
  }
  private async settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  async manualAndRejected(): Promise<void> {
    await this.mounted.progress.initialize()
    await this.mounted.progress.activity('Filling')
    await this.mounted.progress.activity('SubmissionUnobserved')
    expect(this.mounted.currentRows[0]?.getAttribute('data-step')).toBe(
      'SubmitForm',
    )
    await this.mounted.progress.activity('SubmissionRejected')
    expect(this.mounted.currentRows).toHaveLength(0)
    expect(this.browser.delivered).not.toContain(
      AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
    )
  }
  scopedSignals(): void {
    this.mounted.addError(document.body)
    const context: Parameters<
      typeof authenticationOutcomeObservation.collectOutcomeObservation
    >[0] = {
      startedAt: Date.now(),
      authPath: location.pathname,
      sawMutation: true,
    }
    const request: Parameters<
      typeof authenticationOutcomeObservation.collectWorkflowOutcomeObservation
    >[0] = { context, workflow: this.mounted.workflow }
    expect(
      authenticationOutcomeObservation.collectWorkflowOutcomeObservation(
        request,
      ).errorMarkerPresent,
    ).toBe(false)
    expect(
      authenticationOutcomeObservation.collectOutcomeObservation(context)
        .errorMarkerPresent,
    ).toBe(true)
    this.mounted.addError(this.mounted.form)
    expect(
      authenticationOutcomeObservation.collectWorkflowOutcomeObservation(
        request,
      ).errorMarkerPresent,
    ).toBe(true)
    this.mounted.addSuccess()
    expect(
      authenticationOutcomeObservation.collectWorkflowOutcomeObservation(
        request,
      ).successMarkerPresent,
    ).toBe(true)
    expect(
      authenticationOutcomeObservation.collectOutcomeObservation(context)
        .errorMarkerPresent,
    ).toBe(true)
  }
  async attributableError(): Promise<void> {
    this.mounted.addError(this.mounted.form)
    await this.mounted.progress.activity('Submitted')
    await vi.waitFor(this.mounted.assertAttention.bind(this.mounted))
    expect(this.mounted.currentRows).toHaveLength(0)
    expect(
      this.mounted.body
        .querySelector('[data-step="CheckResult"]')
        ?.getAttribute('data-state'),
    ).toBe('Attention')
  }
  async siblingError(): Promise<void> {
    this.mounted.addError(document.body)
    await this.mounted.progress.activity('Submitted')
    await vi.waitFor(this.browser.assertClassified.bind(this.browser))
    expect(this.mounted.list?.dataset.status).toBe('Waiting')
    expect(this.mounted.currentRows[0]?.getAttribute('data-step')).toBe(
      'CheckResult',
    )
  }
  async scopeOutcome(scopeCase: OutcomeScopeCase): Promise<void> {
    this.mounted.progress.cancel()
    const container = document.createElement('main')
    document.body.append(container)
    let root: PasswordFormObservation['root'] = container
    switch (scopeCase) {
      case OutcomeScopeCase.Body:
        root = document.body
        this.mounted.addError(document.body)
        break
      case OutcomeScopeCase.Document:
        root = document
        this.mounted.addError(document.body)
        break
      case OutcomeScopeCase.DocumentElement:
        root = document.documentElement
        this.mounted.addError(document.body)
        break
      case OutcomeScopeCase.Detached:
        container.remove()
        this.mounted.addError(container)
        break
      case OutcomeScopeCase.Unrelated:
        this.mounted.addError(document.body)
        break
      case OutcomeScopeCase.ConcreteUnowned:
        this.mounted.addError(container)
        break
    }
    const workflow: PasswordFormObservation = {
      root,
      formScope: { kind: PasswordFormScopeKind.Unowned },
      summary: emptyPasswordFormSummary,
    }
    const mount: ConstructorParameters<typeof LoginChecklistProgress>[0] = {
      surface: {
        body: this.mounted.body,
        title: this.mounted.title,
        description: this.mounted.description,
      },
      control: this.mounted.control,
      workflow,
    }
    const progress = new LoginChecklistProgress(mount)
    await progress.activity('Submitted')
    await vi.waitFor(this.browser.assertClassified.bind(this.browser))
    await this.settle()
    switch (scopeCase) {
      case OutcomeScopeCase.ConcreteUnowned:
        expect(this.mounted.list?.dataset.status).toBe('Attention')
        break
      case OutcomeScopeCase.Body:
      case OutcomeScopeCase.Document:
      case OutcomeScopeCase.DocumentElement:
      case OutcomeScopeCase.Detached:
      case OutcomeScopeCase.Unrelated:
        expect(this.mounted.list?.dataset.status).toBe('Waiting')
        break
    }
    progress.cancel()
  }
  async pendingTakeover(stage: PendingStage): Promise<void> {
    this.mounted.addSuccess()
    switch (stage) {
      case PendingStage.Classification:
        this.browser.hold(
          AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
        )
        break
      case PendingStage.Projection:
        break
    }
    await this.mounted.progress.activity('Submitted')
    switch (stage) {
      case PendingStage.Classification:
        break
      case PendingStage.Projection:
        this.browser.hold(
          CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist,
        )
        break
    }
    await vi.waitFor(this.browser.assertPending.bind(this.browser))
    this.mounted.progress.cancel()
    const before = this.mounted.body.innerHTML
    this.browser.release()
    await this.settle()
    expect(this.mounted.body.innerHTML).toBe(before)
    expect(this.mounted.list?.dataset.status).not.toBe('Complete')
  }
  async retainedHudSuccess(transition: SpaTransition): Promise<void> {
    this.browser.hold(
      AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
    )
    this.mounted.addSuccess()
    this.mounted.addError(this.mounted.form)
    // Detach before collection so the old alert cannot poison supported document success.
    switch (transition) {
      case SpaTransition.FormRemoved:
        this.mounted.form.remove()
        break
      case SpaTransition.PathChanged:
        this.mounted.form.replaceChildren()
        break
    }
    await this.mounted.progress.activity('Submitted')
    await vi.waitFor(this.browser.assertPending.bind(this.browser))
    this.mounted.transition(transition)
    this.browser.release()
    await vi.waitFor(this.mounted.assertComplete.bind(this.mounted))
    expect(this.mounted.control.isConnected).toBe(true)
  }
  async transitionAfterClassification(
    transition: SpaTransition,
  ): Promise<void> {
    this.browser.hold(
      AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
    )
    this.mounted.addSuccess()
    await this.mounted.progress.activity('Submitted')
    await vi.waitFor(this.browser.assertPending.bind(this.browser))
    this.mounted.transition(transition)
    this.browser.release()
    await vi.waitFor(this.mounted.assertComplete.bind(this.mounted))
  }
  async replacementWithoutMarker(): Promise<void> {
    await this.mounted.progress.activity('Submitted')
    await vi.waitFor(this.browser.assertClassified.bind(this.browser))
    const replacement = document.createElement('form')
    this.mounted.form.replaceWith(replacement)
    await this.settle()
    expect(this.mounted.list?.dataset.status).toBe('Waiting')
    expect(
      this.mounted.body
        .querySelector('[data-step="CheckResult"]')
        ?.getAttribute('data-state'),
    ).not.toBe('Done')
  }
  async newFill(): Promise<void> {
    this.browser.hold(
      AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
    )
    this.mounted.addSuccess()
    await this.mounted.progress.activity('Submitted')
    await vi.waitFor(this.browser.assertPending.bind(this.browser))
    await this.mounted.progress.activity('Filling')
    this.browser.release()
    await this.settle()
    expect(this.mounted.list?.dataset.status).toBe('Working')
    expect(this.mounted.currentRows[0]?.getAttribute('data-step')).toBe(
      'FillLogin',
    )
  }
  async remount(): Promise<void> {
    widgetState.attachHost(this.mounted.body)
    widgetState.loginChecklist = {
      kind: LoginChecklistMountKind.Mounted,
      progress: this.mounted.progress,
    }
    this.browser.hold(
      AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
    )
    this.mounted.addSuccess()
    await this.mounted.progress.activity('Submitted')
    await vi.waitFor(this.browser.assertPending.bind(this.browser))
    const removed = this.mounted
    widgetState.clearRenderedWidget()
    this.mounted = new MountedChecklistFixture()
    await this.mounted.progress.initialize()
    this.browser.release()
    await this.settle()
    expect(removed.body.isConnected).toBe(false)
    expect(removed.currentRows).toHaveLength(0)
    expect(this.mounted.list?.dataset.status).toBe('Ready')
  }
  async unavailable(stage: PendingStage): Promise<void> {
    switch (stage) {
      case PendingStage.Projection:
        this.browser.unavailable(
          CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist,
        )
        await this.mounted.progress.activity('Filling')
        break
      case PendingStage.Classification:
        this.browser.unavailable(
          AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
        )
        await this.mounted.progress.activity('Submitted')
    }
    await vi.waitFor(this.mounted.assertUnavailable.bind(this.mounted))
  }
  async heldProjectionInvalidation(
    request: HeldProjectionInvalidation,
  ): Promise<void> {
    await this.mounted.progress.activity('Filling')
    this.browser.hold(
      CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist,
    )
    let pending: Promise<void>
    switch (request.phase) {
      case ProjectionPhase.Initialize:
        pending = this.mounted.progress.initialize()
        break
      case ProjectionPhase.Activity:
        pending = this.mounted.progress.activity('Submitted')
        break
    }
    await vi.waitFor(this.browser.assertPending.bind(this.browser))
    this.mounted.invalidate(request.invalidation)
    this.browser.release()
    await pending
    this.mounted.assertUnavailable()
    expect(this.mounted.list?.dataset.status).not.toBe('Ready')
    expect(this.browser.delivered).not.toContain(
      AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
    )
  }
  register(): void {
    test(
      'manual and rejected submission never begin result classification',
      this.manualAndRejected.bind(this),
    )
    test(
      'scopes generic errors while preserving document success and save collector',
      this.scopedSignals.bind(this),
    )
    test(
      'Rust stops on attributable form error without success',
      this.attributableError.bind(this),
    )
    test(
      'unattributable sibling error stays waiting',
      this.siblingError.bind(this),
    )
    test.each(Object.values(OutcomeScopeCase))(
      'real Rust outcome for scope %s',
      this.scopeOutcome.bind(this),
    )
    test.each(Object.values(PendingStage))(
      'takeover ignores pending %s success',
      this.pendingTakeover.bind(this),
    )
    test.each(Object.values(SpaTransition))(
      'retained HUD confirms explicit success across %s',
      this.retainedHudSuccess.bind(this),
    )
    test.each(Object.values(SpaTransition))(
      'retained HUD applies pending actual success across %s',
      this.transitionAfterClassification.bind(this),
    )
    test(
      'same-path replacement without explicit marker remains unconfirmed',
      this.replacementWithoutMarker.bind(this),
    )
    test('new actual fill invalidates pending result', this.newFill.bind(this))
    test(
      'real remount cleanup ignores old classification',
      this.remount.bind(this),
    )
    test.each(Object.values(PendingStage))(
      'unavailable %s clears active rows',
      this.unavailable.bind(this),
    )
    const cases: Parameters<
      ChecklistLifecycleTests['heldProjectionInvalidation']
    >[0][] = [
      {
        phase: ProjectionPhase.Initialize,
        invalidation: MountInvalidation.Control,
      },
      {
        phase: ProjectionPhase.Initialize,
        invalidation: MountInvalidation.Hud,
      },
      {
        phase: ProjectionPhase.Activity,
        invalidation: MountInvalidation.Control,
      },
      { phase: ProjectionPhase.Activity, invalidation: MountInvalidation.Hud },
    ]
    test.each(cases)(
      'held projection clears invalidated mount $phase/$invalidation',
      this.heldProjectionInvalidation.bind(this),
    )
  }
}
const lifecycle = new ChecklistLifecycleTests()
beforeEach(lifecycle.setup.bind(lifecycle))
afterEach(lifecycle.cleanup.bind(lifecycle))
describe(
  'shipping login checklist lifecycle through real Rust transport',
  lifecycle.register.bind(lifecycle),
)
