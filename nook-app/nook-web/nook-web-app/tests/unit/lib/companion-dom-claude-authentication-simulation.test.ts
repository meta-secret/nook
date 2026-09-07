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

type ClaudeFixtureOptions = {
  readonly actionKind: ClaudeActionKind
  readonly action: string
  readonly method: string
  readonly primaryLabel: string
  readonly extraSubmitLabel: string
}

const CLAUDE_FIXTURE_DEFAULTS: ClaudeFixtureOptions = {
  actionKind: ClaudeActionKind.Omitted,
  action: '',
  method: 'post',
  primaryLabel: 'Continue with email',
  extraSubmitLabel: '',
}

function claudeHtml({
  actionKind,
  action,
  method,
  primaryLabel,
  extraSubmitLabel,
}: ClaudeFixtureOptions = CLAUDE_FIXTURE_DEFAULTS): string {
  const actionAttribute =
    actionKind === ClaudeActionKind.Omitted ? '' : ` action="${action}"`
  const extraSubmit = extraSubmitLabel
    ? `<button type="submit">${extraSubmitLabel}</button>`
    : ''
  return `<header><nav aria-label="Claude"><a href="/">Claude</a><a href="/product">Product</a></nav></header>
    <main><h1>Sign in</h1>
      <button type="button" data-provider="google">Continue with Google</button>
      <p aria-label="Authentication method separator">or</p>
      <form method="${method}"${actionAttribute} data-testid="claude-email-form">
        <label>Email<input name="email" type="email" autocomplete="email" aria-label="Email"></label>
        <button type="submit">${primaryLabel}</button>${extraSubmit}
      </form>
      <button type="button" data-provider="sso">Continue with SSO</button>
      <p data-testid="claude-disclosure">By continuing, you acknowledge our privacy policy and product update disclosure.</p>
    </main>`
}

function simulate(html: string) {
  const request: DomAuthenticationSimulationRequest = {
    fixture: { html },
    credentials: FAKE_CREDENTIALS,
  }
  return simulateDomAuthentication(request)
}

function expectFailClosed(html: string): void {
  const result = simulate(html)
  expect(result).toMatchObject({
    kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
    filled: false,
    submissionResult: FormSubmissionResult.NotObserved,
  })
  const email = document.querySelector<HTMLInputElement>('[name="email"]')
  if (!email) throw new Error('expected rejected Claude email field')
  expect(email.value).toBe('')
}

afterEach(() => {
  document.body.replaceChildren()
  history.replaceState({}, '', '/login')
})

describe('Claude DOM-backed authentication simulation', () => {
  test('fills only email and submits its owned Continue with email control', () => {
    expect(location.href).toBe('https://claude.ai/login')
    const result = simulate(claudeHtml())

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
    expect(
      detailedAdvanceControl.observations.some(
        authentication_advance_control_is_safe,
      ),
    ).toBe(true)
  })

  test('keeps provider alternatives outside the owned email form', () => {
    document.body.innerHTML = claudeHtml()
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
    expectFailClosed(
      claudeHtml({
        ...CLAUDE_FIXTURE_DEFAULTS,
        actionKind: ClaudeActionKind.Authored,
        action: 'https://attacker.example/login',
      }),
    )
  })

  test.each(['/signup', '/login?provider=google', '/account/delete'])(
    'rejects the unsafe same-origin action %s',
    (action) => {
      expectFailClosed(
        claudeHtml({
          ...CLAUDE_FIXTURE_DEFAULTS,
          actionKind: ClaudeActionKind.Authored,
          action,
        }),
      )
    },
  )

  test.each(['get', 'dialog'])('rejects the %s form method', (method) => {
    expectFailClosed(claudeHtml({ ...CLAUDE_FIXTURE_DEFAULTS, method }))
  })

  test.each([
    'Continue with Google',
    'Continue with SSO',
    'Forgot password',
    'Delete account',
  ])('rejects the unsafe primary control %s', (primaryLabel) => {
    expectFailClosed(claudeHtml({ ...CLAUDE_FIXTURE_DEFAULTS, primaryLabel }))
    const submit = document.querySelector<HTMLButtonElement>(
      'form button[type="submit"]',
    )
    if (!submit) throw new Error('expected hostile Claude submit control')
    expect(submit.textContent).toBe(primaryLabel)
  })

  test('rejects an ambiguous owned form with two semantic submits', () => {
    expectFailClosed(
      claudeHtml({
        ...CLAUDE_FIXTURE_DEFAULTS,
        extraSubmitLabel: 'Primary action',
      }),
    )
    expect(
      document.querySelectorAll('form button[type="submit"]'),
    ).toHaveLength(2)
  })
})
