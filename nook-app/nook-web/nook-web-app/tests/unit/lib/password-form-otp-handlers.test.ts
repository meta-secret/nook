import { afterEach, describe, expect, test } from 'vitest'
import {
  type PasswordFormObservation,
  passwordFormInteraction as forms,
} from '../../../../nook-web-shared/src/extension/password-forms'

function observedAuthenticationWorkflow(): PasswordFormObservation {
  const observation = forms.summarizeAuthenticationWorkflowForms()[0]
  if (!observation) throw new Error('expected an authentication workflow')
  return observation
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('OTP handler observation transport', () => {
  test('preserves executable OTP handler attribute names at the Rust boundary', () => {
    document.body.innerHTML = `
      <form method="post" id="otp-login" action="/mfa/challenge">
        <input
          autocomplete="one-time-code"
          oninput="this.form.requestSubmit()"
        />
        <button type="submit">Verify code</button>
      </form>
    `

    const observation = observedAuthenticationWorkflow()
    const facts = forms.authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesCopy: '',
    })
    expect(facts.ceremony.oneTimeCodeHandlerSignals).toEqual([
      'oninput=this.form.requestSubmit()',
    ])
  })
  test('transports OTP handlers as independent Rust policy candidates', () => {
    document.body.innerHTML = `
      <form method="post" id="otp-login" action="/mfa/challenge">
        <input autocomplete="one-time-code" onchange="validateCode()" />
        <input autocomplete="one-time-code" oninput="this.form.requestSubmit()" />
      </form>
    `

    const facts = forms.authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesCopy: '',
    })
    expect(facts.ceremony.oneTimeCodeHandlerSignals).toEqual([
      'oninput=this.form.requestSubmit()',
      'onchange=validateCode()',
    ])
  })
})
