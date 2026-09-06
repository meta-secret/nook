import { afterEach, describe, expect, test } from 'vitest'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  CompanionAuthenticationWorkflowMatchKind,
  CredentialFillRejection,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { FormSubmissionResult } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  DomAuthenticationSimulationOutcomeKind,
  simulateDomAuthentication,
  type DomAuthenticationFixture,
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

const NAMECHEAP_PAGE_WIDE_LOGIN: DomAuthenticationFixture = {
  html: `<form id="aspnetForm" method="post">
    <header>
      <input name="LoginUserName" title="Your username" autocomplete="on" hidden value="header-user">
      <input name="LoginPassword" title="Your password" type="password" autocomplete="on" hidden value="header-password">
      <input name="search" type="search" value="account help">
      <button id="header-submit" type="submit">Search</button>
    </header>
    <div class="gb-scope loginBox nc_login"><div class="gb-panel"><div class="gb-panel__body">
      <fieldset class="loginForm">
        <input name="LoginUserName" title="Your username" autocomplete="on" class="gb-form-control nc_username nc_username_required">
        <input name="LoginPassword" title="Your password" type="password" autocomplete="on" class="nc_password nc_password_required handlereturn gb-form-control">
        <input id="login-submit" type="submit" value="Sign in" class="nc_login_submit">
      </fieldset>
    </div></div></div>
    <footer>
      <input name="newsletter-email" type="email" value="reader@example.test">
      <button type="button">Use a passkey</button>
      <button id="footer-submit" type="submit">Subscribe</button>
    </footer>
  </form>`,
}

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
})

function fieldValue(selector: string): string | false {
  const field = document.querySelector<HTMLInputElement>(selector)
  return field ? field.value : false
}

describe('DOM-backed companion authentication simulation', () => {
  test('requires the live Google sign-in route for a form-less identifier step', () => {
    const fixture: DomAuthenticationFixture = {
      html: `<main>
        <h1>Sign in</h1><p>Use your Google Account</p>
        <label for="identifierId">Email or phone</label>
        <input id="identifierId" name="identifier" autocomplete="username webauthn" aria-label="Email or phone">
        <input name="hiddenPassword" type="password" tabindex="-1" aria-hidden="true" hidden>
        <button type="button">Create account</button>
        <div id="identifierNext"><button type="button">Next</button></div>
      </main>`,
    }
    const request: DomAuthenticationSimulationRequest = {
      fixture,
      credentials: FAKE_CREDENTIALS,
    }

    window.history.replaceState({}, '', '/google')
    const genericRoute = simulateDomAuthentication(request)
    expect(genericRoute).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      observationCount: 1,
      selectedRoot: false,
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
    })

    window.history.replaceState({}, '', '/v3/signin/identifier')
    const signInRoute = simulateDomAuthentication(request)
    expect(signInRoute).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.Login,
      observationCount: 1,
      matchKind: CompanionAuthenticationWorkflowMatchKind.Matched,
      workflowKind: AuthenticationWorkflowKind.Login,
      workflowAction: AuthenticationWorkflowAction.ContinueWithNook,
      credentialFillOutcome: CredentialFillJourneyOutcomeKind.Completed,
      credentialFillRejection: false,
      implicitSubmissionMethod: 'absent',
      detailedAdvanceControlKind: 'observed',
      credentialSubmissionKind: 'absent',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
    })
    expect(signInRoute.selectedRoot).toBe(document.querySelector('main'))
    expect(fieldValue('#identifierId')).toBe(FAKE_CREDENTIALS.username)
    expect(fieldValue('[name="hiddenPassword"]')).toBe('')

    const wrongControlRequest: DomAuthenticationSimulationRequest = {
      fixture: {
        html: fixture.html.replace(
          '>Next</button>',
          '>Create account</button>',
        ),
      },
      credentials: FAKE_CREDENTIALS,
    }
    const wrongControl = simulateDomAuthentication(wrongControlRequest)
    expect(wrongControl).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
    })
    expect(fieldValue('#identifierId')).toBe('')
    expect(fieldValue('[name="hiddenPassword"]')).toBe('')
  })

  test('requires the captured Google username and submit semantics for its password continuation', () => {
    window.history.replaceState({}, '', '/v3/signin/challenge/pwd')
    const formLessRequest: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<main>
          <input id="password-input" name="Passwd" type="password" autocomplete="current-password" aria-label="Enter your password">
          <div id="passwordNext"><button type="button">Next</button></div>
        </main>`,
      },
      credentials: FAKE_CREDENTIALS,
    }
    const formLess = simulateDomAuthentication(formLessRequest)
    expect(formLess).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      observationCount: 1,
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
    })
    expect(fieldValue('#password-input')).toBe('')

    const anonymousOwnedRequest: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<main><form method="post" action="/v3/signin/challenge/pwd">
          <input id="password-input" name="Passwd" type="password" autocomplete="current-password" aria-label="Enter your password">
          <div id="passwordNext"><button type="submit">Next</button></div>
        </form></main>`,
      },
      credentials: FAKE_CREDENTIALS,
    }
    const anonymousOwned = simulateDomAuthentication(anonymousOwnedRequest)
    expect(anonymousOwned).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
    })
    expect(fieldValue('#password-input')).toBe('')

    const ownedRequest: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<main><form id="login_form" method="post" action="/auth/login">
          <input id="identifierId" name="identifier" type="email" autocomplete="username" placeholder="Email or phone" aria-label="Email or phone">
          <input id="password-input" name="Passwd" type="password" autocomplete="current-password" aria-label="Enter your password">
          <div id="passwordNext"><button type="submit">Next</button></div>
        </form></main>`,
      },
      credentials: FAKE_CREDENTIALS,
    }
    const owned = simulateDomAuthentication(ownedRequest)
    expect(owned).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.Login,
      matchKind: CompanionAuthenticationWorkflowMatchKind.Matched,
      workflowKind: AuthenticationWorkflowKind.Login,
      workflowAction: AuthenticationWorkflowAction.ContinueWithNook,
      credentialFillOutcome: CredentialFillJourneyOutcomeKind.Completed,
      credentialFillRejection: false,
      credentialSubmissionKind: 'observed',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'Next',
    })
    expect(fieldValue('#identifierId')).toBe(FAKE_CREDENTIALS.username)
    expect(fieldValue('#password-input')).toBe(FAKE_CREDENTIALS.password)
  })

  test('runs both bounded steps of the cross-origin Apple authorization surface', () => {
    window.history.replaceState({}, '', '/appleauth/auth/authorize/signin')
    const identifierRequest: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<main><form id="sign-in-form" method="post" action="/appleauth/auth/authorize/signin"><fieldset aria-label="Sign in to Apple Account">
          <input id="account_name_text_field" name="accountName" type="text" autocomplete="username webauthn" aria-label="Email or Phone Number">
          <input name="decoyPassword" type="password" tabindex="-1" aria-hidden="true" hidden>
          <button type="button">Sign in with Passkey</button>
          <button id="continue" type="submit">Continue</button>
        </fieldset></form></main>`,
      },
      credentials: FAKE_CREDENTIALS,
    }
    const identifier = simulateDomAuthentication(identifierRequest)
    const {
      selectedRoot: identifierRoot,
      observedRoots: identifierObservedRoots,
      ...identifierEvidence
    } = identifier
    expect(identifierEvidence).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.Login,
      matchKind: CompanionAuthenticationWorkflowMatchKind.Matched,
      workflowKind: AuthenticationWorkflowKind.Login,
      workflowAction: AuthenticationWorkflowAction.ContinueWithNook,
      credentialFillOutcome: CredentialFillJourneyOutcomeKind.Completed,
      credentialFillRejection: false,
      credentialSubmissionKind: 'observed',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'continue',
    })
    expect(identifierObservedRoots.length).toBe(1)
    expect(identifierRoot === document).toBe(true)
    expect(fieldValue('#account_name_text_field')).toBe(
      FAKE_CREDENTIALS.username,
    )
    expect(fieldValue('[name="decoyPassword"]')).toBe('')

    const passwordRequest: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<main><form id="sign-in-form" method="post" action="/appleauth/auth/authorize/signin"><fieldset aria-label="Sign in to Apple Account">
          <input id="account_name_text_field" name="accountName" type="text" autocomplete="username webauthn" aria-label="Email or Phone Number">
          <input id="password_text_field" name="password" type="password" autocomplete="current-password" aria-label="Password">
          <input name="decoyPassword" type="password" tabindex="-1" aria-hidden="true" hidden>
          <button type="button">Sign in with Passkey</button>
          <button id="sign-in" type="submit">Sign In</button>
        </fieldset></form></main>`,
      },
      credentials: FAKE_CREDENTIALS,
    }
    const password = simulateDomAuthentication(passwordRequest)
    const {
      selectedRoot: passwordRoot,
      observedRoots: passwordObservedRoots,
      ...passwordEvidence
    } = password
    expect(passwordEvidence).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.Login,
      matchKind: CompanionAuthenticationWorkflowMatchKind.Matched,
      workflowKind: AuthenticationWorkflowKind.Login,
      workflowAction: AuthenticationWorkflowAction.ContinueWithNook,
      credentialFillOutcome: CredentialFillJourneyOutcomeKind.Completed,
      credentialFillRejection: false,
      credentialSubmissionKind: 'observed',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'sign-in',
    })
    expect(passwordObservedRoots.length).toBe(1)
    expect(passwordRoot === document).toBe(true)
    expect(fieldValue('#account_name_text_field')).toBe(
      FAKE_CREDENTIALS.username,
    )
    expect(fieldValue('#password_text_field')).toBe(FAKE_CREDENTIALS.password)
    expect(fieldValue('[name="decoyPassword"]')).toBe('')
  })

  test('keeps an ambiguous Apple password surface fail closed', () => {
    window.history.replaceState({}, '', '/appleauth/auth/authorize/signin')
    const request: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<main><form id="sign-in-form" method="post" action="/appleauth/auth/authorize/signin">
          <input id="account_name_text_field" name="accountName" type="text" autocomplete="username webauthn">
          <input id="password_text_field" name="password" type="password" autocomplete="current-password">
          <input name="otherPassword" type="password" autocomplete="current-password">
          <button id="sign-in" type="submit">Sign In</button>
        </form></main>`,
      },
      credentials: FAKE_CREDENTIALS,
    }
    const result = simulateDomAuthentication(request)

    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
    })
    expect(fieldValue('#account_name_text_field')).toBe('')
    expect(fieldValue('#password_text_field')).toBe('')
    expect(fieldValue('[name="otherPassword"]')).toBe('')
  })

  test('runs the owned GitHub login while leaving external alternatives and hidden decoys untouched', () => {
    window.history.replaceState({}, '', '/login')
    const request: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<main><form data-turbo="false" action="/session" method="post" accept-charset="UTF-8">
          <input name="add_account" type="hidden" value="">
          <input name="webauthn-conditional" type="hidden" value="unknown">
          <input name="javascript-support" type="hidden" value="unknown">
          <input name="webauthn-support" type="hidden" value="unknown">
          <input name="webauthn-iuvpaa-support" type="hidden" value="unknown">
          <input name="return_to" type="hidden" value="">
          <input name="allow_signup" type="hidden" value="">
          <input name="client_id" type="hidden" value="">
          <input name="integration" type="hidden" value="">
          <input name="required_field_mock_auth" class="form-control" type="text" hidden>
          <label for="login_field">Username or email address</label>
          <input type="text" name="login" id="login_field" autocapitalize="off" autocorrect="off" autocomplete="username" autofocus required>
          <label for="password">Password</label>
          <input type="password" name="password" id="password" autocomplete="current-password" required>
          <a id="forgot-password" href="/password_reset">Forgot password?</a>
          <input type="submit" name="commit" value="Sign in" class="js-sign-in-button" data-disable-with="Signing in…" data-signin-label="Sign in" data-sso-label="Sign in with your identity provider">
        </form>
        <section aria-label="Other sign-in options">
          <button type="button">Continue with Google</button>
          <button type="button">Continue with Apple</button>
          <button type="button">Sign in with a passkey</button>
          <a href="/signup">Create an account</a>
        </section></main>`,
      },
      credentials: FAKE_CREDENTIALS,
    }
    const result = simulateDomAuthentication(request)

    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.Login,
      observationCount: 2,
      matchKind: CompanionAuthenticationWorkflowMatchKind.Matched,
      workflowKind: AuthenticationWorkflowKind.Login,
      workflowAction: AuthenticationWorkflowAction.ContinueWithNook,
      credentialFillOutcome: CredentialFillJourneyOutcomeKind.Completed,
      credentialFillRejection: false,
      credentialSubmissionKind: 'observed',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'Sign in',
    })
    expect(result.selectedRoot === document).toBe(true)
    expect(fieldValue('#login_field')).toBe(FAKE_CREDENTIALS.username)
    expect(fieldValue('#password')).toBe(FAKE_CREDENTIALS.password)
    expect(fieldValue('[name="required_field_mock_auth"]')).toBe('')
    expect(fieldValue('[name="add_account"]')).toBe('')
    expect(fieldValue('[name="webauthn-conditional"]')).toBe('unknown')
    expect(fieldValue('[name="javascript-support"]')).toBe('unknown')
    expect(fieldValue('[name="webauthn-support"]')).toBe('unknown')
    expect(fieldValue('[name="webauthn-iuvpaa-support"]')).toBe('unknown')
    expect(fieldValue('[name="return_to"]')).toBe('')
    expect(fieldValue('[name="allow_signup"]')).toBe('')
    expect(fieldValue('[name="client_id"]')).toBe('')
    expect(fieldValue('[name="integration"]')).toBe('')
    const form = document.querySelector('form')
    const forgotPassword = document.querySelector('#forgot-password')
    const submit = document.querySelector('.js-sign-in-button')
    const honeypot = document.querySelector('[name="required_field_mock_auth"]')
    if (!form || !forgotPassword || !submit || !honeypot) {
      throw new Error('expected GitHub structural evidence')
    }
    expect(form.getAttribute('accept-charset')).toBe('UTF-8')
    expect(forgotPassword.closest('form')).toBe(form)
    expect(honeypot.getAttribute('class')).toBe('form-control')
    expect(honeypot.hasAttribute('hidden')).toBe(true)
    expect(honeypot.hasAttribute('autocomplete')).toBe(false)
    expect(honeypot.hasAttribute('tabindex')).toBe(false)
    expect(honeypot.hasAttribute('aria-hidden')).toBe(false)
    expect(submit.getAttribute('data-disable-with')).toBe('Signing in…')
    expect(submit.getAttribute('data-signin-label')).toBe('Sign in')
    expect(submit.getAttribute('data-sso-label')).toBe(
      'Sign in with your identity provider',
    )
  })

  test('runs the Namecheap shell through observation, classification, fill, and submission', () => {
    const request: DomAuthenticationSimulationRequest = {
      fixture: NAMECHEAP_PAGE_WIDE_LOGIN,
      credentials: FAKE_CREDENTIALS,
    }
    const result = simulateDomAuthentication(request)

    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.Login,
      observationCount: 1,
      matchKind: CompanionAuthenticationWorkflowMatchKind.Matched,
      workflowKind: AuthenticationWorkflowKind.Login,
      workflowAction: AuthenticationWorkflowAction.ContinueWithNook,
      credentialFillOutcome: CredentialFillJourneyOutcomeKind.Completed,
      credentialFillRejection: false,
      implicitSubmissionMethod: 'absent',
      advanceControl: 'absent',
      credentialSubmissionKind: 'observed',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'login-submit',
    })
    const loginForm = document.querySelector('.loginForm')
    expect(result.observedRoots).toHaveLength(1)
    expect(result.observedRoots[0]).toBe(loginForm)
    expect(result.selectedRoot).toBe(loginForm)
    expect(fieldValue('.loginForm [name="LoginUserName"]')).toBe(
      FAKE_CREDENTIALS.username,
    )
    expect(fieldValue('.loginForm [name="LoginPassword"]')).toBe(
      FAKE_CREDENTIALS.password,
    )
    expect(fieldValue('header [name="LoginUserName"]')).toBe('header-user')
    expect(fieldValue('header [name="LoginPassword"]')).toBe('header-password')
    expect(fieldValue('[name="search"]')).toBe('account help')
    expect(fieldValue('[name="newsletter-email"]')).toBe('reader@example.test')
  })

  test('selects the local root of an unambiguous login surface', () => {
    const request: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<form method="post"><section class="login-panel"><input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><button id="local-submit" type="submit">Sign in</button></section></form>`,
      },
      credentials: FAKE_CREDENTIALS,
    }
    const result = simulateDomAuthentication(request)
    const loginPanel = document.querySelector('.login-panel')

    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.Login,
      matchKind: CompanionAuthenticationWorkflowMatchKind.Matched,
      workflowKind: AuthenticationWorkflowKind.Login,
      implicitSubmissionMethod: 'absent',
      advanceControl: 'absent',
      credentialSubmissionKind: 'observed',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'local-submit',
    })
    expect(result.observedRoots).toHaveLength(1)
    expect(result.observedRoots[0]).toBe(loginPanel)
    expect(result.selectedRoot).toBe(loginPanel)
  })

  test('does not implicitly submit the page-wide owner without a local control', () => {
    const request: DomAuthenticationSimulationRequest = {
      fixture: {
        html: NAMECHEAP_PAGE_WIDE_LOGIN.html.replace(
          '<input id="login-submit" type="submit" value="Sign in" class="nc_login_submit">',
          '',
        ),
      },
      credentials: FAKE_CREDENTIALS,
    }
    const result = simulateDomAuthentication(request)

    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      implicitSubmissionMethod: 'absent',
      advanceControl: 'absent',
      credentialSubmissionKind: 'absent',
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
      submittedControlIdentity: '',
    })
    const loginForm = document.querySelector('.loginForm')
    expect(result.observedRoots).toHaveLength(1)
    expect(result.observedRoots[0]).toBe(loginForm)
    expect(result.selectedRoot).toBe(false)
    expect(fieldValue('.loginForm [name="LoginUserName"]')).toBe('')
    expect(fieldValue('.loginForm [name="LoginPassword"]')).toBe('')
    expect(fieldValue('header [name="LoginUserName"]')).toBe('header-user')
    expect(fieldValue('[name="newsletter-email"]')).toBe('reader@example.test')
  })

  test.each([
    {
      name: 'OTP sibling',
      extra: '<aside><input autocomplete="one-time-code"></aside>',
      rejection: CredentialFillRejection.OneTimeCodeFieldPresent,
    },
    {
      name: 'second password',
      extra: '<aside><input type="password"></aside>',
      rejection: CredentialFillRejection.AmbiguousPasswordField,
    },
    {
      name: 'second username',
      extra: '<aside><input autocomplete="username"></aside>',
      rejection: CredentialFillRejection.AmbiguousUsernameField,
    },
  ])('fails closed for an ambiguous $name', ({ extra, rejection }) => {
    const fixture: DomAuthenticationFixture = {
      html: `<form method="post"><fieldset class="loginForm"><input id="username" autocomplete="username"><input id="password" type="password" autocomplete="on"><button id="login-submit" type="submit">Sign in</button></fieldset>${extra}</form>`,
    }
    const request: DomAuthenticationSimulationRequest = {
      fixture,
      credentials: FAKE_CREDENTIALS,
    }
    const result = simulateDomAuthentication(request)

    expect(result.kind).toBe(DomAuthenticationSimulationOutcomeKind.FailClosed)
    expect(result.selectedRoot).toBe(document)
    expect(result.credentialFillOutcome).toBe(
      CredentialFillJourneyOutcomeKind.Rejected,
    )
    expect(result.credentialFillRejection).toBe(rejection)
    expect(result.filled).toBe(false)
    expect(result.submissionResult).toBe(FormSubmissionResult.NotObserved)
    expect(result.submittedControlIdentity).toBe('')
    expect(fieldValue('#username')).toBe('')
    expect(fieldValue('#password')).toBe('')
    expect(fieldValue('aside input')).toBe('')
  })
})
