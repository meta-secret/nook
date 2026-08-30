import { afterEach, describe, expect, test } from 'vitest'
import {
  authenticationPageObservationFacts,
  fillLoginCredentials,
  findOneTimeCodeFields,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
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
  test('keeps form-less fields together with a sibling Sign in button', () => {
    document.body.innerHTML = `
      <div class="panel">
        <div><input autocomplete="username" /></div>
        <div><input type="password" autocomplete="current-password" /></div>
        <button type="button">Sign in</button>
      </div>
    `
    const observation = summarizeAuthenticationWorkflowForms()[0]
    if (!observation) {
      throw new Error('expected a form-less login workflow')
    }
    expect(observation.summary.usernameFieldCount).toBe(1)
    expect(observation.summary.passwordFieldCount).toBe(1)
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
    })
  })

  test('keeps a passkey-only form when the only password field is a hidden decoy', () => {
    document.body.innerHTML = `
      <form id="passkey-login" action="/login">
        <input type="password" hidden autocomplete="current-password" />
        <button type="button">Sign in with a passkey</button>
      </form>
    `

    expect(
      summarizeAuthenticationWorkflowForms().some(
        (observation) =>
          observation.formScope.kind === PasswordFormScopeKind.Owned &&
          observation.formScope.owner.id === 'passkey-login',
      ),
    ).toBe(true)
  })

  test('does not count or fill credential fields inside an inert ancestor', () => {
    document.body.innerHTML = `
      <form aria-label="Login" action="/auth/login">
        <div inert>
          <input id="dormant-user" autocomplete="username" />
          <input id="dormant-pass" type="password" autocomplete="current-password" />
        </div>
        <button type="submit">Sign in</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const observation = observations[0]
    if (!observation) {
      throw new Error('expected a workflow for the live submitter')
    }
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.fields.usernameFieldCount).toBe(0)
    expect(facts.fields.currentPasswordFieldCount).toBe(0)
    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: {
        username: 'vault-user',
        password: 'vault-pass',
      },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(false)
    expect(
      (document.querySelector('#dormant-user') as HTMLInputElement).value,
    ).toBe('')
    expect(
      (document.querySelector('#dormant-pass') as HTMLInputElement).value,
    ).toBe('')
  })

  test('fills live credentials and leaves inert sibling fields untouched', () => {
    document.body.innerHTML = `
      <form aria-label="Login" action="/auth/login">
        <div inert>
          <input id="dormant-user" autocomplete="username" />
          <input id="dormant-pass" type="password" autocomplete="current-password" />
        </div>
        <input id="live-user" autocomplete="username" />
        <input id="live-pass" type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: {
        username: 'vault-user',
        password: 'vault-pass',
      },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(true)
    expect(
      (document.querySelector('#live-user') as HTMLInputElement).value,
    ).toBe('vault-user')
    expect(
      (document.querySelector('#live-pass') as HTMLInputElement).value,
    ).toBe('vault-pass')
    expect(
      (document.querySelector('#dormant-user') as HTMLInputElement).value,
    ).toBe('')
    expect(
      (document.querySelector('#dormant-pass') as HTMLInputElement).value,
    ).toBe('')
  })

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

  test('scopes form-less credentials with a sibling type-button advance control', () => {
    document.body.innerHTML = `
      <section>
        <div><input autocomplete="username" /></div>
        <div><input type="password" autocomplete="current-password" /></div>
        <button type="button">Sign in</button>
      </section>
    `
    const observation = observedAuthenticationWorkflow()
    expect(observation.summary.usernameFieldCount).toBe(1)
    expect(observation.summary.passwordFieldCount).toBe(1)
    expect(
      authenticationPageObservationFacts({
        observation,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }).detailedAdvanceControl.kind,
    ).toBe('observed')
  })

  test('does not treat a generic type-button as a form-less auth container', () => {
    document.body.innerHTML = `
      <section>
        <div><input autocomplete="username" /></div>
        <div><input type="password" autocomplete="current-password" /></div>
        <button type="button">Close</button>
      </section>
    `
    expect(
      summarizeAuthenticationWorkflowForms().some(
        (observation) =>
          observation.summary.usernameFieldCount === 1 &&
          observation.summary.passwordFieldCount === 1,
      ),
    ).toBe(false)
  })
})
