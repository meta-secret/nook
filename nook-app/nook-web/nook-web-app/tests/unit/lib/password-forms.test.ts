import { afterEach, describe, expect, test } from 'vitest'
import {
  fillLoginCredentials,
  fillOneTimeCode,
  findOneTimeCodeFields,
  findPasskeyControl,
  pageHasPasskeyControl,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
  summarizePasswordForms,
} from '../../../../nook-web-shared/src/extension/password-forms'

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

    expect(findOneTimeCodeFields()).toHaveLength(2)
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

    const fields = findOneTimeCodeFields()
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
    expect(
      fillLoginCredentials({ username: 'user@contoso.com', password: '' }),
    ).toBe(true)
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

  test('fills username-only then advances a Next control on multi-step login', () => {
    document.body.innerHTML = `
      <form id="login-form">
        <input autocomplete="username" name="email" type="email" />
        <button id="next" type="button">Next</button>
      </form>
    `
    let advanced = false
    document.querySelector('#next')?.addEventListener('click', () => {
      advanced = true
    })

    expect(
      fillLoginCredentials({ username: 'pilot@nook.test', password: '' }),
    ).toBe(true)
    expect(submitLoginForm()).toBe(true)
    expect(advanced).toBe(true)
    expect(
      document.querySelector<HTMLInputElement>('[name="email"]')?.value,
    ).toBe('pilot@nook.test')
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
    expect(
      fillLoginCredentials({ username: 'pilot', password: 'secret' }),
    ).toBe(true)
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

    expect(
      fillLoginCredentials({ username: 'pilot', password: 'secret' }),
    ).toBe(true)
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

    expect(submitLoginForm(document, { kind: 'unowned' })).toBe(false)
  })

  test('does not claim a disabled submit control was activated', () => {
    document.body.innerHTML = `
      <form>
        <input type="password" autocomplete="current-password" />
        <button type="submit" disabled>Sign in</button>
      </form>
    `

    expect(submitLoginForm()).toBe(false)
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

    expect(submitLoginForm()).toBe(true)
  })

  test('fills the first enabled OTP field through the native value setter', () => {
    document.body.innerHTML = `
      <input autocomplete="one-time-code" disabled />
      <input id="otp-code" type="tel" />
    `
    const field = document.querySelector<HTMLInputElement>('#otp-code')
    let inputEvents = 0
    field?.addEventListener('input', () => inputEvents++)

    expect(fillOneTimeCode('123456')).toBe(true)
    expect(field?.value).toBe('123456')
    expect(inputEvents).toBe(1)
    expect(document.activeElement).toBe(field)
  })
})

describe('passkey control detection', () => {
  test('does not treat password inputs with webauthn autocomplete as passkey controls', () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="section-login username" name="email" type="email" />
        <input
          autocomplete="section-login current-password webauthn"
          name="password"
          type="password"
        />
        <button type="submit">Sign in</button>
      </form>
    `

    expect(findPasskeyControl()).toBeUndefined()
    expect(pageHasPasskeyControl()).toBe(false)
    expect(summarizeAuthenticationWorkflowForms()[0]?.summary).toMatchObject({
      passkeyControlPresent: false,
      currentPasswordFieldCount: 1,
    })
  })

  test('detects marked and labeled passkey controls', () => {
    document.body.innerHTML = `
      <button type="button" data-nook-passkey-control>Continue</button>
    `
    expect(
      findPasskeyControl()?.getAttribute('data-nook-passkey-control'),
    ).toBe('')

    document.body.innerHTML = `
      <button type="button">Sign in with a passkey</button>
    `
    expect(findPasskeyControl()?.textContent).toContain('passkey')
    expect(pageHasPasskeyControl()).toBe(true)
  })
})
