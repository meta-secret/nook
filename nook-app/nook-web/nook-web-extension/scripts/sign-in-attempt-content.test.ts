import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import type {
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
} from '../src/content/autofill/sign-in-attempt-session'
import {
  SignInAttemptWidgetDisplay,
  signInAttemptPageWidget,
} from '../src/content/autofill/sign-in-attempt-widget'
import {
  SignInAttemptObservation,
  SignInAttemptObservationKind,
  type SignInAttemptObservationContext,
} from '../src/content/autofill/sign-in-attempt-observation'
import { workflowUi } from '../src/content/autofill/workflow-ui'
import {
  SignInAttemptRouteFixture,
  type SignInAttemptSenderFixture,
} from './sign-in-attempt-test-support'

await companionWasmReady

type ContentRuntimeMessage = CompanionWasmRuntimeMessage | SignInAttemptMessage
type ChecklistProjectionResult = Awaited<
  ReturnType<typeof handleCompanionWasmMessage>
>
type ContentRuntimeReply =
  | SignInAttemptRuntimeResponse
  | BrowserRuntimeMessageValue
  | {
      readonly ok: true
      readonly result: Parameters<
        Parameters<ChecklistProjectionResult['match']>[0]
      >[0]
    }
type RuntimeReply = (response: ContentRuntimeReply) => void
type ContentGlobals = Pick<
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
  | 'NodeFilter'
  | 'ShadowRoot'
  | 'getComputedStyle'
  | 'requestAnimationFrame'
> & { window: Window }
type PilotSurface = {
  readonly body: HTMLDivElement
  readonly step: HTMLParagraphElement
  readonly title: HTMLHeadingElement
  readonly description: HTMLParagraphElement
  readonly control: HTMLButtonElement
}
type EvidenceRequest = {
  readonly message: string
  readonly authFields: boolean
  readonly success: boolean
  readonly resetLink: boolean
}
type PilotTextRequest = {
  readonly surface: PilotSurface
  readonly testId: string
}

const loginPage = 'https://www.namecheap.com/myaccount/login/'
const topFrame: SignInAttemptSenderFixture = {
  tab: 7,
  frameId: 0,
  url: loginPage,
  extensionId: SignInAttemptRouteFixture.EXTENSION_ID,
}
const lockText =
  'Your account has been locked for 24 hours for three consecutive failed password or username entry attempts. Please use Password Reset option. <b>Once</b> the password is reset your account will be unlocked automatically.'

/**
 * One content document wired to the real service-worker route (simulated
 * session storage, real companion WASM) and the real offscreen checklist
 * projection; chrome i18n returns the message key so assertions name keys.
 */
class SignInAttemptContentFixture {
  projections = 0
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
        return this.route.respond({ message, sender: topFrame })
      case message.type ===
        CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist:
        this.projections += 1
        return this.companion(message)
      case true:
        break
    }
    return this.companion(message)
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
    return this.route.respond({ message, sender: topFrame })
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
    const description = panel.querySelector('p')
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
      attemptActions: { run: () => {} },
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
class SignInAttemptEvidenceFixtureHints {
  static readonly HINTS: Parameters<
    typeof passwordFormInteraction.prepareCompanionWorkflowPolicies
  >[0] = { authenticatorSetupHint: 'absent', backupCodesHint: false }
}

class EvidenceFixture {
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

class PilotExpectation {
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

  /** Waits for the session's evidence report to re-render the Pilot. */
  static async eventually(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(condition()).toBe(true)
  }
}

describe('content-script sign-in attempt client', () => {
  let fixture: SignInAttemptContentFixture
  beforeEach(async () => {
    fixture = await SignInAttemptContentFixture.create()
  })
  afterEach(() => {
    fixture.dispose()
  })

  test('a Pilot mounted after the reload resumes Sign-in failed instead of Ready', async () => {
    const failed = PilotExpectation.presentation(
      await fixture.observedAfterSubmit(
        EvidenceFixture.page({
          message: lockText,
          authFields: true,
          success: false,
          resetLink: true,
        }),
      ),
    )
    expect(failed.status).toBe('Failed')

    fixture.loginDocument()
    await signInAttemptSession.resume()
    const surface = fixture.surface()
    await fixture.progress(surface).initialize()

    expect(fixture.projections).toBe(0)
    expect(surface.control.hidden).toBe(true)
    expect(surface.title.textContent).toBe('widgetSignInFailed')
    // Rust's attempt progress drives the header counter, not the Ready mount.
    expect(surface.step.textContent).toBe('widgetPilotLabel · 3/3')
    expect(
      PilotExpectation.text({ surface, testId: 'nook-sign-in-reason' }),
    ).toBe('widgetSignInReasonAccountLocked')
    const message = surface.body.querySelector(
      '[data-testid="nook-sign-in-site-message"]',
    )
    expect(message?.textContent).toBe(lockText)
    expect(message?.children.length).toBe(0)
    expect(PilotExpectation.actions(surface)).toContain('widgetSignInTryAgain')
    expect(PilotExpectation.actions(surface)).toContain('widgetSignInDismiss')
    // The reloaded document's own reset link is offered once Rust revalidates it.
    await PilotExpectation.eventually(() =>
      PilotExpectation.actions(surface).includes('widgetSignInResetPassword'),
    )
  })

  test('a rejected record is removed and the Pilot starts fresh at Ready', async () => {
    fixture.route.storage.values[fixture.route.storage.key(7)] = '{"v":0}'
    await signInAttemptSession.resume()
    expect(signInAttemptSession.phase.kind).toBe(SignInAttemptPhaseKind.Fresh)
    const surface = fixture.surface()
    await fixture.progress(surface).initialize()
    expect(fixture.projections).toBe(1)
    expect(fixture.route.storage.key(7) in fixture.route.storage.values).toBe(
      false,
    )
    expect(surface.control.hidden).toBe(false)
    expect(surface.title.textContent).toBe('Ready to sign in')
  })

  test('a wrong password renders its reason and message without a reset action', async () => {
    const failed = PilotExpectation.presentation(
      await fixture.observedAfterSubmit(
        EvidenceFixture.page({
          message: 'The username or password you entered is incorrect.',
          authFields: true,
          success: false,
          resetLink: false,
        }),
      ),
    )
    const surface = fixture.surface()
    fixture.rendering(surface).render(failed)
    expect(surface.title.textContent).toBe('widgetSignInFailed')
    expect(
      PilotExpectation.text({ surface, testId: 'nook-sign-in-reason' }),
    ).toBe('widgetSignInReasonWrongCredentials')
    expect(
      PilotExpectation.text({ surface, testId: 'nook-sign-in-site-message' }),
    ).toBe('The username or password you entered is incorrect.')
    expect(PilotExpectation.actions(surface)).not.toContain(
      'widgetSignInResetPassword',
    )
  })

  test('a confirmed sign-in renders Signed in and closes the record', async () => {
    const signedIn = PilotExpectation.presentation(
      await fixture.observedAfterSubmit(
        EvidenceFixture.page({
          message: '',
          authFields: false,
          success: true,
          resetLink: false,
        }),
      ),
    )
    expect(signedIn.status).toBe('SignedIn')
    expect(fixture.route.storage.key(7) in fixture.route.storage.values).toBe(
      false,
    )
    const surface = fixture.surface()
    fixture.rendering(surface).render(signedIn)
    expect(surface.title.textContent).toBe('widgetSignInSignedIn')
    expect(surface.control.hidden).toBe(true)
    expect(PilotExpectation.actions(surface)).toEqual([])
  })
})

describe('standalone sign-in attempt Pilot', () => {
  let fixture: SignInAttemptContentFixture
  beforeEach(async () => {
    fixture = await SignInAttemptContentFixture.create()
  })
  afterEach(() => {
    fixture.dispose()
  })

  test('a concluded failure resumed on a page without a login form closes and shows nothing', async () => {
    const failed = PilotExpectation.presentation(
      await fixture.observedAfterSubmit(
        EvidenceFixture.page({
          message: lockText,
          authFields: true,
          success: false,
          resetLink: true,
        }),
      ),
    )
    expect(failed.status).toBe('Failed')
    fixture.dashboardDocument()
    await signInAttemptSession.resume()

    // The page's first evidence report left the login workflow: Rust closed
    // the record as WorkflowLeft before anything rendered.
    expect(signInAttemptSession.phase.kind).toBe(SignInAttemptPhaseKind.Fresh)
    expect(fixture.route.storage.key(7) in fixture.route.storage.values).toBe(
      false,
    )
    expect(await signInAttemptPageWidget.show()).toBe(
      SignInAttemptWidgetDisplay.NotPresented,
    )
    expect(document.getElementById('nook-auth-widget')).not.toBeInstanceOf(
      HTMLElement,
    )
  })
})

describe('sign-in attempt evidence sensor', () => {
  let fixture: SignInAttemptContentFixture
  beforeEach(async () => {
    fixture = await SignInAttemptContentFixture.create()
  })

  test('reports a plain styled banner without role or aria-live, and its link', async () => {
    fixture.loginDocument()
    const { signInAttemptEvidenceSensor } =
      await import('../src/content/autofill/sign-in-attempt-evidence')
    const page = await signInAttemptEvidenceSensor.observe(
      SignInAttemptObservation.NEW_DOCUMENT,
    )
    expect(page.document).toBe('NewDocument')
    expect(page.auth_fields.current_password_present).toBe(true)
    const [banner] = page.messages
    expect(banner?.source).toBe('Container')
    expect(banner?.text).toContain('Your account has been locked for 24 hours')
    expect(banner?.tokens).toEqual(['login-notice'])
    expect(banner?.ancestor_tokens).toEqual(['login-card'])
    expect(banner?.changed_since_submit).toBe(false)
    expect(banner?.foreground).toEqual({ red: 179, green: 0, blue: 27 })
    expect(banner?.background).toEqual({ red: 251, green: 232, blue: 236 })
    expect(page.links.at(0)).toEqual({
      index: 0,
      text: 'Password Reset',
      href: 'https://www.namecheap.com/myaccount/login/password-reset/',
    })
    const baseline = signInAttemptEvidenceSensor.capture().baseline
    expect(baseline.messages.map((message) => message.text)).toEqual(
      page.messages.map((message) => message.text),
    )
    expect(baseline.controls).toEqual(page.controls)
    expect(page.controls.some((label) => label.includes('Sign in'))).toBe(true)
  })

  test('same-document observations report the route and which messages changed since the submit', async () => {
    fixture.loginDocument()
    const { signInAttemptEvidenceSensor } =
      await import('../src/content/autofill/sign-in-attempt-evidence')
    await passwordFormInteraction.prepareCompanionWorkflowPolicies(
      SignInAttemptEvidenceFixtureHints.HINTS,
    )
    const capture = signInAttemptEvidenceSensor.capture()
    expect(
      capture.baseline.messages.every(
        (message) => !message.changed_since_submit,
      ),
    ).toBe(true)
    const context: SignInAttemptObservationContext = {
      kind: SignInAttemptObservationKind.SameDocument,
      snapshot: capture.snapshot,
    }

    const unchanged = await signInAttemptEvidenceSensor.observe(context)
    expect(unchanged.document).toBe('SameDocumentSameRoute')
    expect(unchanged.messages.at(0)?.changed_since_submit).toBe(false)

    const notice = document.querySelector('.login-notice')
    switch (true) {
      case notice instanceof HTMLElement:
        notice.textContent = 'Too many attempts. Try again in 10 minutes.'
        break
      case true:
        throw new Error('expected the notice')
    }
    const changed = await signInAttemptEvidenceSensor.observe(context)
    expect(changed.messages.at(0)?.changed_since_submit).toBe(true)

    window.history.pushState({}, '', '/myaccount/login/verify/')
    const moved = await signInAttemptEvidenceSensor.observe(context)
    expect(moved.document).toBe('SameDocumentNewRoute')
  })

  test('reports a sign-out control as a raw label, never as a decision', async () => {
    fixture.dashboardDocument()
    const { signInAttemptEvidenceSensor } =
      await import('../src/content/autofill/sign-in-attempt-evidence')
    const page = await signInAttemptEvidenceSensor.observe(
      SignInAttemptObservation.NEW_DOCUMENT,
    )
    expect(page.controls.some((label) => label.includes('Sign out'))).toBe(true)
    expect(page.auth_fields.current_password_present).toBe(false)
  })

  test('never reports input values', async () => {
    fixture.loginDocument()
    const password = document.querySelector('input[type="password"]')
    switch (true) {
      case password instanceof HTMLInputElement:
        password.value = 'typed-secret-value'
        break
      case true:
        break
    }
    const { signInAttemptEvidenceSensor } =
      await import('../src/content/autofill/sign-in-attempt-evidence')
    const capture = signInAttemptEvidenceSensor.capture()
    const context: SignInAttemptObservationContext = {
      kind: SignInAttemptObservationKind.SameDocument,
      snapshot: capture.snapshot,
    }
    const page = await signInAttemptEvidenceSensor.observe(context)
    expect(JSON.stringify(page)).not.toContain('typed-secret-value')
    expect(JSON.stringify(capture.baseline)).not.toContain('typed-secret-value')
  })
})
