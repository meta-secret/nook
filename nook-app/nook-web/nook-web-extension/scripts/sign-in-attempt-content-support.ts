import { expect } from 'bun:test'
import { Window } from 'happy-dom'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import type {
  SignInAttemptActionOffer,
  SignInAttemptEvent,
  SignInAttemptPageEvidence,
  SignInAttemptPresentation,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  PasswordFormScopeKind,
  passwordFormInteraction,
} from '../../nook-web-shared/src/extension/password-forms'
import { emptyPasswordFormSummary } from '../../nook-web-shared/src/extension/password-form-summary-state'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import {
  SignInAttemptFailureReason,
  SignInAttemptMessageType,
  SignInAttemptOperation,
  SignInAttemptViewKind,
  type SignInAttemptMessage,
  type SignInAttemptRuntimeResponse,
} from '../src/lib/sign-in-attempt-messages'
import { handleCompanionWasmMessage } from '../src/offscreen/session-companion-wasm-operations'
import { LoginChecklistProgress } from '../src/content/autofill/login-checklist-progress'
import { LoginChecklistRendering } from '../src/content/autofill/login-checklist-rendering'
import { SignInAttemptRendering } from '../src/content/autofill/sign-in-attempt-rendering'
import {
  SignInAttemptPhaseKind,
  signInAttemptSession,
  type SignInAttemptHostAction,
} from '../src/content/autofill/sign-in-attempt-session'
import { workflowUi } from '../src/content/autofill/workflow-ui'
import {
  SignInAttemptRouteFixture,
  type SignInAttemptSenderFixture,
} from './sign-in-attempt-test-support'

await companionWasmReady

export type ContentRuntimeMessage =
  CompanionWasmRuntimeMessage | SignInAttemptMessage
export type ChecklistProjectionResult = Awaited<
  ReturnType<typeof handleCompanionWasmMessage>
>
export type ContentRuntimeReply =
  | SignInAttemptRuntimeResponse
  | BrowserRuntimeMessageValue
  | {
      readonly ok: true
      readonly result: Parameters<
        Parameters<ChecklistProjectionResult['match']>[0]
      >[0]
    }
export type RuntimeReply = (response: ContentRuntimeReply) => void
export type ContentGlobals = Pick<
  Window,
  | 'document'
  | 'location'
  | 'Element'
  | 'HTMLElement'
  | 'HTMLAnchorElement'
  | 'HTMLDivElement'
  | 'HTMLHeadingElement'
  | 'HTMLParagraphElement'
  | 'HTMLButtonElement'
  | 'HTMLInputElement'
  | 'HTMLFormElement'
  | 'MutationObserver'
  | 'Node'
  | 'NodeFilter'
  | 'ShadowRoot'
  | 'getComputedStyle'
  | 'requestAnimationFrame'
> & { window: Window }
export type PilotSurface = {
  readonly body: HTMLDivElement
  readonly step: HTMLParagraphElement
  readonly title: HTMLHeadingElement
  readonly description: HTMLParagraphElement
  readonly control: HTMLButtonElement
}
export type EvidenceRequest = {
  readonly message: string
  readonly authFields: boolean
  readonly success: boolean
  readonly resetLink: boolean
}
export type PilotTextRequest = {
  readonly surface: PilotSurface
  readonly testId: string
}

export const loginPage = 'https://www.namecheap.com/myaccount/login/'
export const topFrame: SignInAttemptSenderFixture = {
  tab: 7,
  frameId: 0,
  url: loginPage,
  extensionId: SignInAttemptRouteFixture.EXTENSION_ID,
}
export const lockText =
  'Your account has been locked for 24 hours for three consecutive failed password or username entry attempts. Please use Password Reset option. <b>Once</b> the password is reset your account will be unlocked automatically.'

/**
 * One content document wired to the real service-worker route (simulated
 * session storage, real companion WASM) and the real offscreen checklist
 * projection; chrome i18n returns the message key so assertions name keys.
 */
export class SignInAttemptContentFixture {
  projections = 0
  /** The top-level frame every fixture request is sent from. */
  sender: SignInAttemptSenderFixture = topFrame
  /** Follow-ups the mounted login Pilot was asked to run. */
  readonly runs: SignInAttemptHostAction[] = []
  /** Runs as a sign-in request reaches the service worker, before Rust answers. */
  beforeDelivery: (message: SignInAttemptMessage) => void = () => {}
  /** The attempt owner answers as unreachable. */
  ownerUnavailable = false
  private readonly browser = new Window({ url: loginPage })
  private readonly mounted: LoginChecklistProgress[] = []

  private constructor(readonly route: SignInAttemptRouteFixture) {}

  static async create(): Promise<SignInAttemptContentFixture> {
    const fixture = new SignInAttemptContentFixture(
      await SignInAttemptRouteFixture.create(),
    )
    fixture.install()
    return fixture
  }

  dispose(): void {
    for (const progress of this.mounted) progress.cancel()
    workflowUi.removeWidget()
  }

  private install(): void {
    const browser = this.browser
    const globals: ContentGlobals = {
      window: browser,
      document: browser.document,
      location: browser.location,
      Element: browser.Element,
      HTMLElement: browser.HTMLElement,
      HTMLAnchorElement: browser.HTMLAnchorElement,
      HTMLDivElement: browser.HTMLDivElement,
      HTMLHeadingElement: browser.HTMLHeadingElement,
      HTMLParagraphElement: browser.HTMLParagraphElement,
      HTMLButtonElement: browser.HTMLButtonElement,
      HTMLInputElement: browser.HTMLInputElement,
      HTMLFormElement: browser.HTMLFormElement,
      MutationObserver: browser.MutationObserver,
      Node: browser.Node,
      NodeFilter: browser.NodeFilter,
      ShadowRoot: browser.ShadowRoot,
      getComputedStyle: browser.getComputedStyle.bind(browser),
      requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    }
    Object.assign(globalThis, globals)
    Object.assign(globalThis.chrome, {
      i18n: { getMessage: (key: string) => key },
    })
    Object.assign(globalThis.chrome.runtime, {
      lastError: false,
      sendMessage: this.sendMessage.bind(this),
      getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
    })
  }

  private sendMessage(
    message: ContentRuntimeMessage,
    reply?: RuntimeReply,
  ): Promise<ContentRuntimeReply> {
    const delivery = this.deliver(message)
    void delivery.then((response) => reply?.(response))
    return delivery
  }

  private async deliver(
    message: ContentRuntimeMessage,
  ): Promise<ContentRuntimeReply> {
    switch (true) {
      case message.type === SignInAttemptMessageType.Session:
        return this.session(message)
      case message.type ===
        CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist:
        this.projections += 1
        return this.companion(message)
      case true:
        break
    }
    return this.companion(message)
  }

  private async session(
    message: SignInAttemptMessage,
  ): Promise<ContentRuntimeReply> {
    this.beforeDelivery(message)
    switch (this.ownerUnavailable) {
      case true:
        return SignInAttemptContentFixture.UNAVAILABLE
      case false:
        break
    }
    return this.route.respond({ message, sender: this.sender })
  }

  static readonly UNAVAILABLE: SignInAttemptRuntimeResponse = {
    ok: false,
    reason: SignInAttemptFailureReason.Unavailable,
  }

  private async companion(
    message: CompanionWasmRuntimeMessage,
  ): Promise<ContentRuntimeReply> {
    // Pairing and vault-state requests have no offscreen WASM handler here.
    const result: ChecklistProjectionResult | undefined =
      await handleCompanionWasmMessage(message)
    switch (result) {
      case undefined:
        return { ok: false }
      default:
        break
    }
    return result.match(
      (value) => ({ ok: true, result: value }),
      () => ({ ok: false }),
    )
  }

  advance(event: SignInAttemptEvent): Promise<SignInAttemptRuntimeResponse> {
    const message: SignInAttemptMessage = {
      type: SignInAttemptMessageType.Session,
      payload: { operation: SignInAttemptOperation.Advance, event },
    }
    return this.route.respond({ message, sender: this.sender })
  }

  /** Drives the real route through Begin, fill and submit, then one observed page. */
  async observedAfterSubmit(
    page: SignInAttemptPageEvidence,
  ): Promise<SignInAttemptRuntimeResponse> {
    const begin: SignInAttemptMessage = {
      type: SignInAttemptMessageType.Session,
      payload: {
        operation: SignInAttemptOperation.Begin,
        login: 'store_a/secret_b',
      },
    }
    await this.route.respond({ message: begin, sender: topFrame })
    await this.advance({ kind: 'Activity', activity: { kind: 'Filled' } })
    await this.advance({
      kind: 'Activity',
      activity: {
        kind: 'Submitted',
        baseline: {
          messages: [],
          auth_fields: {
            username_present: true,
            current_password_present: true,
            one_time_code_present: false,
          },
          controls: ['Sign in  '],
        },
      },
    })
    return this.advance({ kind: 'PageObserved', page })
  }

  /** The reloaded login document: the plain styled banner above the form. */
  loginDocument(): void {
    document.body.innerHTML = `<main><section class="login-card">
      <div class="login-notice" style="color: rgb(179, 0, 27); background-color: rgb(251, 232, 236)">Your account has been locked for 24 hours for three consecutive failed password or username entry attempts. Please use <a href="/myaccount/login/password-reset/">Password Reset</a> option. Once the password is reset your account will be unlocked automatically.</div>
      <form method="post" action="/myaccount/login/">
        <input name="LoginUserName" type="text" autocomplete="username">
        <input name="LoginPassword" type="password" autocomplete="current-password">
        <button type="submit">Sign in</button>
      </form></section></main>`
  }

  /** A verification step: one one-time-code field and no password. */
  oneTimeCodeDocument(): void {
    document.body.innerHTML = `<main><form method="post" action="/myaccount/login/verify/">
      <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code">
      <button type="submit">Verify</button>
      </form></main>`
  }

  /** A signed-in site page with no login form, reached outside the Pilot. */
  dashboardDocument(): void {
    document.body.innerHTML = `<main><h1>Dashboard</h1>
      <p>Welcome back. Your domains are listed below.</p>
      <button type="button">Sign out</button></main>`
  }

  /** The standalone Pilot's panel inside its shadow host. */
  pageWidget(): PilotSurface {
    const host = document.getElementById('nook-auth-widget')
    const panel = host?.shadowRoot?.querySelector(
      '[data-testid="nook-auth-gate"]',
    )
    if (!(panel instanceof HTMLDivElement))
      throw new Error('expected the standalone sign-in Pilot')
    const title = panel.querySelector('h2, h1')
    const description = panel.querySelector('p.description')
    const control = panel.querySelector('button')
    const step = panel.querySelector('.step-label')
    if (
      !(title instanceof HTMLHeadingElement) ||
      !(description instanceof HTMLParagraphElement) ||
      !(control instanceof HTMLButtonElement)
    )
      throw new Error('expected the standalone Pilot copy')
    if (!(step instanceof HTMLParagraphElement))
      throw new Error('expected the standalone Pilot step counter')
    return { body: panel, step, title, description, control }
  }

  /** A Pilot surface outside the page body, like the widget's shadow host. */
  surface(): PilotSurface {
    const body = document.createElement('div')
    const step = document.createElement('p')
    step.textContent = 'widgetPilotLabel · 1/3'
    const title = document.createElement('h1')
    title.textContent = 'Ready to sign in'
    const description = document.createElement('p')
    description.textContent = 'One saved login matches this site.'
    const control = document.createElement('button')
    control.type = 'button'
    control.textContent = 'Sign in'
    body.append(step, title, description, control)
    document.documentElement.append(body)
    return { body, step, title, description, control }
  }

  progress(surface: PilotSurface): LoginChecklistProgress {
    const progress = new LoginChecklistProgress({
      surface,
      progress: {
        step: surface.step,
        fresh: { currentStep: 1, totalSteps: 3 },
      },
      control: surface.control,
      workflow: {
        root: document,
        formScope: { kind: PasswordFormScopeKind.Unowned },
        summary: emptyPasswordFormSummary,
      },
      attemptActions: {
        run: (action) => {
          this.runs.push(action)
        },
      },
    })
    this.mounted.push(progress)
    return progress
  }

  rendering(surface: PilotSurface): SignInAttemptRendering {
    const request: ConstructorParameters<typeof SignInAttemptRendering>[0] = {
      surface: { ...surface, continueButton: surface.control },
      checklist: new LoginChecklistRendering(surface),
      choose: () => {},
    }
    return new SignInAttemptRendering(request)
  }
}

/** The fill path's policy hints, prepared before a synchronous capture. */
export class SignInAttemptEvidenceFixtureHints {
  static readonly HINTS: Parameters<
    typeof passwordFormInteraction.prepareCompanionWorkflowPolicies
  >[0] = { authenticatorSetupHint: 'absent', backupCodesHint: false }
}

export class EvidenceFixture {
  static page(request: EvidenceRequest): SignInAttemptPageEvidence {
    const messages: SignInAttemptPageEvidence['messages'] = [
      {
        text: request.message,
        source: 'Container',
        placement: 'NearAuthForm',
        tokens: ['login-notice'],
        ancestor_tokens: ['login-card'],
        foreground: { red: 179, green: 0, blue: 27 },
        background: { red: 251, green: 232, blue: 236 },
        changed_since_submit: false,
      },
    ]
    const links: SignInAttemptPageEvidence['links'] = [
      {
        index: 0,
        text: 'Password Reset',
        href: 'https://www.namecheap.com/myaccount/login/password-reset/',
      },
    ]
    return {
      document: 'NewDocument',
      auth_fields: {
        username_present: request.authFields,
        current_password_present: request.authFields,
        one_time_code_present: false,
      },
      manual_checkpoint_present: false,
      success_marker_present: request.success,
      error_marker_present: false,
      controls: ['Sign in  '],
      messages: messages.filter((message) => message.text.length > 0),
      links: links.filter(() => request.resetLink),
    }
  }
}

export class PilotExpectation {
  static presentation(
    response: SignInAttemptRuntimeResponse,
  ): SignInAttemptPresentation {
    switch (response.ok) {
      case false:
        throw new Error(`expected a presentation, received ${response.reason}`)
      case true:
        break
    }
    switch (response.attempt.kind) {
      case SignInAttemptViewKind.None:
        throw new Error('expected a presentation, received no attempt')
      case SignInAttemptViewKind.Presented:
        return response.attempt.presentation
    }
  }

  static actions(surface: PilotSurface): string[] {
    return Array.from(
      surface.body.querySelectorAll(
        '[data-testid="nook-sign-in-actions"] button',
      ),
    ).map((button) => String(button.textContent))
  }

  static text(request: PilotTextRequest): string {
    return String(
      request.surface.body.querySelector(`[data-testid="${request.testId}"]`)
        ?.textContent,
    )
  }

  /** The presented offer of one action, as the Pilot's button would choose it. */
  static offer(
    action: SignInAttemptActionOffer['action'],
  ): SignInAttemptActionOffer {
    const phase = signInAttemptSession.phase
    switch (phase.kind) {
      case SignInAttemptPhaseKind.Fresh:
      case SignInAttemptPhaseKind.Unavailable:
        throw new Error('expected a presented attempt')
      case SignInAttemptPhaseKind.Presented:
        break
    }
    const offer = phase.presentation.actions.find(
      (candidate) => candidate.action === action,
    )
    if (!offer) throw new Error(`expected the ${String(action)} offer`)
    return offer
  }

  static button(request: PilotTextRequest): HTMLButtonElement {
    const button = Array.from(
      request.surface.body.querySelectorAll(
        '[data-testid="nook-sign-in-actions"] button',
      ),
    ).find((candidate) => candidate.textContent === request.testId)
    if (!(button instanceof HTMLButtonElement))
      throw new Error(`expected the ${request.testId} button`)
    return button
  }

  /** Waits for the session's evidence report to re-render the Pilot. */
  static async eventually(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(condition()).toBe(true)
  }
}
