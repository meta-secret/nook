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
})

function fieldValue(selector: string): string | false {
  const field = document.querySelector<HTMLInputElement>(selector)
  return field ? field.value : false
}

describe('DOM-backed companion authentication simulation', () => {
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
      implicitSubmissionMethod: 'post',
      advanceControl: 'absent',
      credentialSubmissionKind: 'observed',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'login-submit',
    })
    expect(result.observedRoots).toHaveLength(1)
    expect(result.observedRoots[0]).toBe(document)
    expect(result.selectedRoot).toBe(document)
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
      implicitSubmissionMethod: 'post',
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
    expect(result.observedRoots).toHaveLength(1)
    expect(result.observedRoots[0]).toBe(document)
    expect(result.selectedRoot).toBe(document)
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
