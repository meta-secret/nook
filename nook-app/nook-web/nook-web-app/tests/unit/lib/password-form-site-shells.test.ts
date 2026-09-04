import { afterEach, describe, expect, test } from 'vitest'
import {
  AuthenticationWorkflowAction,
  CompanionAuthenticationWorkflowMatchKind,
  classify_companion_authentication_workflow_facts,
  companion_authentication_workflow_match_kind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authenticationPageObservationFacts,
  fillLoginCredentials,
  FormSubmissionResult,
  PasswordFormQueryKind,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { localOwnedLoginObservationRoot } from '../../../../nook-web-shared/src/extension/password-form-fields'

afterEach(() => {
  document.body.replaceChildren()
})

describe('popular-site login shells', () => {
  test('isolates and fills a local login inside a polluted page-wide form', () => {
    document.body.innerHTML = `<form id="aspnetForm" method="post"><header><input name="header-user" autocomplete="username" hidden /><input name="header-password" type="password" autocomplete="current-password" hidden /><input name="search" type="search" value="account help" /><button type="submit">Search</button></header><main class="login-panel"><div class="field-grid"><input name="username" autocomplete="username" /><input name="password" type="password" autocomplete="current-password" /><button id="login-submit" type="submit">Sign in</button></div></main>
      <footer><input name="newsletter-email" type="email" value="reader@example.test" /><button type="submit">Subscribe</button></footer></form>`

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    const [observation] = observations
    if (!observation) throw new Error('expected local login observation')
    expect(observation.root).toBe(document.querySelector('.login-panel'))
    expect(observation.summary).toMatchObject({
      usernameFieldCount: 1,
      currentPasswordFieldCount: 1,
      passwordFieldCount: 1,
    })

    const loginFillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: {
        username: 'pilot@nook.test',
        password: 'extension-fill-password',
      },
      kind: PasswordFormQueryKind.Scoped,
      ...observation,
    }
    expect(fillLoginCredentials(loginFillArgs)).toBe(true)
    expect(
      document.querySelector<HTMLInputElement>('[name="username"]')?.value,
    ).toBe('pilot@nook.test')
    expect(
      document.querySelector<HTMLInputElement>('[name="password"]')?.value,
    ).toBe('extension-fill-password')
    expect(
      document.querySelector<HTMLInputElement>('[name="search"]')?.value,
    ).toBe('account help')
    expect(
      document.querySelector<HTMLInputElement>('[name="newsletter-email"]')
        ?.value,
    ).toBe('reader@example.test')
  })

  test('keeps a page-wide owner when a rendered OTP sibling is present', () => {
    document.body.innerHTML = `<form><main class="login-panel"><input autocomplete="username" /><input type="password" autocomplete="current-password" /></main>
      <aside><input autocomplete="one-time-code" /></aside></form>`

    expect(summarizeAuthenticationWorkflowForms()[0]?.root).toBe(document)
  })

  test('rejects a document-shell root for associated login fields', () => {
    document.body.innerHTML = `<form id="aspnetForm"></form>
      <input form="aspnetForm" autocomplete="username" />
      <input form="aspnetForm" type="password" autocomplete="current-password" />`

    expect(summarizeAuthenticationWorkflowForms()[0]?.root).toBe(document)
  })

  test('does not treat substring identity as a bounded login surface', () => {
    document.body.innerHTML = `<form><main class="preset-layout">
      <section><input autocomplete="username" /></section><aside><input type="password" autocomplete="current-password" /></aside>
      <button type="submit">Reset filters</button></main></form>`

    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected generic shell observation')
    expect(observation.root).toBe(document)
    const request: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      ...observation,
    }
    expect(submitLoginForm(request)).toBe(FormSubmissionResult.NotObserved)
  })

  test('indexes a large field set by exact form owner', () => {
    document.body.innerHTML = Array.from(
      { length: 101 },
      (_, index) => `<form id="owner-${index}"><main class="login-panel">
        <input autocomplete="username" /><input type="password" autocomplete="current-password" /></main></form>`,
    ).join('')
    const owner = document.querySelector<HTMLFormElement>('#owner-100')
    if (!owner) throw new Error('expected indexed owner fixture')
    const request: Parameters<typeof localOwnedLoginObservationRoot>[0] = {
      owner,
      passwordFields: [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[type="password"]',
        ),
      ],
      usernameFields: [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[autocomplete="username"]',
        ),
      ],
      oneTimeCodeFields: [],
    }

    expect(localOwnedLoginObservationRoot(request)).toBe(
      owner.querySelector('.login-panel'),
    )
  })

  test('does not submit outside a bounded page-wide login panel', () => {
    document.body.innerHTML = `<form id="aspnetForm" method="post">
      <header><button id="header-submit" type="submit">Sign in</button></header>
      <main class="login-panel"><input name="username" autocomplete="username" /><input name="password" type="password" autocomplete="current-password" /></main>
      <footer><button id="footer-submit" type="submit">Continue</button></footer></form>`
    const activations: Event[] = []
    const form = document.querySelector<HTMLFormElement>('#aspnetForm')
    const header = document.querySelector<HTMLButtonElement>('#header-submit')
    const footer = document.querySelector<HTMLButtonElement>('#footer-submit')
    if (!form || !header || !footer) {
      throw new Error('expected page-wide submission fixture')
    }
    form.addEventListener('submit', (event) => activations.push(event))
    header.addEventListener('click', (event) => activations.push(event))
    footer.addEventListener('click', (event) => activations.push(event))

    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected bounded login observation')
    expect(observation.root).toBe(document.querySelector('.login-panel'))
    const request: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      ...observation,
    }
    expect(submitLoginForm(request)).toBe(FormSubmissionResult.NotObserved)
    expect(activations).toEqual([])
  })

  test('preserves a same-form checkpoint outside the local login panel', () => {
    document.body.innerHTML = `<form id="aspnetForm" method="post">
      <main class="login-panel"><input name="username" autocomplete="username" /><input name="password" type="password" autocomplete="current-password" /><button type="submit">Sign in</button></main></form>
      <aside><label><input form="aspnetForm" type="checkbox" name="terms" /> I agree to the terms</label></aside>`

    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected checkpoint observation')
    expect(observation.root).toBe(document)
    expect(observation.summary.manualCheckpointPresent).toBe(true)
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
    })
    const match = classify_companion_authentication_workflow_facts({
      observations: [facts],
    })
    expect(companion_authentication_workflow_match_kind(match)).toBe(
      CompanionAuthenticationWorkflowMatchKind.Matched,
    )
    if (!('snapshot' in match)) throw new Error('expected matched workflow')
    expect(match.snapshot.action).toBe(AuthenticationWorkflowAction.TakeOver)
  })

  test('returns no workflow for ordinary pages and email-only newsletters', () => {
    document.body.innerHTML = `
      <main><p>Documentation</p></main>
      <form method="post"><input type="email" name="newsletter-email" /><button>Submit</button></form>
    `

    expect(summarizeAuthenticationWorkflowForms()).toEqual([])
  })

  test('detects Microsoft-like email-first login without autocomplete=username', () => {
    document.body.innerHTML = `
      <form method="post" id="loginForm">
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
        <form method="post" id="login_form">
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
      <form method="post">
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
            <form method="post" id="gaia_loginform">
              <input type="email" name="identifier" id="identifierId" autocomplete="username" />
              <button type="submit">Next</button>
            </form>
          `,
          username: 1,
          password: 0,
        },
        {
          html: `
            <form method="post" class="signin">
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
            <form method="post" name="signIn">
              <input type="email" name="email" id="ap_email" autocomplete="username" />
              <button type="submit" id="continue">Continue</button>
            </form>
          `,
          username: 1,
          password: 0,
        },
        {
          html: `
            <form method="post">
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
            <form method="post" class="login__form">
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
            <form method="post">
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
