import capturedShell from './fixtures/email-first-reset-utilities.html?raw'
import { afterEach, describe, expect, test } from 'vitest'
import {
  AuthenticationWorkflowKind,
  authentication_advance_control_is_safe,
  classify_companion_authentication_workflow_facts,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { passwordFormInteraction } from '../../../../nook-web-shared/src/extension/password-forms'

class EmailFirstResetFixture {
  mount(): void {
    document.body.innerHTML = capturedShell
    history.replaceState({}, '', '/signin?l=en')
  }

  facts() {
    const [observation] =
      passwordFormInteraction.summarizeAuthenticationWorkflowForms()
    switch (typeof observation) {
      case 'undefined':
        throw new Error('Expected the captured email-first observation')
      case 'object':
        break
    }
    const request: Parameters<
      typeof passwordFormInteraction.authenticationPageObservationFacts
    >[0] = {
      observation,
      authenticatorSetupHint: 'absent',
      backupCodesCopy: '',
    }
    return passwordFormInteraction.authenticationPageObservationFacts(request)
  }
}

afterEach(() => document.body.replaceChildren())

describe('captured email-first reset utility shell', () => {
  test('keeps Continue in the scope and classifies the actual progression as Login', () => {
    const fixture = new EmailFirstResetFixture()
    fixture.mount()
    const facts = fixture.facts()
    expect(facts.fields.usernameFieldCount).toBe(1)
    expect(facts.fields.currentPasswordFieldCount).toBe(0)
    const detail = facts.detailedAdvanceControl
    switch (typeof detail) {
      case 'undefined':
        throw new Error('Expected detailed Continue observation')
      case 'object':
        break
    }
    switch (detail.kind) {
      case 'absent':
        throw new Error('Continue must remain in the credential scope')
      case 'observed': {
        const [control] = detail.observations
        expect(control?.label).toBe('Continue')
        expect(control?.machineIdentity?.length).toBe(740)
        switch (typeof control) {
          case 'undefined':
            throw new Error('Expected the full captured Continue observation')
          case 'object':
            expect(authentication_advance_control_is_safe(control)).toBe(true)
        }
      }
    }
    const request: Parameters<
      typeof classify_companion_authentication_workflow_facts
    >[0] = { observations: [facts] }
    const classified = classify_companion_authentication_workflow_facts(request)
    const expected: {
      kind: string
      snapshot: { kind: AuthenticationWorkflowKind }
    } = {
      kind: 'matched',
      snapshot: { kind: AuthenticationWorkflowKind.Login },
    }
    expect(classified).toMatchObject(expected)
  })

  test.each(['newsletter', 'search'])(
    'does not promote a %s utility wrapper',
    (purpose) => {
      history.replaceState({}, '', '/')
      document.body.innerHTML = `<div class="reset_base__utility knox-reset"><input type="email" name="${purpose}" aria-label="${purpose}"><button type="button">Continue</button></div>`
      const observations =
        passwordFormInteraction.summarizeAuthenticationWorkflowForms()
      const facts = observations.map((observation) => {
        const request: Parameters<
          typeof passwordFormInteraction.authenticationPageObservationFacts
        >[0] = {
          observation,
          authenticatorSetupHint: 'absent',
          backupCodesCopy: '',
        }
        return passwordFormInteraction.authenticationPageObservationFacts(
          request,
        )
      })
      const request: Parameters<
        typeof classify_companion_authentication_workflow_facts
      >[0] = { observations: facts }
      const expected: { kind: string } = { kind: 'matched' }
      expect(
        classify_companion_authentication_workflow_facts(request),
      ).not.toMatchObject(expected)
    },
  )
})
