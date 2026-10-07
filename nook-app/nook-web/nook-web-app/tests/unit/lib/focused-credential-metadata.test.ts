import { afterEach, describe, expect, test } from 'vitest'
import { passwordFieldDiscovery } from '../../../../nook-web-shared/src/extension/password-forms'

afterEach(() => document.body.replaceChildren())

describe('focused browser metadata observation', () => {
  test('transports credential metadata without a secret or whole-page login assumption', () => {
    document.body.innerHTML =
      '<label for="focused-email">Email</label><input id="focused-email" name="account-email" autocomplete="username" type="email">'
    const input = document.querySelector('input')
    switch (true) {
      case input instanceof HTMLInputElement: {
        input.value = 'private-value-that-must-not-cross-classification'
        const observation =
          passwordFieldDiscovery.focusedFieldObservation(input)
        const expected: Partial<typeof observation> = {
          inputType: 'email',
          autocompleteTokens: ['username'],
          disabled: false,
          readOnly: false,
          loginContext: false,
        }
        expect(observation).toMatchObject(expected)
        expect(observation.identityText).toContain('account-email')
        expect(JSON.stringify(observation)).not.toContain(input.value)
        break
      }
      case true:
        throw new Error('Expected the fixture input')
    }
  })

  test('captures current metadata again after the role or writable state changes', () => {
    const input = document.createElement('input')
    input.autocomplete = 'username'
    document.body.append(input)
    const before = passwordFieldDiscovery.focusedFieldObservation(input)
    input.autocomplete = 'one-time-code'
    input.disabled = true
    input.readOnly = true
    const after = passwordFieldDiscovery.focusedFieldObservation(input)
    expect(before.autocompleteTokens).toEqual(['username'])
    expect(after.autocompleteTokens).toEqual(['one-time-code'])
    expect(after.disabled).toBe(true)
    expect(after.readOnly).toBe(true)
  })
})
