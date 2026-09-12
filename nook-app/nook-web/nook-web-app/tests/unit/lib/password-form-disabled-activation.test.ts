import { afterEach, describe, expect, test } from 'vitest'
import {
  FormSubmissionResult,
  PasswordFormQueryKind,
  passwordFormInteraction as forms,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentPasswordFormSubmission: Parameters<
  typeof forms.submitLoginForm
>[0] = { kind: PasswordFormQueryKind.Root, root: document }

function didSubmit(
  request: Parameters<typeof forms.submitLoginForm>[0],
): boolean {
  return forms.submitLoginForm(request) === FormSubmissionResult.Submitted
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('disabled authentication submit controls', () => {
  test('activates a submitter in the first legend of a disabled fieldset', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <fieldset disabled>
          <legend>
            <button id="sign-in" type="submit" formaction="/auth/login">Sign in</button>
          </legend>
          <button type="submit">Cancel</button>
        </fieldset>
      </form>
    `
    let activated = ''
    document.querySelector('#sign-in')?.addEventListener('click', () => {
      activated = 'sign-in'
    })
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
    })

    expect(didSubmit(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(activated).toBe('sign-in')
  })
})
