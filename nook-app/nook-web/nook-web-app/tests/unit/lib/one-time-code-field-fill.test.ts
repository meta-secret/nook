import { afterEach, describe, expect, test } from 'vitest'
import {
  PasswordFormQueryKind,
  passwordFormCredentialInteraction as credentials,
} from '../../../../nook-web-shared/src/extension/password-forms'

afterEach(() => {
  document.body.replaceChildren()
})

describe('one-time-code field fill', () => {
  test('fills the first enabled OTP field through the native value setter', () => {
    document.body.innerHTML = `
      <input autocomplete="one-time-code" disabled />
      <input id="otp-code" type="tel" />
    `
    const field = document.querySelector<HTMLInputElement>('#otp-code')
    let inputEvents = 0
    field?.addEventListener('input', () => inputEvents++)

    expect(
      credentials.fillOneTimeCode({
        code: '123456',
        kind: PasswordFormQueryKind.Root,
        root: document,
      }),
    ).toBe(true)
    expect(field?.value).toBe('123456')
    expect(inputEvents).toBe(1)
    expect(document.activeElement).toBe(field)
  })
})
