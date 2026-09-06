// @vitest-environment-options { "url": "https://login.live.com/" }

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
import {
  CredentialFillJourneyOutcomeKind,
  type FakeLoginCredentials,
} from './companion-credential-fill-simulation'

const FAKE_CREDENTIALS: FakeLoginCredentials = {
  username: 'dom-user@example.test',
  password: 'dom-fake-password',
}

afterEach(() => document.body.replaceChildren())

describe('Microsoft consumer DOM-backed authentication simulation', () => {
  test('fills the root identifier form and submits only semantic Next', () => {
    expect(location.href).toBe('https://login.live.com/')
    const request: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<form method="post" action="" data-testid="microsoft-unrelated-empty-form"></form>
        <main><h1>Sign in</h1>
          <form method="post" data-testid="microsoft-consumer-form">
            <button type="button" aria-label="Close">Close</button>
            <label for="usernameEntry">Email or phone number</label>
            <input id="usernameEntry" type="email" autocomplete="username webauthn">
            <button type="button">Forgot your username?</button>
            <button type="submit">Next</button>
          </form>
          <nav aria-label="Microsoft account help">
            <a href="/create-account">Create an account</a>
            <a href="/help">Help</a><a href="/feedback">Feedback</a>
            <a href="/terms">Terms of use</a>
            <a href="/privacy">Privacy &amp; cookies</a>
          </nav>
          <p>Use a private browsing window if this is not your device.</p>
        </main>`,
      },
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
      credentialSubmissionKind: 'observed',
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'Next',
    })
    const username = document.querySelector<HTMLInputElement>('#usernameEntry')
    const activeForm = document.querySelector<HTMLFormElement>(
      '[data-testid="microsoft-consumer-form"]',
    )
    const unrelatedForm = document.querySelector<HTMLFormElement>(
      '[data-testid="microsoft-unrelated-empty-form"]',
    )
    const close = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close"]',
    )
    const recovery = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Forgot your username?',
    )
    const next = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Next',
    )
    if (
      !username ||
      !activeForm ||
      !unrelatedForm ||
      !close ||
      !recovery ||
      !next
    ) {
      throw new Error('expected Microsoft consumer structural evidence')
    }
    expect(username.value).toBe(FAKE_CREDENTIALS.username)
    expect(result.selectedRoot === document).toBe(true)
    expect(username.form === activeForm).toBe(true)
    expect(next.form === activeForm).toBe(true)
    expect(activeForm.id).toBe('')
    expect(activeForm.name).toBe('')
    expect(activeForm.hasAttribute('aria-label')).toBe(false)
    expect(activeForm.getAttribute('method')).toBe('post')
    expect(activeForm.hasAttribute('action')).toBe(false)
    expect(unrelatedForm.getAttribute('method')).toBe('post')
    expect(unrelatedForm.getAttribute('action')).toBe('')
    expect(unrelatedForm.elements).toHaveLength(0)
    expect(close.type).toBe('button')
    expect(recovery.type).toBe('button')
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
    expect(document.querySelectorAll('#i0116, [name="loginfmt"]')).toHaveLength(
      0,
    )
  })
})
