import { afterEach, describe, expect, test } from 'vitest'
import {
  fillLoginCredentials,
  fillOneTimeCode,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentPasswordFormSubmission: Parameters<
  typeof submitLoginForm
>[0] = { kind: PasswordFormQueryKind.Root, root: document }

afterEach(() => {
  document.body.replaceChildren()
})

describe('classified login activation', () => {
  test('advances a username-only login through an external form-associated control', () => {
    document.body.innerHTML = `
      <form id="login" action="/auth/login">
        <input autocomplete="username" name="email" type="email" />
      </form>
      <button id="next" type="submit" form="login">Continue</button>
    `
    let advanced = false
    document.querySelector('#next')?.addEventListener('click', () => {
      advanced = true
    })
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
    })
    const form = document.querySelector('form')
    if (!form) throw new Error('expected login form')

    expect(
      submitLoginForm({
        kind: PasswordFormQueryKind.Scoped,
        root: form,
        formScope: { kind: PasswordFormScopeKind.Owned, owner: form },
      }),
    ).toBe(true)
    expect(advanced).toBe(true)
  })

  test('fills username-only then advances common multi-step login controls', () => {
    for (const label of ['Continue with email', 'Sign in using password']) {
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

  test.each([
    ['Amazon provider', '<button>Continue with Amazon</button>', ''],
    ['labelled provider', '<input type="submit" aria-labelledby="p" />', ''],
    [
      'titled provider',
      '<input type="submit" title="Continue with Amazon" />',
      '',
    ],
    ['destructive action', '<button id="delete-account">Continue</button>', ''],
    ['provider', '<button name="provider" value="acme">Continue</button>', ''],
    ['unlabeled control', '<button type="button"></button>', ''],
    ['hidden ancestor', '<button name="continue"></button>', 'hidden'],
  ])('skips %s before advancing login', (_, control, parentAttrs) => {
    document.body.innerHTML = `
      <form id="login-form">
        <input autocomplete="username" name="email" type="email" />
        <span id="p">Continue with Amazon</span>
        <span ${parentAttrs}>${control}</span>
        <button id="login-next" type="button">Continue</button>
      </form>
    `
    const activatedControls: string[] = []
    for (const control of document.querySelectorAll<HTMLInputElement>(
      'button, input[type="submit"]',
    )) {
      control.addEventListener('click', () =>
        activatedControls.push(control.id),
      )
    }

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(activatedControls).toEqual(['login-next'])
  })

  test('advances a native semantic submit through a safe login route', () => {
    document.body.innerHTML = `
      <form id="account-step" action="/auth/login">
        <input autocomplete="username" name="email" type="email" />
        <input id="login-next" type="submit" />
      </form>
    `
    let activated = false
    document.querySelector('#login-next')?.addEventListener('click', () => {
      activated = true
    })

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(activated).toBe(true)
  })

  test.each([
    ['<button aria-label="Anmelden" title="Anmelden">Anmelden</button>', true],
    [
      '<button aria-label="Se connecter" title="Se connecter">Se connecter</button>',
      true,
    ],
    ['<button type="submit">Supprimer le compte</button>', false],
    ['<form id="f"><button>Entrar</button></form>', false],
  ])('gates form-less localized control %s', (control, expected) => {
    window.history.replaceState({}, '', '/')
    document.body.innerHTML = `
      <div role="form" class="signin-panel">
        <input data-qa="login_email" name="email" type="email" />
        ${control}
      </div>
    `
    const workflow = summarizeAuthenticationWorkflowForms()[0]
    expect(workflow?.formScope.kind).toBe(PasswordFormScopeKind.Unowned)
    const submissionArgs: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: workflow?.root ?? document,
      formScope: workflow?.formScope ?? {
        kind: PasswordFormScopeKind.Unowned,
      },
    }

    expect(submitLoginForm(submissionArgs)).toBe(expected)
  })

  test.each([
    ['', '', true],
    ['', '<button type="button">Help</button>', true],
    ['delete-account', '', false],
  ])(
    'gates implicit username-only submit for %s',
    (formId, control, allowed) => {
      window.history.replaceState({}, '', '/account')
      document.body.innerHTML = `<form id="${formId}" action="/login"><input autocomplete="username" />${control}</form>`
      document.querySelector('form')?.addEventListener('submit', (event) => {
        event.preventDefault()
      })

      expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(allowed)
    },
  )

  test.each([
    ['destructive same-origin action', '/settings/delete-account'],
    ['external provider', '/signin/google'],
    ['password recovery', '/reset-password'],
    ['registration', '/register'],
  ])('does not advance a username-only login through %s', (_, route) => {
    document.body.innerHTML = `
      <form id="login-form" action="/auth/login">
        <input autocomplete="username" name="email" type="email" />
        <button id="alternate-route" type="submit" formaction="${route}">Continue</button>
      </form>
    `
    let activated = false
    document
      .querySelector('#alternate-route')
      ?.addEventListener('click', () => {
        activated = true
      })

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
    expect(activated).toBe(false)
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

    const submissionArgs: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: document,
      formScope: { kind: PasswordFormScopeKind.Unowned },
    }
    expect(submitLoginForm(submissionArgs)).toBe(false)
  })

  test('does not claim a disabled submit control was activated', () => {
    document.body.innerHTML = `
      <form>
        <input type="password" autocomplete="current-password" />
        <button type="submit" disabled>Sign in</button>
      </form>
    `

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
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

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
  })

  test('submits the exact later control approved by Rust', () => {
    document.body.innerHTML = `<form id="login" action="/auth/login"><input autocomplete="username" /><input type="password" /><button id="unsafe" type="submit" formaction="/register">Continue</button><button id="safe" type="submit">Sign in</button></form>`
    const activated: string[] = []
    for (const control of document.querySelectorAll<HTMLButtonElement>(
      'button',
    ))
      control.addEventListener('click', () => activated.push(control.id))
    document
      .querySelector('form')
      ?.addEventListener('submit', (event) => event.preventDefault())
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(activated).toEqual(['safe'])
  })

  test('submits the exact approved external form-associated control', () => {
    document.body.innerHTML = `<form id="login" action="/auth/login"><input autocomplete="username" /><input type="password" /></form><button id="unsafe" type="submit" form="login" formaction="/register">Continue</button><button id="safe" type="submit" form="login">Sign in</button>`
    const activated: string[] = []
    for (const control of document.querySelectorAll<HTMLButtonElement>(
      'button',
    ))
      control.addEventListener('click', () => activated.push(control.id))
    document
      .querySelector('form')
      ?.addEventListener('submit', (event) => event.preventDefault())

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(activated).toEqual(['safe'])
  })

  test('does not submit a form outside the requested root', () => {
    document.body.innerHTML = `<form id="outside" action="/auth/login"><button id="submit" type="submit">Sign in</button></form><section id="scope"><input form="outside" type="password" /></section>`
    let activated = false
    document
      .querySelector<HTMLButtonElement>('#submit')
      ?.addEventListener('click', () => {
        activated = true
      })
    const root = document.querySelector<HTMLElement>('#scope')
    if (!root) throw new Error('expected scoped authentication root')

    expect(submitLoginForm({ kind: PasswordFormQueryKind.Root, root })).toBe(
      false,
    )
    expect(activated).toBe(false)
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
