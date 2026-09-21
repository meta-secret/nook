// @vitest-environment-options { "url": "https://www.airbnb.com/" }

import { afterEach, describe, expect, test } from 'vitest'

import { CredentialFillRejection } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
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

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
})

function fieldValue(selector: string): string | false {
  const field = document.querySelector<HTMLInputElement>(selector)
  return field ? field.value : false
}

describe('DOM authentication credential boundaries', () => {
  test('fails closed for an OTP sibling in the shared form', () => {
    const fixture: DomAuthenticationFixture = {
      html: '<form method="post"><fieldset class="loginForm"><input id="username" autocomplete="username"><input id="password" type="password" autocomplete="on"><button id="login-submit" type="submit">Sign in</button></fieldset><aside><input autocomplete="one-time-code"></aside></form>',
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
    expect(result.credentialFillRejection).toBe(
      CredentialFillRejection.OneTimeCodeFieldPresent,
    )
    expect(result.filled).toBe(false)
    expect(result.submissionResult).toBe(FormSubmissionResult.NotObserved)
    expect(result.submittedControlIdentity).toBe('')
    expect(fieldValue('#username')).toBe('')
    expect(fieldValue('#password')).toBe('')
    expect(fieldValue('aside input')).toBe('')
  })

  test.each([
    {
      name: 'password',
      extra: '<aside><input type="password"></aside>',
    },
    {
      name: 'username',
      extra: '<aside><input autocomplete="username"></aside>',
    },
  ])(
    'keeps a bounded login cluster independent from an unrelated $name sibling',
    ({ extra }) => {
      const fixture: DomAuthenticationFixture = {
        html: `<form method="post"><fieldset class="loginForm"><input id="username" autocomplete="username"><input id="password" type="password" autocomplete="on"><button id="login-submit" type="submit">Sign in</button></fieldset>${extra}</form>`,
      }
      const request: DomAuthenticationSimulationRequest = {
        fixture,
        credentials: FAKE_CREDENTIALS,
      }
      const result = simulateDomAuthentication(request)

      expect(result).toMatchObject({
        kind: DomAuthenticationSimulationOutcomeKind.Login,
        credentialFillOutcome: CredentialFillJourneyOutcomeKind.Completed,
        credentialFillRejection: false,
        filled: true,
        submissionResult: FormSubmissionResult.Submitted,
        submittedControlIdentity: 'login-submit',
      })
      expect(result.selectedRoot).toBe(document.querySelector('.loginForm'))
      expect(fieldValue('#username')).toBe(FAKE_CREDENTIALS.username)
      expect(fieldValue('#password')).toBe(FAKE_CREDENTIALS.password)
      expect(fieldValue('aside input')).toBe('')
    },
  )

  test('revalidates an ordinary login after password disclosure without touching unrelated fields', () => {
    const request: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<main><form method="post"><label>Email<input id="login-email" autocomplete="username"></label><label>Password<input id="login-password" type="password" autocomplete="current-password"></label><button id="login-submit" type="submit">Sign in</button></form><aside><input id="unrelated-email" type="email" value="reader@example.test"></aside></main>`,
      },
      credentials: FAKE_CREDENTIALS,
    }

    const result = simulateDomAuthentication(request)

    expect(result).toMatchObject({
      kind: DomAuthenticationSimulationOutcomeKind.Login,
      credentialFillOutcome: CredentialFillJourneyOutcomeKind.Completed,
      filled: true,
      submissionResult: FormSubmissionResult.Submitted,
      submittedControlIdentity: 'login-submit',
    })
    expect(fieldValue('#login-email')).toBe(FAKE_CREDENTIALS.username)
    expect(fieldValue('#login-password')).toBe(FAKE_CREDENTIALS.password)
    expect(fieldValue('#unrelated-email')).toBe('reader@example.test')
  })

  test('clears disclosed credentials when the page invalidates its password field', () => {
    const request: DomAuthenticationSimulationRequest = {
      fixture: {
        html: `<form method="post"><input id="login-email" autocomplete="username"><input id="login-password" type="password" autocomplete="current-password"><button id="login-submit" type="submit">Sign in</button></form><input id="unrelated-email" type="email" value="reader@example.test">`,
      },
      credentials: FAKE_CREDENTIALS,
      prepareDocument: (simulationDocument) => {
        const password =
          simulationDocument.querySelector<HTMLInputElement>('#login-password')
        if (!password) throw new Error('password fixture field missing')
        password.addEventListener(
          'input',
          () => {
            password.readOnly = true
          },
          { once: true },
        )
      },
    }

    const result = simulateDomAuthentication(request)

    expect(result.filled).toBe(false)
    expect(result.submissionResult).toBe(FormSubmissionResult.NotObserved)
    expect(result.submittedControlIdentity).toBe('')
    expect(fieldValue('#login-email')).toBe('')
    expect(fieldValue('#login-password')).toBe('')
    expect(fieldValue('#unrelated-email')).toBe('reader@example.test')
  })
})
