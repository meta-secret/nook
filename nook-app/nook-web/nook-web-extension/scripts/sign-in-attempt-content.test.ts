import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { passwordFormInteraction } from '../../nook-web-shared/src/extension/password-forms'
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
import {
  EvidenceFixture,
  PilotExpectation,
  SignInAttemptContentFixture,
  SignInAttemptEvidenceFixtureHints,
  lockText,
} from './sign-in-attempt-content-support'

await companionWasmReady

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
    expect(surface.description.textContent).toBe(
      'widgetSignInReasonAccountLocked',
    )
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
    expect(surface.description.textContent).toBe(
      'widgetSignInReasonWrongCredentials',
    )
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
    const secret = 'typed-secret-value'
    const username = document.querySelector('input[autocomplete="username"]')
    const password = document.querySelector('input[type="password"]')
    if (
      !(username instanceof HTMLInputElement) ||
      !(password instanceof HTMLInputElement)
    )
      throw new Error('expected the login fields')
    for (const field of [username, password]) {
      field.value = secret
      field.setAttribute('value', secret)
    }
    // The secret really is on the page, in values and value attributes.
    expect(password.value).toBe(secret)
    expect(document.body.innerHTML).toContain(secret)
    const { signInAttemptEvidenceSensor } =
      await import('../src/content/autofill/sign-in-attempt-evidence')
    const capture = signInAttemptEvidenceSensor.capture()
    const context: SignInAttemptObservationContext = {
      kind: SignInAttemptObservationKind.SameDocument,
      snapshot: capture.snapshot,
    }
    const page = await signInAttemptEvidenceSensor.observe(context)
    // The sensor did read this form and its banner.
    expect(page.auth_fields.current_password_present).toBe(true)
    expect(page.messages.length).toBeGreaterThan(0)
    expect(JSON.stringify(page)).not.toContain(secret)
    expect(JSON.stringify(capture.baseline)).not.toContain(secret)
  })

  test('an aria-live wrapper around the form is not a message; its alert is', async () => {
    document.body.innerHTML = `<main><div class="live-shell" aria-live="polite">
      <p role="alert" class="form-error" style="color: rgb(200, 30, 30)">Incorrect password. Try again.</p>
      <form method="post" action="/login">
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" autocomplete="username">
        <input name="password" type="password" autocomplete="current-password">
        <button type="submit">Sign in</button>
      </form></div></main>`
    const { signInAttemptEvidenceSensor } =
      await import('../src/content/autofill/sign-in-attempt-evidence')
    const page = await signInAttemptEvidenceSensor.observe(
      SignInAttemptObservation.NEW_DOCUMENT,
    )
    expect(page.messages.map((message) => message.text)).toEqual([
      'Incorrect password. Try again.',
    ])
    expect(page.messages.at(0)?.source).toBe('Alert')
    expect(JSON.stringify(page.messages)).not.toContain('Email address')
  })
})
