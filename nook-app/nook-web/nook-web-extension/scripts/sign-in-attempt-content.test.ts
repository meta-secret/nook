import { beforeEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import type {
  SignInAttemptEvent,
  SignInAttemptPageEvidence,
  SignInAttemptPresentation,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { PasswordFormScopeKind } from '../../nook-web-shared/src/extension/password-forms'
import { emptyPasswordFormSummary } from '../../nook-web-shared/src/extension/password-form-summary-state'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import {
  SignInAttemptMessageType,
  SignInAttemptOperation,
  SignInAttemptViewKind,
  type SignInAttemptRuntimeResponse,
} from '../src/lib/sign-in-attempt-messages'
import { handleCompanionWasmMessage } from '../src/offscreen/session-companion-wasm-operations'
import {
  SignInAttemptRouteFixture,
  type SignInAttemptSenderFixture,
} from './sign-in-attempt-test-support'

await companionWasmReady

type RuntimeReply = (response: BrowserRuntimeMessageValue) => void
type ContentRuntimeMessage = { readonly type: string }
type ContentGlobals = Pick<
  Window,
  | 'document'
  | 'location'
  | 'Element'
  | 'HTMLElement'
  | 'HTMLAnchorElement'
  | 'HTMLButtonElement'
  | 'HTMLInputElement'
  | 'HTMLFormElement'
  | 'MutationObserver'
  | 'NodeFilter'
  | 'ShadowRoot'
  | 'getComputedStyle'
> & { window: Window }

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
  readonly route: SignInAttemptRouteFixture
  projections = 0
  private readonly browser = new Window({ url: loginPage })

  private constructor(route: SignInAttemptRouteFixture) {
    this.route = route
  }

  static async create(): Promise<SignInAttemptContentFixture> {
    const fixture = new SignInAttemptContentFixture(
      await SignInAttemptRouteFixture.create(),
    )
    fixture.install()
    return fixture
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
      HTMLButtonElement: browser.HTMLButtonElement,
      HTMLInputElement: browser.HTMLInputElement,
      HTMLFormElement: browser.HTMLFormElement,
      MutationObserver: browser.MutationObserver,
      NodeFilter: browser.NodeFilter,
      ShadowRoot: browser.ShadowRoot,
      getComputedStyle: browser.getComputedStyle.bind(browser),
    }
    Object.assign(globalThis, globals)
    Object.assign(globalThis.chrome, {
      i18n: { getMessage: (key: string) => key },
    })
    Object.assign(globalThis.chrome.runtime, {
      lastError: false,
      sendMessage: this.sendMessage.bind(this),
    })
  }

  private sendMessage(
    message: ContentRuntimeMessage,
    reply?: RuntimeReply,
  ): Promise<BrowserRuntimeMessageValue> {
    const delivery = this.deliver(message)
    void delivery.then((response) => reply?.(response))
    return delivery
  }

  private async deliver(
    message: ContentRuntimeMessage,
  ): Promise<BrowserRuntimeMessageValue> {
    switch (message.type) {
      case SignInAttemptMessageType.Session:
        return this.route.respond({
          message: JSON.parse(JSON.stringify(message)),
          sender: topFrame,
        })
      case CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist: {
        this.projections += 1
        const result = await handleCompanionWasmMessage(
          message as CompanionWasmSessionMessage,
        )
        return result.match(
          (value) => ({ ok: true, result: JSON.parse(JSON.stringify(value)) }),
          () => ({ ok: false }),
        )
      }
    }
    return { ok: false }
  }

  advance(event: SignInAttemptEvent): Promise<SignInAttemptRuntimeResponse> {
    return this.route.respond({
      message: {
        type: SignInAttemptMessageType.Session,
        payload: { operation: SignInAttemptOperation.Advance, event },
      } as BrowserRuntimeMessageValue,
      sender: topFrame,
    })
  }

  /** Drives the real route to a failed, retained attempt behind a reload. */
  async failedAfterReload(page: SignInAttemptPageEvidence) {
    await this.route.respond({
      message: {
        type: SignInAttemptMessageType.Session,
        payload: {
          operation: SignInAttemptOperation.Begin,
          login: 'store_a/secret_b',
        },
      },
      sender: topFrame,
    })
    await this.advance({ kind: 'Activity', activity: { kind: 'Filled' } })
    await this.advance({
      kind: 'Activity',
      activity: {
        kind: 'Submitted',
        baseline: {
          errorMessagePresent: false,
          authFields: {
            usernamePresent: true,
            currentPasswordPresent: true,
            oneTimeCodePresent: false,
          },
        },
      },
    })
    return this.advance({ kind: 'PageObserved', page })
  }

  mount() {
    document.body.innerHTML = `<div id="pilot"><h1>Ready to sign in</h1><p>One saved login matches this site.</p><button type="button">Sign in</button></div>`
    const body = document.querySelector('#pilot') as HTMLDivElement
    return {
      body,
      title: body.querySelector('h1') as HTMLHeadingElement,
      description: body.querySelector('p') as HTMLParagraphElement,
      control: body.querySelector('button') as HTMLButtonElement,
    }
  }
}

class EvidenceFixture {
  static page(request: EvidenceRequest): SignInAttemptPageEvidence {
    return {
      document: 'NewDocument',
      authFields: {
        usernamePresent: request.authFields,
        currentPasswordPresent: request.authFields,
        oneTimeCodePresent: false,
      },
      manualCheckpointPresent: false,
      successMarkerPresent: request.success,
      errorMarkerPresent: false,
      messages: request.message.length
        ? [
            {
              text: request.message,
              source: 'Container',
              placement: 'NearAuthForm',
              tokens: ['login-notice', 'login-card'],
              foreground: { red: 179, green: 0, blue: 27 },
              background: { red: 251, green: 232, blue: 236 },
            },
          ]
        : [],
      links: request.resetLink
        ? [
            {
              index: 0,
              text: 'Password Reset',
              href: 'https://www.namecheap.com/myaccount/login/password-reset/',
            },
          ]
        : [],
    }
  }
}
type EvidenceRequest = {
  readonly message: string
  readonly authFields: boolean
  readonly success: boolean
  readonly resetLink: boolean
}

class PresentationExpectation {
  static of(response: SignInAttemptRuntimeResponse): SignInAttemptPresentation {
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
}

describe('content-script sign-in attempt client', () => {
  let fixture: SignInAttemptContentFixture
  beforeEach(async () => {
    fixture = await SignInAttemptContentFixture.create()
  })

  test('a mounted Pilot resumes the failed attempt instead of falling back to Ready', async () => {
    const page = EvidenceFixture.page({
      message: lockText,
      authFields: true,
      success: false,
      resetLink: true,
    })
    const failed = PresentationExpectation.of(
      await fixture.failedAfterReload(page),
    )
    expect(failed.status).toBe('Failed')

    const { signInAttemptSession } =
      await import('../src/content/autofill/sign-in-attempt-session')
    const { LoginChecklistProgress } =
      await import('../src/content/autofill/login-checklist-progress')
    await signInAttemptSession.resume()
    const surface = fixture.mount()
    const progress = new LoginChecklistProgress({
      surface,
      control: surface.control,
      workflow: {
        root: document,
        formScope: { kind: PasswordFormScopeKind.Unowned },
        summary: emptyPasswordFormSummary,
      },
      attemptActions: { run: () => {} },
    })
    await progress.initialize()

    expect(fixture.projections).toBe(0)
    expect(surface.title.textContent).toBe('widgetSignInFailed')
    expect(
      surface.body.querySelector('[data-testid="nook-sign-in-reason"]')
        ?.textContent,
    ).toBe('widgetSignInReasonAccountLocked')
    const message = surface.body.querySelector(
      '[data-testid="nook-sign-in-site-message"]',
    )
    expect(message?.textContent).toBe(lockText)
    expect(message?.children.length).toBe(0)
    const actions = Array.from(
      surface.body.querySelectorAll('[data-testid="nook-sign-in-actions"] button'),
    ).map((button) => button.textContent)
    expect(actions).toContain('widgetSignInResetPassword')
    expect(actions).toContain('widgetSignInTryAgain')
    expect(actions).toContain('widgetSignInDismiss')
    expect(surface.control.hidden).toBe(true)
  })

  test('a rejected record is removed and the Pilot starts fresh at Ready', async () => {
    fixture.route.storage.values[fixture.route.storage.key(7)] = '{"v":0}'
    const { signInAttemptSession, SignInAttemptPhaseKind } =
      await import('../src/content/autofill/sign-in-attempt-session')
    const { LoginChecklistProgress } =
      await import('../src/content/autofill/login-checklist-progress')
    await signInAttemptSession.resume()
    expect(signInAttemptSession.phase.kind).toBe(SignInAttemptPhaseKind.Fresh)
    const surface = fixture.mount()
    const progress = new LoginChecklistProgress({
      surface,
      control: surface.control,
      workflow: {
        root: document,
        formScope: { kind: PasswordFormScopeKind.Unowned },
        summary: emptyPasswordFormSummary,
      },
      attemptActions: { run: () => {} },
    })
    await progress.initialize()
    expect(fixture.projections).toBe(1)
    expect(
      fixture.route.storage.key(7) in fixture.route.storage.values,
    ).toBe(false)
    expect(surface.control.hidden).toBe(false)
  })

  test('a wrong password renders its reason without a reset action', async () => {
    const page = EvidenceFixture.page({
      message: 'The username or password you entered is incorrect.',
      authFields: true,
      success: false,
      resetLink: false,
    })
    const failed = PresentationExpectation.of(
      await fixture.failedAfterReload(page),
    )
    const { SignInAttemptRendering } =
      await import('../src/content/autofill/sign-in-attempt-rendering')
    const { LoginChecklistRendering } =
      await import('../src/content/autofill/login-checklist-rendering')
    const surface = fixture.mount()
    const rendering = new SignInAttemptRendering({
      surface: { ...surface, continueButton: surface.control },
      checklist: new LoginChecklistRendering(surface),
      choose: () => {},
    })
    rendering.render(failed)
    expect(surface.title.textContent).toBe('widgetSignInFailed')
    expect(
      surface.body.querySelector('[data-testid="nook-sign-in-reason"]')
        ?.textContent,
    ).toBe('widgetSignInReasonWrongCredentials')
    const actions = Array.from(
      surface.body.querySelectorAll('[data-testid="nook-sign-in-actions"] button'),
    ).map((button) => button.textContent)
    expect(actions).not.toContain('widgetSignInResetPassword')
  })

  test('a confirmed sign-in renders Signed in and closes the record', async () => {
    const page = EvidenceFixture.page({
      message: '',
      authFields: false,
      success: true,
      resetLink: false,
    })
    const signedIn = PresentationExpectation.of(
      await fixture.failedAfterReload(page),
    )
    expect(signedIn.status).toBe('SignedIn')
    expect(
      fixture.route.storage.key(7) in fixture.route.storage.values,
    ).toBe(false)
    const { SignInAttemptRendering } =
      await import('../src/content/autofill/sign-in-attempt-rendering')
    const { LoginChecklistRendering } =
      await import('../src/content/autofill/login-checklist-rendering')
    const surface = fixture.mount()
    const rendering = new SignInAttemptRendering({
      surface: { ...surface, continueButton: surface.control },
      checklist: new LoginChecklistRendering(surface),
      choose: () => {},
    })
    rendering.render(signedIn)
    expect(surface.title.textContent).toBe('widgetSignInSignedIn')
    expect(
      surface.body.querySelectorAll('[data-testid="nook-sign-in-actions"] button')
        .length,
    ).toBe(0)
  })
})
