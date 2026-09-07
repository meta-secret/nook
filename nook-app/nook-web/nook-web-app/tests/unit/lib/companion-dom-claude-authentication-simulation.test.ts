// @vitest-environment-options { "url": "https://claude.ai/login" }

import { afterEach, describe, expect, test } from 'vitest'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  CompanionAuthenticationWorkflowMatchKind,
  authentication_advance_control_is_safe,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authenticationPageObservationFacts,
  FormSubmissionResult,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  DomAuthenticationSimulationOutcomeKind,
  simulateDomAuthentication,
  type DomAuthenticationSimulationResult,
  type DomAuthenticationSimulationRequest,
} from './companion-dom-authentication-simulation'
import {
  CredentialFillJourneyOutcomeKind,
  type FakeLoginCredentials,
} from './companion-credential-fill-simulation'

const FAKE_CREDENTIALS: FakeLoginCredentials = {
  username: 'dom-user@example.test',
  password: 'dom-fake-password',
}

enum ClaudeActionKind {
  Omitted = 'omitted',
  Authored = 'authored',
}

type ClaudeFixtureAction =
  | { readonly kind: ClaudeActionKind.Omitted }
  | { readonly kind: ClaudeActionKind.Authored; readonly destination: URL }

enum ClaudeFixtureFormMethod {
  Post = 'post',
  Get = 'get',
  Dialog = 'dialog',
}

enum ClaudeFixturePrimaryControl {
  ContinueWithEmail = 'Continue with email',
  ContinueWithGoogle = 'Continue with Google',
  ContinueWithSso = 'Continue with SSO',
  ForgotPassword = 'Forgot password',
  DeleteAccount = 'Delete account',
}

enum ClaudeFixtureSubmitLayout {
  Sole = 'sole',
  Ambiguous = 'ambiguous',
}

type ClaudeFixtureOptions = {
  readonly action: ClaudeFixtureAction
  readonly method: ClaudeFixtureFormMethod
  readonly primaryControl: ClaudeFixturePrimaryControl
  readonly submitLayout: ClaudeFixtureSubmitLayout
}

const CLAUDE_FIXTURE_DEFAULTS: ClaudeFixtureOptions = {
  action: { kind: ClaudeActionKind.Omitted },
  method: ClaudeFixtureFormMethod.Post,
  primaryControl: ClaudeFixturePrimaryControl.ContinueWithEmail,
  submitLayout: ClaudeFixtureSubmitLayout.Sole,
}

class ClaudeAuthenticationFixture {
  private constructor(private readonly options: ClaudeFixtureOptions) {}

  static stable(): ClaudeAuthenticationFixture {
    return new ClaudeAuthenticationFixture(CLAUDE_FIXTURE_DEFAULTS)
  }

  static withAction(destination: URL): ClaudeAuthenticationFixture {
    return new ClaudeAuthenticationFixture({
      ...CLAUDE_FIXTURE_DEFAULTS,
      action: { kind: ClaudeActionKind.Authored, destination },
    })
  }

  static withMethod(
    method: ClaudeFixtureFormMethod,
  ): ClaudeAuthenticationFixture {
    return new ClaudeAuthenticationFixture({
      ...CLAUDE_FIXTURE_DEFAULTS,
      method,
    })
  }

  static withPrimaryControl(
    primaryControl: ClaudeFixturePrimaryControl,
  ): ClaudeAuthenticationFixture {
    return new ClaudeAuthenticationFixture({
      ...CLAUDE_FIXTURE_DEFAULTS,
      primaryControl,
    })
  }

  static ambiguous(): ClaudeAuthenticationFixture {
    return new ClaudeAuthenticationFixture({
      ...CLAUDE_FIXTURE_DEFAULTS,
      submitLayout: ClaudeFixtureSubmitLayout.Ambiguous,
    })
  }

  html(): string {
    const { action, method, primaryControl, submitLayout } = this.options
    const actionAttribute =
      action.kind === ClaudeActionKind.Authored
        ? ` action="${action.destination.toString()}"`
        : ''
    const extraSubmit =
      submitLayout === ClaudeFixtureSubmitLayout.Ambiguous
        ? '<button type="submit">Primary action</button>'
        : ''
    return `<header><nav aria-label="Claude"><a href="/">Claude</a><a href="/product">Product</a></nav></header>
      <main><h1>Sign in</h1>
        <button type="button" data-provider="google">Continue with Google</button>
        <p aria-label="Authentication method separator">or</p>
        <form method="${method}"${actionAttribute} data-testid="claude-email-form">
          <label>Email<input name="email" type="email" autocomplete="email" aria-label="Email"></label>
          <button type="submit">${primaryControl}</button>${extraSubmit}
        </form>
        <button type="button" data-provider="sso">Continue with SSO</button>
        <p data-testid="claude-disclosure">By continuing, you acknowledge our privacy policy and product update disclosure.</p>
      </main>`
  }

  simulate(): DomAuthenticationSimulationResult {
    const request: DomAuthenticationSimulationRequest = {
      fixture: { html: this.html() },
      credentials: FAKE_CREDENTIALS,
    }
    return simulateDomAuthentication(request)
  }

  expectFailClosed(): void {
    const result = this.simulate()
    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
    })
    const email = document.querySelector<HTMLInputElement>('[name="email"]')
    if (!email) throw new Error('expected rejected Claude email field')
    expect(email.value).toBe('')
  }
}

afterEach(() => {
  document.body.replaceChildren()
  history.replaceState({}, '', '/login')
})

describe('Claude DOM-backed authentication simulation', () => {
  test('fills only email and submits its owned Continue with email control', () => {
    expect(location.href).toBe('https://claude.ai/login')
    const result = ClaudeAuthenticationFixture.stable().simulate()

    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.Login,
      observationCount: 1,
      matchKind: CompanionAuthenticationWorkflowMatchKind.Matched,
      workflowKind: AuthenticationWorkflowKind.Login,
      workflowAction: AuthenticationWorkflowAction.ContinueWithNook,
      credentialFillOutcome: CredentialFillJourneyOutcomeKind.Completed,
      credentialFillRejection: false,
      credentialSubmissionKind: 'observed',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'Continue with email',
    })
    const form = document.querySelector<HTMLFormElement>(
      '[data-testid="claude-email-form"]',
    )
    const email = document.querySelector<HTMLInputElement>('[name="email"]')
    const google = document.querySelector<HTMLButtonElement>(
      '[data-provider="google"]',
    )
    const sso = document.querySelector<HTMLButtonElement>(
      '[data-provider="sso"]',
    )
    if (!form || !email || !google || !sso) {
      throw new Error('expected Claude structural evidence')
    }
    expect(form.method).toBe('post')
    expect(form.hasAttribute('action')).toBe(false)
    expect(form.action).toBe('https://claude.ai/login')
    expect(email).toMatchObject({
      type: 'email',
      name: 'email',
      autocomplete: 'email',
      value: FAKE_CREDENTIALS.username,
    })
    expect(google.type).toBe('button')
    expect(sso.type).toBe('button')
    expect(Boolean(google.form)).toBe(false)
    expect(Boolean(sso.form)).toBe(false)
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
    expect(
      document.querySelector('[data-testid="claude-disclosure"]'),
    ).toBeTruthy()
    expect(document.querySelector('nav[aria-label="Claude"]')).toBeTruthy()

    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected Claude observation')
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
        sourceOrigin: 'https://claude.ai',
        destinationIdentity: 'https://claude.ai/login',
      },
      implicitSubmissionMethod: 'post',
    })
    const detailedAdvanceControl = facts.detailedAdvanceControl
    if (!detailedAdvanceControl || detailedAdvanceControl.kind !== 'observed') {
      throw new Error('expected typed Claude advance-control facts')
    }
    expect(detailedAdvanceControl.observations).toEqual([
      expect.objectContaining({
        label: 'Continue with email',
        submissionDestinationSource: 'omitted',
        submissionMethod: 'post',
      }),
    ])
    expect(
      detailedAdvanceControl.observations.some(
        authentication_advance_control_is_safe,
      ),
    ).toBe(true)
  })

  test('keeps provider alternatives outside the owned email form', () => {
    document.body.innerHTML = ClaudeAuthenticationFixture.stable().html()
    const form = document.querySelector<HTMLFormElement>(
      '[data-testid="claude-email-form"]',
    )
    if (!form) throw new Error('expected Claude email form')
    expect(form.elements).toHaveLength(2)
    expect(form.textContent).toContain('Continue with email')
    expect(form.textContent).not.toContain('Continue with Google')
    expect(form.textContent).not.toContain('Continue with SSO')
  })

  test('rejects a cross-origin destination', () => {
    ClaudeAuthenticationFixture.withAction(
      new URL('https://attacker.example/login'),
    ).expectFailClosed()
  })

  test.each(['/signup', '/login?provider=google', '/account/delete'])(
    'rejects the unsafe same-origin action %s',
    (action) => {
      ClaudeAuthenticationFixture.withAction(
        new URL(action, location.origin),
      ).expectFailClosed()
    },
  )

  test.each([ClaudeFixtureFormMethod.Get, ClaudeFixtureFormMethod.Dialog])(
    'rejects the %s form method',
    (method) => {
      ClaudeAuthenticationFixture.withMethod(method).expectFailClosed()
    },
  )

  test.each([
    ClaudeFixturePrimaryControl.ContinueWithGoogle,
    ClaudeFixturePrimaryControl.ContinueWithSso,
    ClaudeFixturePrimaryControl.ForgotPassword,
    ClaudeFixturePrimaryControl.DeleteAccount,
  ])('rejects the unsafe primary control %s', (primaryControl) => {
    ClaudeAuthenticationFixture.withPrimaryControl(
      primaryControl,
    ).expectFailClosed()
    const submit = document.querySelector<HTMLButtonElement>(
      'form button[type="submit"]',
    )
    if (!submit) throw new Error('expected hostile Claude submit control')
    expect(submit.textContent).toBe(primaryControl)
  })

  test('rejects an ambiguous owned form with two semantic submits', () => {
    ClaudeAuthenticationFixture.ambiguous().expectFailClosed()
    expect(
      document.querySelectorAll('form button[type="submit"]'),
    ).toHaveLength(2)
  })
})
