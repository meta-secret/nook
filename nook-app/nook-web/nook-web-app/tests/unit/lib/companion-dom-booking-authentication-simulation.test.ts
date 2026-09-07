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

enum BookingFixtureFormOwnership {
  Owned = 'owned',
  Unowned = 'unowned',
}

enum BookingFixtureFormDestination {
  Omitted = 'omitted',
  CrossOrigin = 'cross-origin',
}

enum BookingFixtureSubmitLayout {
  Sole = 'sole',
  Ambiguous = 'ambiguous',
}

type BookingFixtureOptions = {
  readonly primaryLabel: BookingFixturePrimaryControl
  readonly ownership: BookingFixtureFormOwnership
  readonly destination: BookingFixtureFormDestination
  readonly submitLayout: BookingFixtureSubmitLayout
}

const BOOKING_FIXTURE_DEFAULTS: BookingFixtureOptions = {
  primaryLabel: BookingFixturePrimaryControl.ContinueWithEmail,
  ownership: BookingFixtureFormOwnership.Owned,
  destination: BookingFixtureFormDestination.Omitted,
  submitLayout: BookingFixtureSubmitLayout.Sole,
}

type BookingDomElements = {
  readonly root: HTMLElement
  readonly email: HTMLInputElement
  readonly primary: HTMLButtonElement
  readonly alternatives: readonly HTMLElement[]
}

class BookingAuthenticationFixture {
  private constructor(private readonly options: BookingFixtureOptions) {}

  static stable(): BookingAuthenticationFixture {
    return new BookingAuthenticationFixture(BOOKING_FIXTURE_DEFAULTS)
  }

  static withPrimaryControl(
    primaryLabel: BookingFixturePrimaryControl,
  ): BookingAuthenticationFixture {
    return new BookingAuthenticationFixture({
      ...BOOKING_FIXTURE_DEFAULTS,
      primaryLabel,
    })
  }

  static withCrossOriginAction(): BookingAuthenticationFixture {
    return new BookingAuthenticationFixture({
      ...BOOKING_FIXTURE_DEFAULTS,
      destination: BookingFixtureFormDestination.CrossOrigin,
    })
  }

  static ambiguous(): BookingAuthenticationFixture {
    return new BookingAuthenticationFixture({
      ...BOOKING_FIXTURE_DEFAULTS,
      submitLayout: BookingFixtureSubmitLayout.Ambiguous,
    })
  }

  static unowned(): BookingAuthenticationFixture {
    return new BookingAuthenticationFixture({
      ...BOOKING_FIXTURE_DEFAULTS,
      ownership: BookingFixtureFormOwnership.Unowned,
    })
  }

  install(): BookingDomElements {
    const { destination, ownership, primaryLabel, submitLayout } = this.options
    const actionAttribute =
      destination === BookingFixtureFormDestination.CrossOrigin
        ? ' action="https://attacker.example/sign-in"'
        : ''
    const content = `<section data-testid="booking-email-surface"><label>Email address<input type="email" name="username" autocomplete="username webauthn" aria-label="Email address" placeholder="Enter your email address"></label><button type="submit" data-testid="booking-primary">${primaryLabel}</button>${submitLayout === BookingFixtureSubmitLayout.Ambiguous ? '<button type="submit">Primary action</button>' : ''}</section>
        <p>or use one of these options</p><nav aria-label="Alternative sign-in options"><a href="/social/consent/google">Sign in with Google</a><a href="/social/consent/apple">Sign in with Apple</a><a href="/social/consent/facebook">Sign in with Facebook</a></nav>
        <p>Lost access to your email? <a href="/recover">Recover your account</a></p>`
    const authenticationSurface =
      ownership === BookingFixtureFormOwnership.Owned
        ? `<form${actionAttribute} data-testid="booking-auth-form">${content}</form>`
        : `<section data-testid="booking-unowned-surface">${content}</section>`
    document.body.innerHTML = `<header><a href="/">Booking.com</a><button aria-label="Select your language">English</button><a href="/help" aria-label="Help and support">Help</a></header>
      <main><h1>Sign in or create an account</h1><p>You can sign in using your Booking.com account to access our services.</p>
        ${authenticationSurface}<p data-testid="booking-disclosure">By signing in or creating an account, you agree with our <a href="/terms">Terms &amp; Conditions</a> and <a href="/privacy">Privacy Statement</a>.</p>
      </main>`
    const root = document.querySelector<HTMLElement>(
      ownership === BookingFixtureFormOwnership.Owned
        ? '[data-testid="booking-auth-form"]'
        : '[data-testid="booking-unowned-surface"]',
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
    expect(observation.formScope.kind).toBe(PasswordFormScopeKind.Owned)
    const form = fixture.root
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('expected owned Booking.com form')
    }
    expect(form.hasAttribute('method')).toBe(false)
    expect(form.method).toBe('get')
    expect(form.hasAttribute('action')).toBe(false)
    expect(form.action).toBe('https://account.booking.com/sign-in')

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
      implicitSubmissionMethod: 'get',
    })
    const detailedAdvanceControl = facts.detailedAdvanceControl
    if (!detailedAdvanceControl || detailedAdvanceControl.kind !== 'observed') {
      throw new Error('expected typed Booking.com advance-control facts')
    }
    expect(detailedAdvanceControl.observations).toEqual([
      expect.objectContaining({
        label: BookingFixturePrimaryControl.ContinueWithEmail,
        ownership: 'owned-form',
        semanticSubmitControlCount: 1,
        submissionDestinationSource: 'omitted',
        submissionMethod: 'get',
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
    expect(document.querySelectorAll('form')).toHaveLength(1)
    expect(fixture.email).toMatchObject({
      name: 'username',
      type: 'email',
      autocomplete: 'username webauthn',
    })
    expect(fixture.primary.type).toBe('submit')
    expect(fixture.primary.hasAttribute('formaction')).toBe(false)
    for (const label of [
      BookingFixturePrimaryControl.ContinueWithGoogle,
      BookingFixturePrimaryControl.ContinueWithApple,
      BookingFixturePrimaryControl.ContinueWithFacebook,
      BookingFixturePrimaryControl.RecoverAccount,
    ]) {
      const alternative = [...form.querySelectorAll('a')].find(
        (control) => control.textContent?.trim() === label,
      )
      if (!alternative) throw new Error(`expected Booking.com ${label} link`)
      expect(alternative).toBeInstanceOf(HTMLAnchorElement)
      expect(alternative.closest('form')).toBe(form)
    }
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
    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected rejected Booking.com form')
    const request: Parameters<typeof clickAdvanceControl>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
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
      const [observation] = summarizeAuthenticationWorkflowForms()
      if (!observation) throw new Error('expected drifted Booking.com form')
      const request: Parameters<typeof clickAdvanceControl>[0] = {
        kind: PasswordFormQueryKind.Scoped,
        root: observation.root,
        formScope: observation.formScope,
        usernameField: fixture.email,
      }
      expect(clickAdvanceControl(request)).toBe(false)
      expect(primaryState).toBe(BookingFixtureControlState.Untouched)
    },
  )

  test('rejects an inert Continue with email control', () => {
    const fixture = BookingAuthenticationFixture.stable().install()
    fixture.primary.setAttribute('aria-disabled', 'true')
    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected inert Booking.com form')
    const request: Parameters<typeof clickAdvanceControl>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
      usernameField: fixture.email,
    }
    expect(clickAdvanceControl(request)).toBe(false)
  })

  test('rejects an authored cross-origin destination', () => {
    const fixture =
      BookingAuthenticationFixture.withCrossOriginAction().install()
    if (!(fixture.root instanceof HTMLFormElement)) {
      throw new Error('expected cross-origin Booking.com form')
    }
    expect(fixture.root.hasAttribute('action')).toBe(true)
    expect(fixture.root.action).toBe('https://attacker.example/sign-in')
    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected cross-origin Booking.com form')
    const request: Parameters<typeof clickAdvanceControl>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
      usernameField: fixture.email,
    }
    expect(clickAdvanceControl(request)).toBe(false)
    expect(fixture.email.value).toBe('')
  })

  test('rejects ambiguous semantic submits', () => {
    const fixture = BookingAuthenticationFixture.ambiguous().install()
    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected ambiguous Booking.com form')
    const request: Parameters<typeof clickAdvanceControl>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
      usernameField: fixture.email,
    }
    expect(clickAdvanceControl(request)).toBe(false)
    expect(fixture.email.value).toBe('')
  })

  test('rejects the formerly modeled unowned surface', () => {
    const fixture = BookingAuthenticationFixture.unowned().install()
    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected unowned Booking.com surface')
    expect(observation.formScope.kind).toBe(PasswordFormScopeKind.Unowned)
    const request: Parameters<typeof clickAdvanceControl>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
      usernameField: fixture.email,
    }
    expect(clickAdvanceControl(request)).toBe(false)
    expect(fixture.email.value).toBe('')
  })
})
