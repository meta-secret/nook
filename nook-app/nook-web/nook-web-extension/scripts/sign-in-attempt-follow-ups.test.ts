import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import type { SignInAttemptPageEvidence } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { passwordFormInteraction } from '../../nook-web-shared/src/extension/password-forms'
import {
  SignInAttemptMessageType,
  SignInAttemptOperation,
  type SignInAttemptMessage,
} from '../src/lib/sign-in-attempt-messages'
import {
  SignInAttemptChallengeKind,
  SignInAttemptHostActionKind,
  SignInAttemptPhaseKind,
  signInAttemptSession,
} from '../src/content/autofill/sign-in-attempt-session'
import {
  SignInAttemptWidgetDisplay,
  signInAttemptPageWidget,
} from '../src/content/autofill/sign-in-attempt-widget'
import {
  EvidenceFixture,
  PilotExpectation,
  SignInAttemptContentFixture,
  SignInAttemptEvidenceFixtureHints,
  lockText,
  type PilotSurface,
} from './sign-in-attempt-content-support'

await companionWasmReady

type LinkClicks = { count: number }

const wrongPassword = 'The username or password you entered is incorrect.'

/** Counts activations of one anchor without letting happy-dom navigate. */
class LinkProbe {
  static watch(anchor: Element): LinkClicks {
    const clicks: LinkClicks = { count: 0 }
    anchor.addEventListener('click', (event) => {
      clicks.count += 1
      event.preventDefault()
    })
    return clicks
  }

  static anchor(): HTMLAnchorElement {
    const anchor = document.querySelector('.login-notice a')
    if (!(anchor instanceof HTMLAnchorElement))
      throw new Error('expected the page reset link')
    return anchor
  }
}

class FollowUpScenario {
  constructor(private readonly fixture: SignInAttemptContentFixture) {}

  /** A concluded failure resumed into a mounted login Pilot on the reloaded page. */
  async failedPilot(page: SignInAttemptPageEvidence): Promise<PilotSurface> {
    await this.fixture.observedAfterSubmit(page)
    this.fixture.loginDocument()
    await signInAttemptSession.resume()
    const surface = this.fixture.surface()
    await this.fixture.progress(surface).initialize()
    expect(surface.title.textContent).toBe('widgetSignInFailed')
    return surface
  }

  async lockedWithReset(): Promise<PilotSurface> {
    const surface = await this.failedPilot(
      EvidenceFixture.page({
        message: lockText,
        authFields: true,
        success: false,
        resetLink: true,
      }),
    )
    await PilotExpectation.eventually(() =>
      PilotExpectation.actions(surface).includes('widgetSignInResetPassword'),
    )
    return surface
  }

  wrongPassword(): Promise<PilotSurface> {
    return this.failedPilot(
      EvidenceFixture.page({
        message: wrongPassword,
        authFields: true,
        success: false,
        resetLink: false,
      }),
    )
  }
}

describe('sign-in attempt follow-ups', () => {
  let fixture: SignInAttemptContentFixture
  let scenario: FollowUpScenario
  beforeEach(async () => {
    fixture = await SignInAttemptContentFixture.create()
    scenario = new FollowUpScenario(fixture)
  })
  afterEach(() => {
    fixture.dispose()
  })

  test('Reset password clicks the very link Rust revalidated, once', async () => {
    await scenario.lockedWithReset()
    const clicks = LinkProbe.watch(LinkProbe.anchor())
    await signInAttemptSession.choose(PilotExpectation.offer('ResetPassword'))
    expect(clicks.count).toBe(1)
    expect(fixture.route.storage.key(7) in fixture.route.storage.values).toBe(
      false,
    )
  })

  test('Reset password clicks nothing when the link is replaced before activation', async () => {
    const surface = await scenario.lockedWithReset()
    const original = LinkProbe.anchor()
    const originalClicks = LinkProbe.watch(original)
    const replacement = original.cloneNode(true)
    if (!(replacement instanceof HTMLAnchorElement))
      throw new Error('expected a cloned anchor')
    const replacementClicks = LinkProbe.watch(replacement)
    fixture.beforeDelivery = (message: SignInAttemptMessage) => {
      switch (
        message.payload.operation === SignInAttemptOperation.Advance &&
        message.payload.event.kind === 'UserAction'
      ) {
        case true:
          // Same text and href, different element: the page swapped the DOM.
          original.replaceWith(replacement)
          return
        case false:
          return
      }
    }
    await signInAttemptSession.choose(PilotExpectation.offer('ResetPassword'))
    expect(originalClicks.count).toBe(0)
    expect(replacementClicks.count).toBe(0)
    // Nothing is clicked or reported: the Pilot stays as it is.
    expect(surface.title.textContent).toBe('widgetSignInFailed')
  })

  test('Try again restarts the same login through the Pilot fill path', async () => {
    const surface = await scenario.wrongPassword()
    await signInAttemptSession.choose(PilotExpectation.offer('TryAgain'))
    expect(fixture.runs).toEqual([
      {
        kind: SignInAttemptHostActionKind.RestartWithSameLogin,
        login: 'store_a/secret_b',
      },
    ])
    expect(surface.title.textContent).toBe('Ready to sign in')
    expect(fixture.route.storage.key(7) in fixture.route.storage.values).toBe(
      false,
    )
  })

  test('Choose another login opens the login picker', async () => {
    await scenario.wrongPassword()
    await signInAttemptSession.choose(
      PilotExpectation.offer('ChooseAnotherLogin'),
    )
    expect(fixture.runs).toEqual([
      { kind: SignInAttemptHostActionKind.OpenLoginPicker },
    ])
  })

  test('Fill 2FA code hands the challenge off to the authenticator Pilot', async () => {
    const challenge: SignInAttemptPageEvidence = {
      ...EvidenceFixture.page({
        message: '',
        authFields: false,
        success: false,
        resetLink: false,
      }),
      auth_fields: {
        username_present: false,
        current_password_present: false,
        one_time_code_present: true,
      },
    }
    const presented = PilotExpectation.presentation(
      await fixture.observedAfterSubmit(challenge),
    )
    expect(presented.status).toBe('ChallengeRequired')
    fixture.oneTimeCodeDocument()
    await signInAttemptSession.resume()
    expect(signInAttemptSession.challenge().kind).toBe(
      SignInAttemptChallengeKind.Presented,
    )
    await signInAttemptSession.handOffToAuthenticator()
    expect(signInAttemptSession.phase.kind).toBe(SignInAttemptPhaseKind.Fresh)
    expect(fixture.route.storage.key(7) in fixture.route.storage.values).toBe(
      false,
    )
  })

  test('the standalone Pilot keeps a visible refusal when a follow-up needs a login form', async () => {
    await fixture.observedAfterSubmit(
      EvidenceFixture.page({
        message: wrongPassword,
        authFields: true,
        success: false,
        resetLink: false,
      }),
    )
    fixture.loginDocument()
    await signInAttemptSession.resume()
    await passwordFormInteraction.prepareCompanionWorkflowPolicies(
      SignInAttemptEvidenceFixtureHints.HINTS,
    )
    expect(await signInAttemptPageWidget.show()).toBe(
      SignInAttemptWidgetDisplay.Shown,
    )
    await signInAttemptSession.choose(PilotExpectation.offer('TryAgain'))
    const surface = fixture.pageWidget()
    expect(surface.description.textContent).toBe(
      'widgetSignInActionUnavailable',
    )
    expect(PilotExpectation.actions(surface)).toEqual([])
    expect(signInAttemptPageWidget.displayed()).toBe(
      SignInAttemptWidgetDisplay.Shown,
    )
  })
})

describe('sign-in attempt site binding', () => {
  let fixture: SignInAttemptContentFixture
  beforeEach(async () => {
    fixture = await SignInAttemptContentFixture.create()
  })
  afterEach(() => {
    fixture.dispose()
  })

  test('another origin of the same site gets the reason and actions but not the site message', async () => {
    await fixture.observedAfterSubmit(
      EvidenceFixture.page({
        message: lockText,
        authFields: true,
        success: false,
        resetLink: false,
      }),
    )
    // Rust decides this from the sender origin; TypeScript only renders it.
    fixture.sender = {
      ...fixture.sender,
      url: 'https://namecheap.com/myaccount/login/',
    }
    fixture.loginDocument()
    await signInAttemptSession.resume()
    const surface = fixture.surface()
    await fixture.progress(surface).initialize()
    expect(surface.title.textContent).toBe('widgetSignInFailed')
    expect(surface.description.textContent).toBe(
      'widgetSignInReasonAccountLocked',
    )
    expect(PilotExpectation.actions(surface)).toContain('widgetSignInTryAgain')
    const message = surface.body.querySelector(
      '[data-testid="nook-sign-in-site-message"]',
    )
    expect(message?.textContent).toBe('')
    expect(surface.body.textContent).not.toContain('locked for 24 hours')
  })
})

describe('sign-in attempt rendering states', () => {
  let fixture: SignInAttemptContentFixture
  beforeEach(async () => {
    fixture = await SignInAttemptContentFixture.create()
  })
  afterEach(() => {
    fixture.dispose()
  })

  test('a reload before the reported submit renders Sign-in not confirmed', async () => {
    const begin: SignInAttemptMessage = {
      type: SignInAttemptMessageType.Session,
      payload: {
        operation: SignInAttemptOperation.Begin,
        login: 'store_a/secret_b',
      },
    }
    await fixture.route.respond({ message: begin, sender: fixture.sender })
    const timedOut = PilotExpectation.presentation(
      await fixture.advance({ kind: 'Resumed' }),
    )
    expect(timedOut.status).toBe('TimedOut')
    const surface = fixture.surface()
    fixture.rendering(surface).render(timedOut)
    expect(surface.title.textContent).toBe('widgetSignInTimedOut')
    expect(surface.description.textContent).toBe(
      'widgetSignInTimedOutDescription',
    )
    expect(PilotExpectation.actions(surface)).toContain('widgetSignInDismiss')
    expect(surface.control.hidden).toBe(true)
  })

  test('an unreachable attempt owner shows the existing manual state', async () => {
    fixture.ownerUnavailable = true
    fixture.loginDocument()
    await signInAttemptSession.resume()
    expect(signInAttemptSession.phase.kind).toBe(
      SignInAttemptPhaseKind.Unavailable,
    )
    const surface = fixture.surface()
    await fixture.progress(surface).initialize()
    expect(surface.title.textContent).toBe('widgetManualTitle')
    expect(surface.description.textContent).toBe('widgetManualDescription')
  })

  test('an identical presentation keeps the rendered buttons and their state', async () => {
    const failed = PilotExpectation.presentation(
      await fixture.observedAfterSubmit(
        EvidenceFixture.page({
          message: wrongPassword,
          authFields: true,
          success: false,
          resetLink: false,
        }),
      ),
    )
    const surface = fixture.surface()
    const rendering = fixture.rendering(surface)
    rendering.render(failed)
    const dismissRequest = { surface, testId: 'widgetSignInDismiss' }
    const dismiss = PilotExpectation.button(dismissRequest)
    dismiss.disabled = true
    rendering.render(failed)
    expect(PilotExpectation.button(dismissRequest)).toBe(dismiss)
    expect(dismiss.disabled).toBe(true)
  })

  test('Dismiss is a quiet text button and the other offers share a compact row', async () => {
    const failed = PilotExpectation.presentation(
      await fixture.observedAfterSubmit(
        EvidenceFixture.page({
          message: wrongPassword,
          authFields: true,
          success: false,
          resetLink: false,
        }),
      ),
    )
    const surface = fixture.surface()
    fixture.rendering(surface).render(failed)
    const buttons = Array.from(
      surface.body.querySelectorAll(
        '[data-testid="nook-sign-in-actions"] button',
      ),
    )
    expect(buttons.at(0)?.className).toBe('primary-button')
    const dismissRequest = { surface, testId: 'widgetSignInDismiss' }
    expect(PilotExpectation.button(dismissRequest).className).toBe(
      'text-button',
    )
    expect(
      buttons
        .slice(1)
        .filter((button) => button.textContent !== 'widgetSignInDismiss')
        .every((button) => button.className.startsWith('secondary-button')),
    ).toBe(true)
  })
})
