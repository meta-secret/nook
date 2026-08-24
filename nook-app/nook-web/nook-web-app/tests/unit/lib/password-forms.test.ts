import { afterEach, describe, expect, test } from 'vitest'
import {
  authenticationWorkflowFormsHaveActionableControl,
  fillLoginCredentials,
  findOneTimeCodeFields,
  PasswordFormQueryKind,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
  summarizePasswordForms,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentOneTimeCodeFieldQuery: Parameters<
  typeof findOneTimeCodeFields
>[0] = {}
const wholeDocumentPasswordFormSubmission: Parameters<
  typeof submitLoginForm
>[0] = { kind: PasswordFormQueryKind.Root, root: document }

afterEach(() => {
  document.body.replaceChildren()
})

describe('website one-time-code fields', () => {
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

  test('keeps unrelated page controls outside an inert account form', () => {
    document.body.innerHTML = `
      <form id="profile-form">
        <input type="email" name="email" autocomplete="email" />
      </form>
      <button type="button">Continue</button>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: false,
    })
  })

  test('does not treat an ordinary account email submit as login', () => {
    document.body.innerHTML = `
      <form id="account-settings">
        <input type="email" autocomplete="email" />
        <button type="submit">Apply</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: false,
    })
  })

  test('rejects profile submits, unrelated unowned controls, and effectively disabled controls', () => {
    document.body.innerHTML = `
      <form id="profile-form">
        <input type="email" name="email" autocomplete="email" />
        <button type="submit">Save</button>
      </form>
      <section>
        <input type="email" name="unowned-email" autocomplete="email" />
      </section>
      <button type="button">Next</button>
      <form id="disabled-login">
        <input type="password" autocomplete="current-password" />
        <fieldset disabled>
          <button type="submit">Sign in</button>
        </fieldset>
      </form>
      <form id="aria-disabled-login">
        <input type="password" autocomplete="current-password" />
        <div aria-disabled="true">
          <button type="submit">Sign in</button>
        </div>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(3)
    expect(
      observations.map(
        ({ summary }) => summary.authenticationAdvanceControlPresent,
      ),
    ).toEqual([false, false, false])
    const actionabilityQuery: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }
    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityQuery),
    ).toBe(false)
  })

  test('rejects credential fields inside inert subtrees', () => {
    document.body.innerHTML = `
      <form>
        <div inert><input type="email" autocomplete="username" /></div>
        <button type="submit">Sign in</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
  })

  test('rejects credential forms inside fully transparent subtrees', () => {
    document.body.innerHTML = `
      <section style="opacity: 0">
        <form>
          <input type="email" autocomplete="username" />
          <button type="submit">Sign in</button>
        </form>
      </section>
    `

    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
  })

  test('accepts a localized semantic submit for a password ceremony', () => {
    document.body.innerHTML = `
      <form id="signup-form">
        <input type="email" autocomplete="username" />
        <input type="password" autocomplete="new-password" />
        <button type="submit">Crear cuenta</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      newPasswordFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('accepts update password for a new-password ceremony', () => {
    document.body.innerHTML = `
      <form id="account-settings">
        <input type="password" autocomplete="current-password" />
        <input type="password" autocomplete="new-password" />
        <input type="password" autocomplete="new-password" />
        <button type="submit">Update password</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      newPasswordFieldCount: 2,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('accepts a contextual save label for a new-password ceremony', () => {
    document.body.innerHTML = `
      <form id="account-settings">
        <input type="password" autocomplete="current-password" />
        <input type="password" autocomplete="new-password" />
        <input type="password" autocomplete="new-password" />
        <button type="submit">Save</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      newPasswordFieldCount: 2,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('accepts a localized semantic submit for an owned identity step', () => {
    document.body.innerHTML = `
      <form id="identity-form">
        <input type="email" autocomplete="email" />
        <button type="button">Siguiente</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('accepts a localized password-only submit with a login action', () => {
    document.body.innerHTML = `
      <form action="/session/login">
        <input type="password" autocomplete="current-password" />
        <button type="submit">Anmelden</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      currentPasswordFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('accepts and activates an image submit control', () => {
    document.body.innerHTML = `
      <form id="login-form">
        <input type="email" autocomplete="username" />
        <input id="image-submit" type="image" alt="Sign in" />
      </form>
    `
    let activated = false
    document.querySelector('#image-submit')?.addEventListener('click', () => {
      activated = true
      document
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { cancelable: true }))
    })

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      authenticationAdvanceControlPresent: true,
    })
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(activated).toBe(true)
  })

  test('activates the accepted username advance control instead of a rejected submit', () => {
    document.body.innerHTML = `
      <form id="login-form">
        <input type="email" autocomplete="username" />
        <button id="save" type="submit">Save</button>
        <button id="next" type="button">Next</button>
      </form>
    `
    let saveActivated = false
    let nextActivated = false
    document.querySelector('#save')?.addEventListener('click', (event) => {
      event.preventDefault()
      saveActivated = true
    })
    document.querySelector('#next')?.addEventListener('click', () => {
      nextActivated = true
    })

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(saveActivated).toBe(false)
    expect(nextActivated).toBe(true)
  })

  test('prefers the credential submit over an earlier social sign-in control', () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username" />
        <input autocomplete="current-password" type="password" />
        <button id="social" type="submit">Sign in with Google</button>
        <button id="credentials" type="submit">Sign in</button>
      </form>
    `
    let socialActivated = false
    let credentialsActivated = false
    document.querySelector('#social')?.addEventListener('click', () => {
      socialActivated = true
    })
    document.querySelector('#credentials')?.addEventListener('click', () => {
      credentialsActivated = true
    })
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
    })

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(socialActivated).toBe(false)
    expect(credentialsActivated).toBe(true)
  })

  test('rejects destructive password-confirmation submits', () => {
    document.body.innerHTML = `
      <form id="account-settings">
        <input type="password" autocomplete="current-password" />
        <button type="submit">Delete account</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      currentPasswordFieldCount: 1,
      authenticationAdvanceControlPresent: false,
    })
  })

  test('rejects localized destructive password-confirmation submits', () => {
    document.body.innerHTML = `
      <form id="account-settings" action="/auth/account/delete">
        <input type="password" autocomplete="current-password" />
        <button type="submit">Eliminar cuenta</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      currentPasswordFieldCount: 1,
      authenticationAdvanceControlPresent: false,
    })
  })

  test('accepts an enabled submit in the first legend of a disabled fieldset', () => {
    document.body.innerHTML = `
      <form id="login-form">
        <input type="password" autocomplete="current-password" />
        <fieldset disabled>
          <legend><button type="submit">Sign in</button></legend>
        </fieldset>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      authenticationAdvanceControlPresent: true,
    })
  })

  test('accepts and activates a nested form-less role button', () => {
    document.body.innerHTML = `
      <section>
        <div><input type="email" autocomplete="username" /></div>
        <div><div id="next" role="button" tabindex="0">Continue</div></div>
      </section>
    `
    let activated = false
    document.querySelector('#next')?.addEventListener('click', () => {
      activated = true
    })

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(activated).toBe(true)
  })

  test('activates a labeled control on a form-less password step', () => {
    document.body.innerHTML = `
      <section>
        <input type="password" autocomplete="current-password" />
        <button id="sign-in" type="button">Sign in</button>
      </section>
    `
    let activated = false
    document.querySelector('#sign-in')?.addEventListener('click', () => {
      activated = true
    })

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      currentPasswordFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(activated).toBe(true)
  })

  test('rejects authentication controls inside an inert subtree', () => {
    document.body.innerHTML = `
      <form id="login-form" inert>
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
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
      expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
      expect(advanced).toBe(true)
      expect(
        document.querySelector<HTMLInputElement>('[name="email"]')?.value,
      ).toBe('pilot@nook.test')
    }
  })

  test('activates an input button used for a username-only advance step', () => {
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
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(advanced).toBe(true)
  })

  test('groups externally associated controls with their form owner', () => {
    document.body.innerHTML = `
      <form id="login"><input autocomplete="username" /></form>
      <input form="login" type="password" autocomplete="current-password" />
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.formScope.kind).toBe('owned')
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      currentPasswordFieldCount: 1,
    })
  })

  test('activates an externally associated advance control', () => {
    document.body.innerHTML = `
      <form id="login"><input autocomplete="username" /></form>
      <button id="continue" form="login" type="button">Continue</button>
    `
    let advanced = false
    document.querySelector('#continue')?.addEventListener('click', () => {
      advanced = true
    })

    const observation = summarizeAuthenticationWorkflowForms()[0]
    expect(observation?.summary.authenticationAdvanceControlPresent).toBe(true)
    if (!observation) throw new Error('expected login observation')
    const submission: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
    }
    expect(submitLoginForm(submission)).toBe(true)
    expect(advanced).toBe(true)
  })

  test('resolves aria-labelledby text for an advance control', () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username" />
        <span id="continue-label">Continue</span>
        <button type="button" aria-labelledby="continue-label"></button>
      </form>
    `

    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      authenticationAdvanceControlPresent: true,
    })
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

  test('suppresses actionless unowned fields beside an owned signup form', () => {
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
    expect(observations).toHaveLength(1)
    expect(observations[0]?.summary).toMatchObject({
      currentPasswordFieldCount: 0,
      newPasswordFieldCount: 1,
    })
  })

  test('keeps a form-less identity step grouped with its sibling advance control', () => {
    document.body.innerHTML = `
      <section>
        <input autocomplete="username" />
        <button type="button">Continue</button>
      </section>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.formScope.kind).toBe('unowned')
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('accepts a localized control inside an explicit form-less login scope', () => {
    document.body.innerHTML = `
      <div id="login">
        <input autocomplete="username" />
        <button type="button">Siguiente</button>
      </div>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.formScope.kind).toBe('locally-scoped')
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('climbs past an inert inner submit to an actionable outer login control', () => {
    document.body.innerHTML = `
      <div id="login">
        <div>
          <input autocomplete="username" />
          <button type="submit" disabled>Wait</button>
        </div>
        <button id="next" type="button">Siguiente</button>
      </div>
    `
    let advanced = false
    document.querySelector('#next')?.addEventListener('click', () => {
      advanced = true
    })

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.formScope.kind).toBe('locally-scoped')
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
    if (!observations[0]) throw new Error('expected login observation')
    const submission: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observations[0].root,
      formScope: observations[0].formScope,
    }
    expect(submitLoginForm(submission)).toBe(true)
    expect(advanced).toBe(true)
  })

  test('rejects a localized control in a generic form-less profile scope', () => {
    document.body.innerHTML = `
      <div class="profile-editor">
        <input autocomplete="username" />
        <button type="button">Siguiente</button>
      </div>
    `

    expect(summarizeAuthenticationWorkflowForms()).toEqual([])
  })

  test('keeps nested form-less identity and advance wrappers in one workflow', () => {
    document.body.innerHTML = `
      <section>
        <div><input autocomplete="username" /></div>
        <div><button type="button">Continue</button></div>
      </section>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    expect(observations[0]?.formScope.kind).toBe('unowned')
    expect(observations[0]?.summary).toMatchObject({
      usernameFieldCount: 1,
      authenticationAdvanceControlPresent: true,
    })
  })

  test('does not join an unowned field to an unrelated page-level control', () => {
    document.body.innerHTML = `
      <div class="profile-editor">
        <input autocomplete="username" />
      </div>
      <aside>
        <button type="button">Sign in</button>
      </aside>
    `

    expect(summarizeAuthenticationWorkflowForms()).toEqual([])
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
})
