// @vitest-environment-options { "url": "https://login.live.com/oauth20_authorize.srf?client_id=fixture-client&scope=openid%20profile" }

import { afterEach, describe, expect, test } from 'vitest'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  CompanionAuthenticationWorkflowMatchKind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { FormSubmissionResult } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  DomAuthenticationSimulationOutcomeKind,
  simulateDomAuthentication,
  type DomAuthenticationSimulationRequest,
} from './companion-dom-authentication-simulation'

afterEach(() => document.body.replaceChildren())

describe('Microsoft consumer authorization username-first shell', () => {
  test('detects and fills the identifier before a password is present', () => {
    expect(location.pathname).toBe('/oauth20_authorize.srf')
    const request: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<main><h1>Sign in</h1><p>Use your Microsoft account</p>
          <form method="post">
            <input id="usernameEntry" type="email" autocomplete="username webauthn"
              placeholder="Email or phone number">
            <button type="button">Forgot your username?</button>
            <button type="submit">Next</button>
          </form>
          <a href="/create-account">Create an account</a>
        </main>`,
      },
      credentials: {
        username: 'dom-user@example.test',
        password: 'dom-fake-password',
      },
    }

    const result = simulateDomAuthentication(request)

    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.Login,
      observationCount: 1,
      matchKind: CompanionAuthenticationWorkflowMatchKind.Matched,
      workflowKind: AuthenticationWorkflowKind.Login,
      workflowAction: AuthenticationWorkflowAction.ContinueWithNook,
      credentialSubmissionKind: 'observed',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'Next',
    })
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
    expect(document.querySelector<HTMLInputElement>('#usernameEntry')?.value).toBe(
      request.credentials.username,
    )
  })

  test('ignores an unrelated single email field on the same authority', () => {
    const request: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<main><h1>Newsletter preferences</h1>
          <form method="post">
            <input type="email" name="newsletter-email" placeholder="Email address">
            <button type="submit">Subscribe</button>
          </form>
        </main>`,
      },
      credentials: {
        username: 'dom-user@example.test',
        password: 'dom-fake-password',
      },
    }

    const result = simulateDomAuthentication(request)

    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.FailClosed,
      filled: false,
      submissionResult: FormSubmissionResult.NotObserved,
      submittedControlIdentity: '',
    })
    expect(
      document.querySelector<HTMLInputElement>('[name="newsletter-email"]')?.value,
    ).toBe('')
  })
})
