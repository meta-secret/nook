import { afterEach, describe, expect, test } from 'vitest'
import { authenticationFactAttributeFilter } from '../../../../nook-web-shared/src/extension/authentication-fact-attributes'
import { MAX_AUTHENTICATION_CONTROL_TEXT_BYTES } from '../../../../nook-web-shared/src/extension/password-form-submission-controls'
import {
  authenticationPageObservationFacts,
  fillLoginCredentials,
  fillOneTimeCode,
  findOneTimeCodeFields,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
  summarizePasswordForms,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentOneTimeCodeFieldQuery: Parameters<
  typeof findOneTimeCodeFields
>[0] = {}
const wholeDocumentPasswordFormSubmission: Parameters<
  typeof submitLoginForm
>[0] = { kind: PasswordFormQueryKind.Root, root: document }

function observedAuthenticationWorkflow(): PasswordFormObservation {
  const observation = summarizeAuthenticationWorkflowForms()[0]
  if (!observation) throw new Error('expected an authentication workflow')
  return observation
}

afterEach(() => {
  document.body.replaceChildren()
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

    const observation = observedAuthenticationWorkflow()
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.oneTimeCodeHandlerSignals).toEqual([
      'oninput=this.form.requestSubmit()',
    ])
  })

  test('transports OTP handlers as independent Rust policy candidates', () => {
    document.body.innerHTML = `
      <form id="otp-login" action="/mfa/challenge">
        <input autocomplete="one-time-code" onchange="validateCode()" />
        <input autocomplete="one-time-code" oninput="this.form.requestSubmit()" />
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.oneTimeCodeHandlerSignals).toEqual([
      'onchange=validateCode()',
      'oninput=this.form.requestSubmit()',
    ])
  })

  test('transports every scoped advance-control candidate for Rust selection', () => {
    document.body.innerHTML = `
      <form id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Delete account</button>
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
      observations: [
        { label: expect.stringContaining('Delete account') },
        { label: expect.stringContaining('Sign in') },
      ],
    })
  })

  test('resolves aria-labelledby control names for Rust classification', () => {
    document.body.innerHTML = `
      <form action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <span id="submit-name">Sign in</span>
        <button type="submit" aria-labelledby="submit-name"></button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ label: expect.stringContaining('Sign in') }],
    })
  })

  test('transports implicit owned-form submission evidence without a control', () => {
    document.body.innerHTML = `
      <form aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toEqual({ kind: 'absent' })
    expect(facts.ceremony.advanceControl).toBe('implicit-submission')
  })

  test('does not infer implicit submission when an inert submitter exists', () => {
    document.body.innerHTML = `<form action="/auth/login"><input autocomplete="username" /><button type="submit" disabled>Sign in</button></form>`
    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.advanceControl).toBe('absent')
  })

  test('uses image submit alt text as bounded control identity', () => {
    document.body.innerHTML = `<form id="login" action="/auth/login"><input autocomplete="username" /><input type="image" alt="Sign in" /></form>`
    document
      .querySelector('form')
      ?.addEventListener('submit', (event) => event.preventDefault())
    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ label: expect.stringContaining('Sign in') }],
    })
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
  })

  test('resolves default and relative form destinations before Rust classification', () => {
    window.history.replaceState({}, '', '/account/sign-in')
    document.body.innerHTML = `
      <form aria-label="Login" action="../session">
        <input autocomplete="username" />
        <button type="submit">Continue</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.authenticationContext).toMatchObject({
      formIdentity: expect.stringContaining('Login'),
      destinationIdentity: `${location.origin}/session`,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ destinationIdentity: `${location.origin}/session` }],
    })

    document.querySelector('form')?.removeAttribute('action')
    const defaultDestination = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const defaultAuthenticationContext =
      defaultDestination.ceremony.authenticationContext
    if (!defaultAuthenticationContext) {
      throw new Error('expected default authentication context')
    }
    expect(defaultAuthenticationContext.destinationIdentity).toBe(location.href)
  })

  test('bounds oversized control labels so one long submitter cannot reject the page', () => {
    const oversizedLabel = `Sign in ${'x'.repeat(600)}`
    document.body.innerHTML = `
      <form aria-label="Login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">${oversizedLabel}</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const observation = facts.detailedAdvanceControl
    if (observation.kind !== 'observed') {
      throw new Error('expected observed advance control')
    }
    const label = observation.observations[0]?.label
    if (!label) {
      throw new Error('expected a bounded control label')
    }
    expect(label.startsWith('Sign in')).toBe(true)
    expect(new TextEncoder().encode(label).length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
    )
  })

  test('bounds omitted-action OAuth destinations to the authentication path', () => {
    const query = `state=${'a'.repeat(600)}`
    window.history.replaceState({}, '', `/oauth/authorize?${query}`)
    document.body.innerHTML = `
      <form aria-label="Login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Continue</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const authenticationContext = facts.ceremony.authenticationContext
    if (!authenticationContext) {
      throw new Error('expected authentication context')
    }
    const destination = authenticationContext.destinationIdentity
    expect(destination).toBe(`${location.origin}/oauth/authorize`)
    expect(new TextEncoder().encode(destination).length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
    )
  })

  test('watches remaining fact-bearing identities used by observation facts', () => {
    expect(authenticationFactAttributeFilter).toEqual(
      expect.arrayContaining(['alt', 'role', 'title', 'value']),
    )
    document.body.innerHTML = `
      <form aria-label="Login" action="/login" role="form">
        <input autocomplete="username" />
        <input type="submit" value="Delete" title="Remove account" />
      </form>
    `
    const before = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(before.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        {
          label: expect.stringContaining('Delete'),
          formIdentity: expect.stringContaining('form'),
        },
      ],
    })

    const submitter = document.querySelector('input[type="submit"]')
    submitter?.setAttribute('value', 'Sign in')
    submitter?.setAttribute('title', 'Sign in')
    document.querySelector('form')?.setAttribute('role', 'search')

    const after = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(after.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        {
          label: expect.stringContaining('Sign in'),
          formIdentity: expect.stringContaining('search'),
        },
      ],
    })
  })

  test('submits a classified username-only login whose form action is omitted', () => {
    window.history.replaceState({}, '', '/auth/login')
    document.body.innerHTML = `
      <form aria-label="Login">
        <input autocomplete="username" />
        <button type="submit">Continue</button>
      </form>
    `
    let submissions = 0
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
      submissions += 1
    })

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ destinationIdentity: location.href }],
    })
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(submissions).toBe(1)
  })

  test('uses the OTP form destination instead of an auxiliary control destination', () => {
    document.body.innerHTML = `
      <form id="otp-login" action="/mfa/challenge">
        <input autocomplete="one-time-code" oninput="this.form.requestSubmit()" />
        <button type="button" formaction="/cancel">Cancel</button>
        <button type="submit">Verify code</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const authenticationContext = facts.ceremony.authenticationContext
    if (!authenticationContext) {
      throw new Error('expected OTP authentication context')
    }
    expect(authenticationContext.destinationIdentity).toBe(
      `${location.origin}/mfa/challenge`,
    )
  })

  test('transports externally associated submit controls with owned-form scope', () => {
    document.body.innerHTML = `
      <form id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
      <button form="login" type="submit">Sign in</button>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        {
          ownership: 'owned-form',
          semanticSubmitControlCount: 1,
          destinationIdentity: `${location.origin}/login`,
        },
      ],
    })
  })

  test('transports a passkey-only form-associated control for Rust selection', () => {
    document.body.innerHTML = `
      <form id="passkey-login" action="/login">
        <button type="button">Sign in with a passkey</button>
      </form>
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
            label: expect.stringContaining('passkey'),
          },
        },
      ],
    })
  })

  test('keeps standalone explicitly marked passkey controls locally scoped', () => {
    document.body.innerHTML = `
      <button type="button" data-nook-passkey-control>Continue</button>
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
          kind: 'explicitly-marked',
          observation: {
            ownership: 'locally-scoped',
            label: expect.stringContaining('Continue'),
          },
        },
      ],
    })
  })

  test('does not transport a passkey control contained by a sibling form', () => {
    document.body.innerHTML = `
      <div class="login-panel">
        <form id="password-login" action="/login">
          <input autocomplete="username" />
          <input type="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
        <form id="passkey-login" action="/webauthn">
          <a href="/webauthn">Use passkey</a>
        </form>
      </div>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toEqual({
      kind: 'absent',
    })
  })

  test('transports a locally adjacent form-less passkey alternative with a credential form', () => {
    document.body.innerHTML = `
      <div class="login-panel">
        <form id="login" action="/login">
          <input autocomplete="username" />
          <input type="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
        <button type="button">Sign in with a passkey</button>
      </div>
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
            ownership: 'locally-scoped',
            label: expect.stringContaining('passkey'),
          },
        },
      ],
    })
  })

  test('counts only actionable semantic submitters for Rust ambiguity', () => {
    document.body.innerHTML = `
      <form aria-label="Login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Proceed</button>
        <button type="submit" disabled>Cancel</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining('Proceed'),
          semanticSubmitControlCount: 1,
        }),
      ]),
    })
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
        { observation: { actionability: 'inert' } },
        { observation: { actionability: 'actionable' } },
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

  test('returns no workflow for ordinary pages and email-only newsletters', () => {
    document.body.innerHTML = `
      <main><p>Documentation</p></main>
      <form><input type="email" name="newsletter-email" /><button>Submit</button></form>
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
})
