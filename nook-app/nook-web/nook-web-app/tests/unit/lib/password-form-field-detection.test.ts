import { afterEach, describe, expect, test } from 'vitest'
import {
  authenticationPageObservationFacts,
  fillLoginCredentials,
  findOneTimeCodeFields,
  findPasswordFields,
  findUsernameFields,
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
  test('uses an authentication control after a generic help button', () => {
    document.body.innerHTML = `
      <form method="post" action="/next">
        <input type="email" name="primary" />
        <input type="password" autocomplete="current-password" />
        <button type="button">Help</button>
        <button type="submit">Sign in</button>
      </form>
    `
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
  })

  test('uses an externally associated authentication control', () => {
    document.body.innerHTML = `
      <form id="login" method="post" action="/next">
        <input type="email" name="primary" />
        <input type="password" autocomplete="current-password" />
      </form>
      <button type="submit" form="login">Sign in</button>
    `
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
  })

  test('preserves the conventional user id for Rust username classification', () => {
    document.body.innerHTML = `
      <form method="post" action="/auth/login">
        <input id="user" type="text" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
  })

  test('returns externally associated fields in document order', () => {
    document.body.innerHTML = `
      <input id="before-user" form="login" autocomplete="username" />
      <input id="before-password" form="login" type="password" />
      <input id="before-otp" form="login" autocomplete="one-time-code" />
      <form id="login" method="post" action="/auth/login">
        <input id="inside-user" autocomplete="username" />
        <input id="inside-password" type="password" />
        <input id="inside-otp" autocomplete="one-time-code" />
      </form>
      <input id="after-user" form="login" autocomplete="username" />
      <input id="after-password" form="login" type="password" />
      <input id="after-otp" form="login" autocomplete="one-time-code" />
    `
    const owner = document.querySelector<HTMLFormElement>('#login')
    if (!owner) throw new Error('expected the owned authentication form')
    const query: Parameters<typeof findUsernameFields>[0] = {
      root: document,
      formScope: { kind: PasswordFormScopeKind.Owned, owner },
    }
    expect(findUsernameFields(query).map((field) => field.id)).toEqual([
      'before-user',
      'inside-user',
      'after-user',
    ])
    expect(findPasswordFields(query).map((field) => field.id)).toEqual([
      'before-password',
      'inside-password',
      'after-password',
    ])
    expect(findOneTimeCodeFields(query).map((field) => field.id)).toEqual([
      'before-otp',
      'inside-otp',
      'after-otp',
    ])
  })

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
      <form method="post" id="passkey-login" action="/login">
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
      <form method="post" aria-label="Login" action="/auth/login">
        <div inert>
          <input id="dormant-user" autocomplete="username" />
          <input id="dormant-pass" type="password" autocomplete="current-password" />
        </div>
        <button type="submit">Sign in</button>
      </form>
    `

    const observation = summarizeAuthenticationWorkflowForms()[0]
    if (observation) {
      const facts = authenticationPageObservationFacts({
        observation,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      })
      expect(facts.fields.usernameFieldCount).toBe(0)
      expect(facts.fields.currentPasswordFieldCount).toBe(0)
    }
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
      <form method="post" aria-label="Login" action="/auth/login">
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
      <form method="post" id="login" action="/login">
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
      <form method="post">
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
      <form method="post">
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
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const detailed = facts.detailedAdvanceControl
    expect(detailed ? detailed.kind : 'absent').toBe('observed')
  })

  test('scopes form-less credentials with a sibling input type-button value', () => {
    document.body.innerHTML = `
      <section>
        <div><input autocomplete="username" /></div>
        <div><input type="password" autocomplete="current-password" /></div>
        <input type="button" value="Sign in" />
      </section>
    `
    const observation = observedAuthenticationWorkflow()
    expect(observation.summary.usernameFieldCount).toBe(1)
    expect(observation.summary.passwordFieldCount).toBe(1)
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const detailed = facts.detailedAdvanceControl
    expect(detailed ? detailed.kind : 'absent').toBe('observed')
  })

  test('does not swallow an unrelated sibling password into a username Sign in scope', () => {
    document.body.innerHTML = `
      <section>
        <div>
          <input autocomplete="username" />
          <button type="button">Sign in</button>
        </div>
        <input id="unrelated-pass" type="password" autocomplete="current-password" />
      </section>
    `
    const observations = summarizeAuthenticationWorkflowForms()
    expect(
      observations.some(
        (observation) =>
          observation.summary.usernameFieldCount === 1 &&
          observation.summary.passwordFieldCount === 0,
      ),
    ).toBe(true)
    expect(
      observations.some(
        (observation) => observation.summary.passwordFieldCount > 0,
      ),
    ).toBe(false)
    const usernameOnly = observations.find(
      (observation) =>
        observation.summary.usernameFieldCount === 1 &&
        observation.summary.passwordFieldCount === 0,
    )
    if (!usernameOnly) {
      throw new Error('expected a username-only Sign in scope')
    }
    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'vault-user', password: 'vault-pass' },
      kind: PasswordFormQueryKind.Scoped,
      root: usernameOnly.root,
      formScope: usernameOnly.formScope,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(true)
    expect(
      (document.querySelector('#unrelated-pass') as HTMLInputElement).value,
    ).toBe('')
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

  test('rescans a closed dialog after it opens', () => {
    document.body.innerHTML = `
      <dialog>
        <section>
          <div><input autocomplete="username" /></div>
          <div><input type="password" autocomplete="current-password" /></div>
          <button type="button">Sign in</button>
        </section>
      </dialog>
    `
    expect(summarizeAuthenticationWorkflowForms()).toEqual([])
    document.querySelector('dialog')?.setAttribute('open', '')
    const observation = observedAuthenticationWorkflow()
    expect(observation.summary.usernameFieldCount).toBe(1)
    expect(observation.summary.passwordFieldCount).toBe(1)
  })
})
