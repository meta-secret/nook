import { afterEach, describe, expect, test } from 'vitest'
import {
  authenticationPageObservationFacts,
  findOneTimeCodeFields,
  PasswordFormQueryKind,
  summarizeAuthenticationWorkflowForms,
  summarizePasswordForms,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentOneTimeCodeFieldQuery: Parameters<
  typeof findOneTimeCodeFields
>[0] = {}

function observedAuthenticationWorkflow(): PasswordFormObservation {
  const observation = summarizeAuthenticationWorkflowForms()[0]
  if (!observation) throw new Error('expected an authentication workflow')
  return observation
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('authentication field detection', () => {
  test('transports an external form-associated passkey control with owned-form scope', () => {
    document.body.innerHTML = `
      <form id="login" action="/login">
        <input autocomplete="username" />
      </form>
      <button type="button" form="login">Sign in with a passkey</button>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      kind: 'candidates',
      observation: [
        {
          kind: 'labeled',
          observation: {
            ownership: 'owned-form',
            label: expect.stringContaining('passkey'),
          },
        },
      ],
    })
  })

  test('transports every passkey candidate for Rust selection', () => {
    document.body.innerHTML = `
      <button type="button" disabled>Use passkey</button>
      <button type="button">Sign in with a passkey</button>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      kind: 'candidates',
      observation: [
        { observation: { actionability: 'actionable' } },
        { observation: { actionability: 'inert' } },
      ],
    })
  })

  test('detects standard and common OTP fields without treating card security codes as 2FA', () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="one-time-code" inputmode="numeric" />
        <input name="totp-token" type="tel" />
        <input name="otp-backup" style="display: none" />
        <div hidden><input id="mfa-preloaded" /></div>
        <input name="card-security-code" />
      </form>
    `

    expect(
      findOneTimeCodeFields(wholeDocumentOneTimeCodeFieldQuery),
    ).toHaveLength(2)
    expect(summarizePasswordForms()).toMatchObject({
      passwordFieldCount: 0,
      oneTimeCodeFieldCount: 2,
      formCount: 1,
    })
  })

  test('detects Namecheap-like OTP fields from placeholder and camelCase attributes', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <h1>Enter OTP Code</h1>
        <p>Open the two-factor authentication app on your device.</p>
        <input
          id="Code"
          name="Code"
          type="text"
          placeholder="Enter OTP Code"
        />
        <button type="submit">Submit</button>
      </div>
      <form>
        <label for="verify">Verification code</label>
        <input id="verify" name="VerificationCode" type="tel" />
      </form>
      <input name="hotpot-special" type="text" placeholder="Favorite dish" />
    `

    const fields = findOneTimeCodeFields(wholeDocumentOneTimeCodeFieldQuery)
    expect(fields.map((field) => field.name)).toEqual([
      'Code',
      'VerificationCode',
    ])
    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      oneTimeCodeFieldCount: 1,
    })
  })
})
