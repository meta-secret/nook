import { afterEach, describe, expect, test } from 'vitest'
import {
  authenticationWorkflowFormsHaveActionableControl,
  fillLoginCredentials,
  fillOneTimeCode,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  summarizeAuthenticationWorkflowForms,
  submitLoginForm,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentPasswordFormSubmission: Parameters<
  typeof submitLoginForm
>[0] = { kind: PasswordFormQueryKind.Root, root: document }

afterEach(() => {
  document.body.replaceChildren()
})

describe('website authentication form submission', () => {
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

  test('does not activate an unrelated div-based control', () => {
    document.body.innerHTML = `
      <section>
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="button">Save</button>
      </section>
    `

    const submissionArgs: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: document,
      formScope: { kind: PasswordFormScopeKind.Unowned },
    }
    expect(submitLoginForm(submissionArgs)).toBe(false)
  })

  test('activates only the localized control in an explicit form-less login scope', () => {
    document.body.innerHTML = `
      <div id="login">
        <input autocomplete="username" />
        <button type="button">Siguiente</button>
      </div>
      <button id="outside-control" type="button">Siguiente</button>
    `
    const loginContainer = document.querySelector<HTMLElement>('#login')
    const loginControl = loginContainer?.querySelector('button')
    const outsideControl = document.querySelector('#outside-control')
    let loginActivations = 0
    let outsideActivations = 0
    loginControl?.addEventListener('click', () => loginActivations++)
    outsideControl?.addEventListener('click', () => outsideActivations++)
    expect(loginContainer).toBeTruthy()
    if (!loginContainer) return

    const submissionArgs: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: loginContainer,
      formScope: {
        kind: PasswordFormScopeKind.LocallyScoped,
        owner: loginContainer,
      },
    }
    expect(submitLoginForm(submissionArgs)).toBe(true)
    expect(loginActivations).toBe(1)
    expect(outsideActivations).toBe(0)
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

  test('prefers the semantic submit over an earlier neutral activation', () => {
    document.body.innerHTML = `
      <form id="login">
        <input type="email" autocomplete="username" value="pilot@example.com" />
        <button id="neutral" type="button">Continue</button>
        <button id="credentials" type="submit">Continue</button>
      </form>
    `
    let neutralActivations = 0
    let submitEvents = 0
    document.querySelector('#neutral')?.addEventListener('click', () => {
      neutralActivations++
    })
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
      submitEvents++
    })

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(neutralActivations).toBe(0)
    expect(submitEvents).toBe(1)
  })

  test('does not substitute a generic activation for a disabled submit', () => {
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" value="pilot" />
        <input type="password" autocomplete="current-password" value="secret" />
        <button id="language" type="button">Language</button>
        <button type="submit" disabled>Sign in</button>
      </form>
    `
    let languageActivations = 0
    document.querySelector('#language')?.addEventListener('click', () => {
      languageActivations++
    })
    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityArgs: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }

    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityArgs),
    ).toBe(false)
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
    expect(languageActivations).toBe(0)
  })

  test('does not substitute a generic activation for a rejected submit', () => {
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" value="pilot" />
        <input type="password" autocomplete="current-password" value="secret" />
        <button id="language" type="button">Language</button>
        <button id="save" type="submit">Save</button>
      </form>
    `
    let languageActivations = 0
    let saveActivations = 0
    document.querySelector('#language')?.addEventListener('click', () => {
      languageActivations++
    })
    document.querySelector('#save')?.addEventListener('click', (event) => {
      event.preventDefault()
      saveActivations++
    })

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
    expect(languageActivations).toBe(0)
    expect(saveActivations).toBe(0)
  })

  test('does not activate a submit disabled through pointer events', () => {
    document.body.innerHTML = `
      <form id="login">
        <input type="password" autocomplete="current-password" />
        <button type="submit" style="pointer-events: none">Sign in</button>
      </form>
    `
    let activations = 0
    document.querySelector('button')?.addEventListener('click', () => {
      activations++
    })

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
    expect(activations).toBe(0)
  })

  test('does not classify or activate a reset button as authentication', () => {
    document.body.innerHTML = `
      <form id="login">
        <input id="username" autocomplete="username" value="pilot" />
        <input id="password" type="password" autocomplete="current-password" value="secret" />
        <button type="reset">Clear</button>
      </form>
    `
    let resetEvents = 0
    document.querySelector('form')?.addEventListener('reset', () => {
      resetEvents++
    })
    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityArgs: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }

    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityArgs),
    ).toBe(false)
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
    expect(resetEvents).toBe(0)
    expect(document.querySelector<HTMLInputElement>('#username')?.value).toBe(
      'pilot',
    )
    expect(document.querySelector<HTMLInputElement>('#password')?.value).toBe(
      'secret',
    )
  })

  test('does not activate a password reveal when the credential submit is disabled', () => {
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" value="pilot" />
        <input type="password" autocomplete="current-password" value="secret" />
        <button id="reveal" type="button">Show password</button>
        <button type="submit" disabled>Sign in</button>
      </form>
    `
    let revealActivations = 0
    document.querySelector('#reveal')?.addEventListener('click', () => {
      revealActivations++
    })
    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityArgs: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }

    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityArgs),
    ).toBe(false)
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
    expect(revealActivations).toBe(0)
  })

  test('does not activate password recovery when the credential submit is disabled', () => {
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" value="pilot" />
        <input type="password" autocomplete="current-password" value="secret" />
        <button id="recovery" type="button">Forgot password?</button>
        <button type="submit" disabled>Sign in</button>
      </form>
    `
    let recoveryActivations = 0
    document.querySelector('#recovery')?.addEventListener('click', () => {
      recoveryActivations++
    })
    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityArgs: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }

    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityArgs),
    ).toBe(false)
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
    expect(recoveryActivations).toBe(0)
  })

  test('does not activate a password recovery submit', () => {
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" value="pilot" />
        <input type="password" autocomplete="current-password" value="secret" />
        <button id="recovery" type="submit" formaction="/recover">Forgot password?</button>
        <button type="submit" disabled>Sign in</button>
      </form>
    `
    let recoveryActivations = 0
    document.querySelector('#recovery')?.addEventListener('click', () => {
      recoveryActivations++
    })

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
    expect(recoveryActivations).toBe(0)
  })

  test('activates a branded primary credential submit', () => {
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" value="pilot" />
        <input type="password" autocomplete="current-password" value="secret" />
        <button id="credentials" type="submit">Sign in to Microsoft 365</button>
      </form>
    `
    let submitEvents = 0
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
      submitEvents++
    })
    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityArgs: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }

    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityArgs),
    ).toBe(true)
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(submitEvents).toBe(1)
  })

  test('skips a registration submit before the credential submit', () => {
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" value="pilot" />
        <input type="password" autocomplete="current-password" value="secret" />
        <button id="register" type="submit" formaction="/register">Create account</button>
        <button id="credentials" type="submit">Sign in</button>
      </form>
    `
    let registrationActivations = 0
    let credentialActivations = 0
    document.querySelector('#register')?.addEventListener('click', () => {
      registrationActivations++
    })
    document.querySelector('#credentials')?.addEventListener('click', () => {
      credentialActivations++
    })
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
    })

    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(registrationActivations).toBe(0)
    expect(credentialActivations).toBe(1)
  })

  test('rejects localized submits whose destination changes authentication route', () => {
    for (const destination of ['/register', '/password/recover']) {
      document.body.innerHTML = `
        <form id="login" action="/session">
          <input autocomplete="username" value="pilot" />
          <input type="password" autocomplete="current-password" value="secret" />
          <button id="alternate" type="submit" formaction="${destination}">Continuar</button>
        </form>
      `
      let alternateActivations = 0
      document.querySelector('#alternate')?.addEventListener('click', () => {
        alternateActivations++
      })
      const observations = summarizeAuthenticationWorkflowForms()
      const actionabilityArgs: Parameters<
        typeof authenticationWorkflowFormsHaveActionableControl
      >[0] = { observations }

      expect(
        authenticationWorkflowFormsHaveActionableControl(actionabilityArgs),
      ).toBe(false)
      expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
      expect(alternateActivations).toBe(0)
    }
  })

  test('does not classify or activate plain navigation as credential submission', () => {
    document.body.innerHTML = `
      <form id="login">
        <input autocomplete="username" value="pilot" />
        <input type="password" autocomplete="current-password" value="secret" />
        <a id="continue-link" href="/next">Continue</a>
      </form>
    `
    let linkActivations = 0
    document
      .querySelector('#continue-link')
      ?.addEventListener('click', (event) => {
        event.preventDefault()
        linkActivations++
      })
    const observations = summarizeAuthenticationWorkflowForms()
    const actionabilityArgs: Parameters<
      typeof authenticationWorkflowFormsHaveActionableControl
    >[0] = { observations }

    expect(
      authenticationWorkflowFormsHaveActionableControl(actionabilityArgs),
    ).toBe(false)
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
    expect(linkActivations).toBe(0)
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
