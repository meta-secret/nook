// @vitest-environment-options { "url": "https://www.amazon.com/ap/signin?openid.mode=checkid_setup" }

import { afterEach, describe, expect, test } from 'vitest'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  CompanionAuthenticationWorkflowMatchKind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  FormSubmissionResult,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  DomAuthenticationSimulationOutcomeKind,
  simulateDomAuthentication,
} from './companion-dom-authentication-simulation'
import { CredentialFillJourneyOutcomeKind } from './companion-credential-fill-simulation'

afterEach(() => document.body.replaceChildren())

describe('Amazon DOM-backed authentication simulation', () => {
  test('fills only the visible identifier and submits its owned Continue', () => {
    document.body.innerHTML = `<form name="ue_backdetect" action="get"></form>
      <form name="ue_backdetect" action="get"></form>
      <main><form id="ap_login_form" name="signIn" method="post" action="/ax/claim">
        <input type="hidden" name="appAction" value="SIGNIN_PWD_COLLECT">
        <input type="hidden" name="openid.mode" value="checkid_setup">
        <label for="ap_email_login">Enter mobile number or email</label>
        <input id="ap_email_login" name="email" type="email" autocomplete="webauthn" aria-label="Enter mobile number or email">
        <input id="auth-credential-autofill-hint" class="a-input-text aok-hidden" name="password" type="password" style="display:none;visibility:hidden">
        <button type="submit">Continue</button>
      </form><a href="/business/register">Create a free business account</a>
      <footer><a href="/help">Help</a><a href="/conditions">Conditions of Use</a><a href="/privacy">Privacy Notice</a></footer></main>`

    const result = simulateDomAuthentication({
      fixture: { html: document.body.innerHTML },
      credentials: {
        username: 'dom-user@example.test',
        password: 'dom-fake-password',
      },
    })

    expect(location.href).toBe(
      'https://www.amazon.com/ap/signin?openid.mode=checkid_setup',
    )
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
    const [observation] =
      passwordFormInteraction.summarizeAuthenticationWorkflowForms()
    if (!observation)
      throw new Error('expected Amazon authentication observation')
    const facts = passwordFormInteraction.authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.fields).toMatchObject({
      usernameFieldCount: 1,
      currentPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      newPasswordFieldCount: 0,
    })
    expect(facts.authenticator.passkeyControl).toBe('absent')
    expect(facts.credentialSubmission).toMatchObject({
      kind: 'observed',
      facts: { actionability: 'actionable', method: 'post' },
    })

    const form = document.querySelector<HTMLFormElement>('#ap_login_form')
    const email = document.querySelector<HTMLInputElement>('#ap_email_login')
    const password = document.querySelector<HTMLInputElement>(
      '#auth-credential-autofill-hint',
    )
    const submit = document.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )
    if (!form || !email || !password || !submit) {
      throw new Error('expected Amazon structural evidence')
    }
    expect(result.selectedRoot === document).toBe(true)
    expect(email.form === form).toBe(true)
    expect(submit.form === form).toBe(true)
    expect(email.value).toBe('dom-user@example.test')
    expect(email.autocomplete).toBe('webauthn')
    expect(password.value).toBe('')
    expect(password.form === form).toBe(true)
    expect(getComputedStyle(password).display).toBe('none')
    expect(getComputedStyle(password).visibility).toBe('hidden')
    expect(form).toMatchObject({
      id: 'ap_login_form',
      name: 'signIn',
      method: 'post',
    })
    expect(form.getAttribute('action')).toBe('/ax/claim')
    expect(
      [...form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map(
        (field) => `${field.name}=${field.value}`,
      ),
    ).toEqual(['appAction=SIGNIN_PWD_COLLECT', 'openid.mode=checkid_setup'])
    const decoys = document.querySelectorAll<HTMLFormElement>(
      'form[name="ue_backdetect"]',
    )
    expect(decoys).toHaveLength(2)
    expect([...decoys].every((decoy) => decoy.action.endsWith('/get'))).toBe(
      true,
    )
    expect([...decoys].every((decoy) => decoy.elements.length === 0)).toBe(true)
    expect(
      [...document.querySelectorAll<HTMLAnchorElement>('a')].map(
        (link) => `${link.textContent}:${link.getAttribute('href')}`,
      ),
    ).toEqual([
      'Create a free business account:/business/register',
      'Help:/help',
      'Conditions of Use:/conditions',
      'Privacy Notice:/privacy',
    ])
  })
})
