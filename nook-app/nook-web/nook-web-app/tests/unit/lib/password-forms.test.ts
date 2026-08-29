import { afterEach, describe, expect, test } from 'vitest'
import {
  classify_companion_authentication_workflow_facts,
  CompanionAuthenticationWorkflowMatchKind,
  companion_authentication_workflow_match_kind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authenticationPageObservationFacts,
  fillLoginCredentials,
  fillOneTimeCode,
  findOneTimeCodeFields,
  findWorkflowPasskeyControl,
  PasskeyControlLookupKind,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
  summarizePasswordForms,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentOneTimeCodeFieldQuery: Parameters<
  typeof findOneTimeCodeFields
>[0] = {}
function observedAuthenticationWorkflow(): Parameters<
  typeof submitLoginForm
>[0] {
  const observation = summarizeAuthenticationWorkflowForms()[0]
  if (!observation) throw new Error('expected an authentication workflow')
  return observation
}

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
})

describe('website one-time-code fields', () => {
  test('preserves executable OTP handler attribute names at the Rust boundary', () => {
    document.body.innerHTML = `
      <form id="otp-login" action="/mfa/challenge">
        <input
          autocomplete="one-time-code"
          oninput="this.form.requestSubmit()"
        />
        <button type="submit">Verify code</button>
      </form>
    `

    const observation = summarizeAuthenticationWorkflowForms()[0]
    expect(observation).toBeDefined()
    if (!observation) return
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.oneTimeCodeHandlerSignal).toBe(
      'oninput=this.form.requestSubmit()',
    )
  })

  test('authenticates OTP auto-submit against the form action', () => {
    document.body.innerHTML = `
      <form id="transaction" action="/transfer">
        <input
          autocomplete="one-time-code"
          oninput="this.form.requestSubmit()"
        />
        <button type="submit" formaction="/auth/verify">Verify code</button>
      </form>
    `

    const observation = observedAuthenticationWorkflow()
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.authenticationContext.destinationIdentity).toBe(
      'http://localhost:3000/transfer',
    )
    const workflowMatch = classify_companion_authentication_workflow_facts({
      observations: [facts],
    })
    expect(companion_authentication_workflow_match_kind(workflowMatch)).toBe(
      CompanionAuthenticationWorkflowMatchKind.NoMatch,
    )
  })

  test('transports every scoped advance-control candidate in Rust-ranked order', () => {
    document.body.innerHTML = `
      <form id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Delete account</button>
        <button type="submit">Sign in</button>
      </form>
    `

    const observation = summarizeAuthenticationWorkflowForms()[0]
    expect(observation).toBeDefined()
    if (!observation) return
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        { label: expect.stringContaining('Sign in') },
        { label: expect.stringContaining('Delete account') },
      ],
    })
  })

  test('prioritizes a Rust-approved control inside an oversized batch', () => {
    const decoys = Array.from(
      { length: 101 },
      (_, index) => `<button type="submit">Delete account ${index}</button>`,
    ).join('')
    document.body.innerHTML = `
      <form id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        ${decoys}
        <button type="submit">Sign in</button>
      </form>
    `

    const observation = observedAuthenticationWorkflow()
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: expect.any(Array),
    })
    if (facts.detailedAdvanceControl.kind !== 'observed') return
    expect(facts.detailedAdvanceControl.observations).toHaveLength(100)
    expect(facts.detailedAdvanceControl.observations[0]?.label).toContain(
      'Sign in',
    )
    expect(
      facts.detailedAdvanceControl.observations[0]?.semanticSubmitControlCount,
    ).toBe(100)
    const workflowMatch = classify_companion_authentication_workflow_facts({
      observations: [facts],
    })
    expect(companion_authentication_workflow_match_kind(workflowMatch)).toBe(
      CompanionAuthenticationWorkflowMatchKind.Matched,
    )
  })

  test('resolves omitted form actions to the current login route', () => {
    window.history.replaceState({}, '', '/login')
    document.body.innerHTML = `
      <form>
        <input type="password" autocomplete="current-password" />
        <button type="submit">Continuar</button>
      </form>
    `

    const observation = summarizeAuthenticationWorkflowForms()[0]
    expect(observation).toBeDefined()
    if (!observation) return
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ destinationIdentity: 'http://localhost:3000/login' }],
    })
  })

  test('keeps passkey actuation inside the classified workflow scope', () => {
    document.body.innerHTML = `
      <section id="settings">
        <button data-nook-passkey-control>Delete passkey</button>
      </section>
      <form id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button data-nook-passkey-control>Use passkey</button>
      </form>
    `

    const workflow = summarizeAuthenticationWorkflowForms().find(
      ({ formScope }) =>
        formScope.kind === PasswordFormScopeKind.Owned &&
        formScope.owner.id === 'login',
    )
    expect(workflow).toBeDefined()
    if (!workflow) return
    const scoped = findWorkflowPasskeyControl(workflow)
    expect(scoped.kind).toBe(PasskeyControlLookupKind.Found)
    if (scoped.kind === PasskeyControlLookupKind.Found) {
      expect(scoped.control.textContent).toContain('Use passkey')
    }
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

  test('returns no workflow for ordinary pages and email-only newsletters', () => {
    document.body.innerHTML = `
      <main><p>Documentation</p></main>
      <form><input type="email" name="newsletter-email" /></form>
    `

    expect(summarizeAuthenticationWorkflowForms()).toEqual([])
  })

  test('detects Microsoft-like email-first login without autocomplete=username', () => {
    document.body.innerHTML = `
      <form id="loginForm">
        <input
          type="email"
          name="loginfmt"
          id="i0116"
          placeholder="Email, phone, or Skype"
          aria-label="Enter your email, phone, or Skype."
        />
        <button type="submit" id="idSIButton9">Next</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      passwordFieldCount: 0,
    })
    const loginFillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'user@contoso.com', password: '' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(loginFillArgs)).toBe(true)
    expect(
      document.querySelector<HTMLInputElement>('[name="loginfmt"]')?.value,
    ).toBe('user@contoso.com')
  })

  test('detects Slack-like login_email fields from data-qa identity', () => {
    document.body.innerHTML = `
      <div class="p-login_container">
        <input
          id="email"
          type="email"
          data-qa="login_email"
          placeholder="name@work-email.com"
        />
        <button type="button" data-qa="signin_button">Sign In</button>
      </div>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      passwordFieldCount: 0,
    })
  })

  test('detects Facebook-like email/pass login under an aria-hidden ancestor', () => {
    document.body.innerHTML = `
      <div aria-hidden="true">
        <form id="login_form">
          <input
            type="text"
            name="email"
            id="email"
            placeholder="Email or phone number"
          />
          <input
            type="password"
            name="pass"
            id="pass"
            placeholder="Password"
            autocomplete="current-password"
          />
          <button type="submit" name="login" id="loginbutton">Log in</button>
        </form>
      </div>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      passwordFieldCount: 1,
      currentPasswordFieldCount: 1,
    })
    const loginFillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: {
        username: 'pilot@nook.test',
        password: 'extension-fill-password',
      },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(loginFillArgs)).toBe(true)
    expect(document.querySelector<HTMLInputElement>('#email')?.value).toBe(
      'pilot@nook.test',
    )
    expect(document.querySelector<HTMLInputElement>('#pass')?.value).toBe(
      'extension-fill-password',
    )
  })

  test('still ignores a field that itself is aria-hidden', () => {
    document.body.innerHTML = `
      <form>
        <input
          type="text"
          name="email"
          autocomplete="username"
          aria-hidden="true"
        />
        <input
          type="password"
          name="pass"
          autocomplete="current-password"
          aria-hidden="true"
        />
        <button type="submit">Log in</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()).toEqual([])
  })

  test('detects Tier-1 popular-site login shells', () => {
    const shells: Array<{ html: string; username: number; password: number }> =
      [
        {
          html: `
            <form id="gaia_loginform">
              <input type="email" name="identifier" id="identifierId" autocomplete="username" />
              <button type="submit">Next</button>
            </form>
          `,
          username: 1,
          password: 0,
        },
        {
          html: `
            <form class="signin">
              <input type="text" id="account_name_text_field" name="accountName" autocomplete="username" />
              <input type="password" id="password_text_field" name="password" autocomplete="current-password" />
              <button type="submit">Sign In</button>
            </form>
          `,
          username: 1,
          password: 1,
        },
        {
          html: `
            <form name="signIn">
              <input type="email" name="email" id="ap_email" autocomplete="username" />
              <button type="submit" id="continue">Continue</button>
            </form>
          `,
          username: 1,
          password: 0,
        },
        {
          html: `
            <form>
              <input type="text" name="login" id="login_field" autocomplete="username" />
              <input type="password" name="password" id="password" autocomplete="current-password" />
              <button type="submit">Sign in</button>
            </form>
          `,
          username: 1,
          password: 1,
        },
        {
          html: `
            <form class="login__form">
              <input type="text" id="username" name="session_key" autocomplete="username" />
              <input type="password" id="password" name="session_password" autocomplete="current-password" />
              <button type="submit">Sign in</button>
            </form>
          `,
          username: 1,
          password: 1,
        },
        {
          html: `
            <form>
              <input type="text" name="text" autocomplete="username" data-testid="ocfEnterTextTextInput" />
              <button type="submit">Next</button>
            </form>
          `,
          username: 1,
          password: 0,
        },
      ]

    for (const shell of shells) {
      document.body.innerHTML = shell.html
      const observations = summarizeAuthenticationWorkflowForms()
      expect(observations).toHaveLength(1)
      expect(observations[0]?.summary).toMatchObject({
        usernameFieldCount: shell.username,
        passwordFieldCount: shell.password,
      })
      document.body.replaceChildren()
    }
  })

  test('fills username-only then advances common multi-step login controls', () => {
    for (const label of ['Next', 'Login', 'signin', 'Sign   In', 'Log\tin']) {
      document.body.innerHTML = `
        <form id="login-form">
          <input autocomplete="username" name="email" type="email" />
          <button id="next" type="button">${label}</button>
        </form>
      `
      let advanced = false
      document.querySelector('#next')?.addEventListener('click', () => {
        advanced = true
      })

      const loginFillArgs: Parameters<typeof fillLoginCredentials>[0] = {
        credentials: { username: 'pilot@nook.test', password: '' },
        kind: PasswordFormQueryKind.Root,
        root: document,
      }
      expect(fillLoginCredentials(loginFillArgs)).toBe(true)
      expect(submitLoginForm(observedAuthenticationWorkflow())).toBe(true)
      expect(advanced).toBe(true)
      expect(
        document.querySelector<HTMLInputElement>('[name="email"]')?.value,
      ).toBe('pilot@nook.test')
    }
  })

  test('fills username-only then advances an input activation control', () => {
    document.body.innerHTML = `
      <form id="login-form">
        <input autocomplete="username" name="email" type="email" />
        <input id="next" type="button" value="Next" />
      </form>
    `
    let advanced = false
    document.querySelector('#next')?.addEventListener('click', () => {
      advanced = true
    })

    const loginFillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'pilot@nook.test', password: '' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(loginFillArgs)).toBe(true)
    expect(submitLoginForm(observedAuthenticationWorkflow())).toBe(true)
    expect(advanced).toBe(true)
  })

  test('groups externally associated controls with their form owner', () => {
    document.body.innerHTML = `
      <form id="login"><input autocomplete="username" /></form>
      <input form="login" type="password" autocomplete="current-password" />
      <button form="login" type="submit">Sign in</button>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.formScope.kind).toBe('owned')
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      currentPasswordFieldCount: 1,
    })
    const observation = observations[0]
    expect(observation).toBeDefined()
    if (!observation) return
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        {
          ownership: 'owned-form',
          label: expect.stringContaining('Sign in'),
        },
      ],
    })
  })

  test('transports an image input as a semantic submit control', () => {
    document.body.innerHTML = `
      <form id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <input type="image" alt="Sign in" />
      </form>
    `

    const observation = observedAuthenticationWorkflow()
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        {
          semantics: 'semantic-submit',
          label: expect.stringContaining('Sign in'),
        },
      ],
    })
    const workflowMatch = classify_companion_authentication_workflow_facts({
      observations: [facts],
    })
    expect(companion_authentication_workflow_match_kind(workflowMatch)).toBe(
      CompanionAuthenticationWorkflowMatchKind.Matched,
    )
  })

  test('ignores closed-dropdown password fields inside the same page form', () => {
    document.body.innerHTML = `
      <form id="aspnetForm">
        <div class="gb-dropdown">
          <div class="gb-dropdown__holder" style="display: none">
            <input name="LoginUserName" type="text" />
            <input id="header-password" name="LoginPassword" type="password" />
          </div>
        </div>
        <fieldset class="loginForm">
          <input name="LoginUserName" type="text" />
          <input
            id="main-password"
            name="LoginPassword"
            type="password"
            autocomplete="on"
          />
          <button type="submit">Sign in</button>
        </fieldset>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      passwordFieldCount: 1,
      genericPasswordFieldCount: 1,
      currentPasswordFieldCount: 0,
    })
    const loginFillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'pilot', password: 'secret' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(loginFillArgs)).toBe(true)
    expect(
      document.querySelector<HTMLInputElement>('#header-password')?.value,
    ).toBe('')
    expect(
      document.querySelector<HTMLInputElement>('#main-password')?.value,
    ).toBe('secret')
  })

  test('does not surface a closed header-only login as a pilot workflow', () => {
    document.body.innerHTML = `
      <form id="aspnetForm">
        <div class="gb-dropdown__holder" style="display: none">
          <input name="LoginUserName" type="text" />
          <input name="LoginPassword" type="password" />
        </div>
        <main><p>Marketing homepage</p></main>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()).toEqual([])
  })

  test('keeps unowned login controls isolated from owned signup fields', () => {
    document.body.innerHTML = `
      <form id="signup">
        <input autocomplete="username" />
        <input type="password" autocomplete="new-password" />
      </form>
      <section>
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </section>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(2)
    expect(observations.map(({ summary }) => summary)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPasswordFieldCount: 0,
          newPasswordFieldCount: 1,
        }),
        expect.objectContaining({
          currentPasswordFieldCount: 1,
          newPasswordFieldCount: 0,
        }),
      ]),
    )
  })

  test('keeps separate unowned auth containers isolated', () => {
    document.body.innerHTML = `
      <div class="signup-panel">
        <input autocomplete="username" />
        <input type="password" autocomplete="new-password" />
        <button type="submit">Create account</button>
      </div>
      <div class="login-panel">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </div>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(2)
    expect(observations.map(({ summary }) => summary)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPasswordFieldCount: 0,
          newPasswordFieldCount: 1,
        }),
        expect.objectContaining({
          currentPasswordFieldCount: 1,
          newPasswordFieldCount: 0,
        }),
      ]),
    )
  })

  test('prioritizes active OTP and login forms before low-confidence candidates', () => {
    document.body.innerHTML = Array.from(
      { length: 20 },
      (_, index) => `
        <form id="signup-${index}">
          <input autocomplete="username" />
          <input type="password" autocomplete="new-password" />
        </form>`,
    ).join('')
    document.body.insertAdjacentHTML(
      'beforeend',
      `<form id="login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>`,
    )

    const observations = summarizeAuthenticationWorkflowForms()
    const firstScope = observations[0]?.formScope
    expect(firstScope?.kind).toBe('owned')
    expect(firstScope?.kind === 'owned' ? firstScope.owner.id : '').toBe(
      'login',
    )
  })

  test('fills a visible username instead of a hidden autocomplete token', () => {
    document.body.innerHTML = `
      <form>
        <input type="hidden" autocomplete="username" value="token" />
        <input id="visible-email" type="email" />
        <input id="password" type="password" autocomplete="current-password" />
      </form>
    `

    const loginFillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'pilot', password: 'secret' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(loginFillArgs)).toBe(true)
    expect(
      document.querySelector<HTMLInputElement>('[type="hidden"]')?.value,
    ).toBe('token')
    expect(
      document.querySelector<HTMLInputElement>('#visible-email')?.value,
    ).toBe('pilot')
  })

  test('does not claim a div-based login was submitted', () => {
    document.body.innerHTML = `
      <section>
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="button">Sign in</button>
      </section>
    `

    expect(submitLoginForm(observedAuthenticationWorkflow())).toBe(false)
  })

  test('does not claim a disabled submit control was activated', () => {
    document.body.innerHTML = `
      <form>
        <input type="password" autocomplete="current-password" />
        <button type="submit" disabled>Sign in</button>
      </form>
    `

    expect(submitLoginForm(observedAuthenticationWorkflow())).toBe(false)
  })

  test('activates the Rust-approved submit instead of an earlier destructive control', () => {
    document.body.innerHTML = `
      <form id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button id="delete" type="submit" formaction="/settings/delete-account">Delete account</button>
        <button id="sign-in" type="submit">Sign in</button>
      </form>
    `
    let deleted = false
    let signedIn = false
    document.querySelector('#delete')?.addEventListener('click', () => {
      deleted = true
    })
    document.querySelector('#sign-in')?.addEventListener('click', () => {
      signedIn = true
    })
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
    })

    expect(submitLoginForm(observedAuthenticationWorkflow())).toBe(true)
    expect(deleted).toBe(false)
    expect(signedIn).toBe(true)
  })

  test('does not transport or activate a hidden authentication control', () => {
    document.body.innerHTML = `
      <form id="confirmation">
        <input type="password" autocomplete="current-password" />
        <div hidden><button type="submit">Sign in</button></div>
      </form>
    `
    const observation = observedAuthenticationWorkflow()
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })

    expect(facts.detailedAdvanceControl).toEqual({ kind: 'absent' })
    expect(submitLoginForm(observation)).toBe(false)
  })

  test('reports submission only when the form emits a submit event', () => {
    document.body.innerHTML = `
      <form>
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
    })

    expect(submitLoginForm(observedAuthenticationWorkflow())).toBe(true)
  })

  test('fills the first enabled OTP field through the native value setter', () => {
    document.body.innerHTML = `
      <input autocomplete="one-time-code" disabled />
      <input id="otp-code" type="tel" />
    `
    const field = document.querySelector<HTMLInputElement>('#otp-code')
    let inputEvents = 0
    field?.addEventListener('input', () => inputEvents++)

    const oneTimeCodeFillArgs: Parameters<typeof fillOneTimeCode>[0] = {
      code: '123456',
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillOneTimeCode(oneTimeCodeFillArgs)).toBe(true)
    expect(field?.value).toBe('123456')
    expect(inputEvents).toBe(1)
    expect(document.activeElement).toBe(field)
  })
})
