// @vitest-environment-options { "url": "https://account.booking.com/sign-in" }

import { afterEach, describe, expect, test } from 'vitest'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  CompanionAuthenticationWorkflowMatchKind,
  authentication_advance_control_is_safe,
  classify_companion_authentication_workflow_facts,
  companion_authentication_workflow_match_kind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authenticationPageObservationFacts,
  fillLoginCredentials,
  FormSubmissionResult,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { clickAdvanceControl } from '../../../../nook-web-shared/src/extension/password-form-submission-controls'

enum BookingFixturePrimaryControl {
  ContinueWithEmail = 'Continue with email',
  ContinueWithGoogle = 'Sign in with Google',
  ContinueWithApple = 'Sign in with Apple',
  ContinueWithFacebook = 'Sign in with Facebook',
  RecoverAccount = 'Recover your account',
  DeleteAccount = 'Delete account',
}

enum BookingFixtureControlState {
  Untouched = 'untouched',
  Activated = 'activated',
}

type BookingDomElements = {
  readonly root: HTMLElement
  readonly email: HTMLInputElement
  readonly primary: HTMLButtonElement
  readonly alternatives: readonly HTMLElement[]
}

class BookingAuthenticationFixture {
  private constructor(
    private readonly primaryLabel: BookingFixturePrimaryControl,
  ) {}

  static stable(): BookingAuthenticationFixture {
    return new BookingAuthenticationFixture(
      BookingFixturePrimaryControl.ContinueWithEmail,
    )
  }

  static withPrimaryControl(
    primaryLabel: BookingFixturePrimaryControl,
  ): BookingAuthenticationFixture {
    return new BookingAuthenticationFixture(primaryLabel)
  }

  install(): BookingDomElements {
    document.body.innerHTML = `<header><a href="/">Booking.com</a><button aria-label="Select your language">English</button><a href="/help" aria-label="Help and support">Help</a></header>
      <main><h1>Sign in or create an account</h1><p>You can sign in using your Booking.com account to access our services.</p>
        <section data-testid="booking-email-surface"><label>Email address<input aria-label="Email address" placeholder="Enter your email address"></label><button data-testid="booking-primary">${this.primaryLabel}</button></section>
        <p>or use one of these options</p><nav aria-label="Alternative sign-in options"><a href="/social/consent/google">Sign in with Google</a><a href="/social/consent/apple">Sign in with Apple</a><a href="/social/consent/facebook">Sign in with Facebook</a></nav>
        <p>Lost access to your email? <a href="/recover">Recover your account</a></p><p data-testid="booking-disclosure">By signing in or creating an account, you agree with our <a href="/terms">Terms &amp; Conditions</a> and <a href="/privacy">Privacy Statement</a>.</p>
      </main>`
    const root = document.querySelector<HTMLElement>(
      '[data-testid="booking-email-surface"]',
    )
    const email = root?.querySelector<HTMLInputElement>(
      '[aria-label="Email address"]',
    )
    const primary = root?.querySelector<HTMLButtonElement>(
      '[data-testid="booking-primary"]',
    )
    if (!root || !email || !primary) {
      throw new Error('expected Booking.com DOM fixture')
    }
    return {
      root,
      email,
      primary,
      alternatives: [
        ...document.querySelectorAll<HTMLElement>(
          'header button, header a, nav a, a[href="/recover"], [data-testid="booking-disclosure"] a',
        ),
      ],
    }
  }
}

afterEach(() => {
  document.body.replaceChildren()
  history.replaceState({}, '', '/sign-in')
})

describe('Booking.com DOM-backed authentication simulation', () => {
  test('fills only email and activates only the local Continue with email control', () => {
    expect(location.href).toBe('https://account.booking.com/sign-in')
    const fixture = BookingAuthenticationFixture.stable().install()
    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    const [observation] = observations
    if (!observation) throw new Error('expected Booking.com observation')
    expect(observation.root === fixture.root).toBe(true)
    expect(observation.formScope.kind).toBe(PasswordFormScopeKind.Unowned)

    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.fields).toMatchObject({
      usernameFieldCount: 1,
      currentPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      actionablePasswordFieldCount: 0,
    })
    expect(facts.ceremony).toMatchObject({
      authenticationContext: {
        sourceOrigin: 'https://account.booking.com',
        formIdentity: '',
        destinationIdentity: 'https://account.booking.com/sign-in',
      },
      implicitSubmissionMethod: 'absent',
    })
    const detailedAdvanceControl = facts.detailedAdvanceControl
    if (!detailedAdvanceControl || detailedAdvanceControl.kind !== 'observed') {
      throw new Error('expected typed Booking.com advance-control facts')
    }
    expect(detailedAdvanceControl.observations).toEqual([
      expect.objectContaining({
        label: BookingFixturePrimaryControl.ContinueWithEmail,
        submissionDestinationSource: 'omitted',
        submissionMethod: 'absent',
      }),
    ])
    expect(
      detailedAdvanceControl.observations.some(
        authentication_advance_control_is_safe,
      ),
    ).toBe(true)
    const workflow = classify_companion_authentication_workflow_facts({
      observations: [facts],
    })
    expect(companion_authentication_workflow_match_kind(workflow)).toBe(
      CompanionAuthenticationWorkflowMatchKind.Matched,
    )
    if (!('snapshot' in workflow)) throw new Error('expected matched workflow')
    expect(workflow.snapshot).toMatchObject({
      kind: AuthenticationWorkflowKind.Login,
      action: AuthenticationWorkflowAction.ContinueWithNook,
    })

    const fillRequest: Parameters<typeof fillLoginCredentials>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
      credentials: {
        username: 'pilot@nook.test',
        password: 'extension-fill-password',
      },
    }
    expect(fillLoginCredentials(fillRequest)).toBe(true)
    let primaryState = BookingFixtureControlState.Untouched
    let alternativeState = BookingFixtureControlState.Untouched
    fixture.primary.addEventListener(
      'click',
      () => (primaryState = BookingFixtureControlState.Activated),
    )
    for (const alternative of fixture.alternatives) {
      alternative.addEventListener(
        'click',
        () => (alternativeState = BookingFixtureControlState.Activated),
      )
      alternative.addEventListener(
        'change',
        () => (alternativeState = BookingFixtureControlState.Activated),
      )
    }
    const submissionRequest: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
    }
    expect(submitLoginForm(submissionRequest)).toBe(
      FormSubmissionResult.Submitted,
    )
    expect(primaryState).toBe(BookingFixtureControlState.Activated)
    expect(alternativeState).toBe(BookingFixtureControlState.Untouched)
    expect(fixture.email.value).toBe('pilot@nook.test')
    expect(document.querySelectorAll('form')).toHaveLength(0)
    expect(fixture.root.textContent).not.toContain('Sign in with Google')
    expect(fixture.root.textContent).not.toContain('Recover your account')
    expect(fixture.email.hasAttribute('name')).toBe(false)
    expect(fixture.email.hasAttribute('type')).toBe(false)
    expect(fixture.email.hasAttribute('autocomplete')).toBe(false)
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
  })

  test.each([
    BookingFixturePrimaryControl.ContinueWithGoogle,
    BookingFixturePrimaryControl.ContinueWithApple,
    BookingFixturePrimaryControl.ContinueWithFacebook,
    BookingFixturePrimaryControl.RecoverAccount,
    BookingFixturePrimaryControl.DeleteAccount,
  ])('rejects unsafe local activation %s', (primaryLabel) => {
    const fixture =
      BookingAuthenticationFixture.withPrimaryControl(primaryLabel).install()
    let primaryState = BookingFixtureControlState.Untouched
    fixture.primary.addEventListener(
      'click',
      () => (primaryState = BookingFixtureControlState.Activated),
    )
    const request: Parameters<typeof clickAdvanceControl>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: fixture.root,
      formScope: { kind: PasswordFormScopeKind.Unowned },
      usernameField: fixture.email,
    }
    expect(clickAdvanceControl(request)).toBe(false)
    expect(primaryState).toBe(BookingFixtureControlState.Untouched)
    expect(fixture.email.value).toBe('')
  })

  test.each(['/signup', '/sign-in?provider=google', '/account/delete'])(
    'rejects destination drift to %s',
    (destination) => {
      const fixture = BookingAuthenticationFixture.stable().install()
      history.replaceState({}, '', destination)
      let primaryState = BookingFixtureControlState.Untouched
      fixture.primary.addEventListener(
        'click',
        () => (primaryState = BookingFixtureControlState.Activated),
      )
      const request: Parameters<typeof clickAdvanceControl>[0] = {
        kind: PasswordFormQueryKind.Scoped,
        root: fixture.root,
        formScope: { kind: PasswordFormScopeKind.Unowned },
        usernameField: fixture.email,
      }
      expect(clickAdvanceControl(request)).toBe(false)
      expect(primaryState).toBe(BookingFixtureControlState.Untouched)
    },
  )

  test('rejects an inert Continue with email control', () => {
    const fixture = BookingAuthenticationFixture.stable().install()
    fixture.primary.setAttribute('aria-disabled', 'true')
    const request: Parameters<typeof clickAdvanceControl>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: fixture.root,
      formScope: { kind: PasswordFormScopeKind.Unowned },
      usernameField: fixture.email,
    }
    expect(clickAdvanceControl(request)).toBe(false)
  })
})
