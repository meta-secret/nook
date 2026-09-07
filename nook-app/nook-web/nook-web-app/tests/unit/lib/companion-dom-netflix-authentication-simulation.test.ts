// @vitest-environment-options { "url": "https://www.netflix.com/login" }

import { afterEach, describe, expect, test } from 'vitest'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  CompanionAuthenticationWorkflowMatchKind,
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

type NetflixFixtureOverrides = {
  readonly actionKind: NetflixFormActionKind
  readonly action: string
  readonly method: string
  readonly primaryLabel: string
  readonly includePrimary: boolean
}

enum NetflixFormActionKind {
  Omitted = 'omitted',
  Authored = 'authored',
}

const NETFLIX_FIXTURE_DEFAULTS: NetflixFixtureOverrides = {
  actionKind: NetflixFormActionKind.Omitted,
  action: '',
  method: 'post',
  primaryLabel: 'Continue',
  includePrimary: true,
}

function netflixHtml({
  actionKind,
  action,
  method,
  primaryLabel,
  includePrimary,
}: NetflixFixtureOverrides = NETFLIX_FIXTURE_DEFAULTS): string {
  const actionAttribute =
    actionKind === NetflixFormActionKind.Omitted ? '' : ` action="${action}"`
  const primary = includePrimary
    ? `<button type="submit" data-testid="netflix-continue">${primaryLabel}</button>`
    : ''
  return `<main><h1>Enter your info to sign in</h1>
    <form method="${method}"${actionAttribute} data-testid="netflix-login-form">
      <label>Email or mobile number<input name="userLoginId" type="text" autocomplete="email" aria-label="Email or mobile number"></label>
      <label>Password<input name="password" type="password" autocomplete="password" aria-label="Password"></label>
      ${primary}<button type="button" data-testid="netflix-help">Get Help</button>
    </form>
    <section><h2>Or get started with a new account.</h2><a href="/signup">Sign up</a></section>
    <p data-testid="netflix-recaptcha-disclosure">This page is protected by reCAPTCHA to ensure you're not a bot.</p>
    <footer><a href="/help">Questions? Contact us.</a><a href="/terms">Terms of Use</a><a href="/privacy">Privacy</a>
      <label>Language<select><option>English</option></select></label></footer>
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
  const username = document.querySelector<HTMLInputElement>(
    '[name="userLoginId"]',
  )
  const password = document.querySelector<HTMLInputElement>('[name="password"]')
  if (!username || !password) {
    throw new Error('expected rejected Netflix credentials')
  }
  expect(username.value).toBe('')
  expect(password.value).toBe('')
}

afterEach(() => {
  document.body.replaceChildren()
  history.replaceState({}, '', '/login')
})

describe('Netflix DOM-backed authentication simulation', () => {
  test('fills both visible credentials and submits only Continue', () => {
    expect(location.href).toBe('https://www.netflix.com/login')
    const html = netflixHtml()
    const result = simulate(html)

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
      submittedControlIdentity: 'Continue',
    })
    const form = document.querySelector<HTMLFormElement>(
      '[data-testid="netflix-login-form"]',
    )
    const username = document.querySelector<HTMLInputElement>(
      '[name="userLoginId"]',
    )
    const password =
      document.querySelector<HTMLInputElement>('[name="password"]')
    const help = document.querySelector<HTMLButtonElement>(
      '[data-testid="netflix-help"]',
    )
    if (!form || !username || !password || !help) {
      throw new Error('expected Netflix structural evidence')
    }
    expect(form.method).toBe('post')
    expect(form.hasAttribute('action')).toBe(false)
    expect(form.action).toBe('https://www.netflix.com/login')
    expect(username).toMatchObject({
      type: 'text',
      name: 'userLoginId',
      autocomplete: 'email',
      value: FAKE_CREDENTIALS.username,
    })
    expect(password).toMatchObject({
      type: 'password',
      name: 'password',
      autocomplete: 'password',
      value: FAKE_CREDENTIALS.password,
    })
    expect(help.type).toBe('button')
    const heading = document.querySelector('h1')
    const newAccountHeading = document.querySelector('h2')
    if (!heading || !newAccountHeading) {
      throw new Error('expected Netflix headings')
    }
    expect(heading.textContent).toBe('Enter your info to sign in')
    expect(newAccountHeading.textContent).toBe(
      'Or get started with a new account.',
    )
    const disclosure = document.querySelector(
      '[data-testid="netflix-recaptcha-disclosure"]',
    )
    const language = document.querySelector('footer select')
    if (!disclosure || !language) {
      throw new Error('expected Netflix disclosure and language controls')
    }
    expect(disclosure.textContent).toContain('protected by reCAPTCHA')
    expect(language.tagName).toBe('SELECT')

    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected Netflix observation')
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.fields).toMatchObject({
      usernameFieldCount: 1,
      currentPasswordFieldCount: 1,
    })
    expect(facts.ceremony).toMatchObject({
      sourceOrigin: 'https://www.netflix.com',
      destinationIdentity: 'https://www.netflix.com/login',
      implicitSubmissionMethod: 'absent',
    })
  })

  test('rejects a cross-origin form destination', () => {
    expectFailClosed(
      netflixHtml({
        ...NETFLIX_FIXTURE_DEFAULTS,
        actionKind: NetflixFormActionKind.Authored,
        action: 'https://attacker.example/login',
      }),
    )
  })

  test.each([
    '/help',
    '/signup',
    '/login?provider=google',
    '/login?action=delete',
  ])('rejects the unsafe same-origin action %s', (action) =>
    expectFailClosed(
      netflixHtml({
        ...NETFLIX_FIXTURE_DEFAULTS,
        actionKind: NetflixFormActionKind.Authored,
        action,
      }),
    ),
  )

  test.each(['get', 'dialog'])('rejects the %s form method', (method) => {
    expectFailClosed(netflixHtml({ ...NETFLIX_FIXTURE_DEFAULTS, method }))
  })

  test.each([
    'Get Help',
    'Forgot password',
    'Sign in with Google',
    'Use passkey',
    'Continue with SAML',
    'Sign in with SSO',
    'Create account',
    'Delete account',
  ])('rejects the unsafe primary control %s', (primaryLabel) => {
    expectFailClosed(netflixHtml({ ...NETFLIX_FIXTURE_DEFAULTS, primaryLabel }))
  })

  test('does not treat the auxiliary Get Help button as submission', () => {
    expectFailClosed(
      netflixHtml({ ...NETFLIX_FIXTURE_DEFAULTS, includePrimary: false }),
    )
    const help = document.querySelector<HTMLButtonElement>(
      '[data-testid="netflix-help"]',
    )
    if (!help) throw new Error('expected rejected Netflix help control')
    expect(help.type).toBe('button')
  })
})
