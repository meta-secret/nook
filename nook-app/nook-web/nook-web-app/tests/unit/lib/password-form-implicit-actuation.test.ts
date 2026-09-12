import { afterEach, describe, expect, test } from 'vitest'
import {
  FormSubmissionResult,
  PasswordFormQueryKind,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentRequest: Parameters<
  typeof passwordFormInteraction.submitLoginForm
>[0] = {
  kind: PasswordFormQueryKind.Root,
  root: document,
}

function installXIdentifierLogin(): HTMLFormElement {
  window.history.replaceState({}, '', '/i/jf/onboarding/web?mode=login')
  document.body.innerHTML = `
    <form>
      <button type="button">Continue with Apple</button>
      <button type="button">Continue with phone</button>
      <label for="x-username">Email or username</label>
      <input id="x-username" name="username_or_email" type="text" autocomplete="username webauthn" />
      <div style="display: none"><input name="password" type="password" /></div>
      <div>Continue</div>
    </form>
  `
  const form = document.querySelector('form')
  if (!form) throw new Error('expected X login form')
  return form
}

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState({}, '', '/')
})

describe('implicit authentication actuation', () => {
  test('submits the exact X identifier-only login facts', () => {
    const form = installXIdentifierLogin()
    let submitted = false
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      submitted = true
    })

    expect(passwordFormInteraction.submitLoginForm(wholeDocumentRequest)).toBe(
      FormSubmissionResult.Submitted,
    )
    expect(submitted).toBe(true)
  })

  test.each([
    [
      'destination',
      (form: HTMLFormElement) => form.setAttribute('action', '/capture'),
    ],
    [
      'form identity',
      (form: HTMLFormElement) => form.setAttribute('aria-label', 'Sign up'),
    ],
    [
      'login-mode query',
      () => window.history.replaceState({}, '', '/i/jf/onboarding/web'),
    ],
    [
      'field count',
      (form: HTMLFormElement) => {
        const decoy = document.createElement('input')
        decoy.autocomplete = 'username'
        form.append(decoy)
      },
    ],
    [
      'password visibility',
      (form: HTMLFormElement) => {
        const password = form.querySelector<HTMLInputElement>(
          'input[type="password"]',
        )
        if (password?.parentElement) password.parentElement.style.display = ''
      },
    ],
    [
      'advance control',
      (form: HTMLFormElement) => {
        const submitter = document.createElement('button')
        submitter.type = 'submit'
        submitter.textContent = 'Sign in'
        form.append(submitter)
      },
    ],
  ])('rejects X submission after approved %s facts drift', (_, drift) => {
    const form = installXIdentifierLogin()
    let rejected = false
    let pageSubmitted = false
    form.addEventListener('submit', () => drift(form), true)
    form.addEventListener('submit', () => {
      pageSubmitted = true
    })

    const submissionRequest: Parameters<
      typeof passwordFormInteraction.submitLoginForm
    >[0] = {
      ...wholeDocumentRequest,
      submissionApproval: {
        isApproved: () => true,
        reject: () => {
          rejected = true
        },
      },
    }
    const result = passwordFormInteraction.submitLoginForm(submissionRequest)

    expect(result).toBe(FormSubmissionResult.Rejected)
    expect(rejected).toBe(true)
    expect(pageSubmitted).toBe(false)
  })
})
