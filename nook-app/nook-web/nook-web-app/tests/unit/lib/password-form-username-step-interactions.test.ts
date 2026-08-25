import { afterEach, describe, expect, test } from 'vitest'
import {
  fillLoginCredentials,
  PasswordFormQueryKind,
  submitLoginForm,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentPasswordFormSubmission: Parameters<
  typeof submitLoginForm
>[0] = { kind: PasswordFormQueryKind.Root, root: document }

afterEach(() => {
  document.body.replaceChildren()
})

describe('username-step credential interactions', () => {
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
})
