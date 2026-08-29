import { afterEach, describe, expect, test } from 'vitest'
import {
  findPasskeyControl,
  findWorkflowPasskeyControl,
  pageHasPasskeyControl,
  PasskeyControlLookupKind,
  summarizeAuthenticationWorkflowForms,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'

function observedAuthenticationWorkflow(): PasswordFormObservation {
  const observation = summarizeAuthenticationWorkflowForms()[0]
  if (!observation) throw new Error('expected an authentication workflow')
  return observation
}

afterEach(() => {
  document.body.replaceChildren()
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
    const marked = findPasskeyControl()
    expect(marked.kind).toBe(PasskeyControlLookupKind.Found)
    if (marked.kind === PasskeyControlLookupKind.Found) {
      expect(marked.control.getAttribute('data-nook-passkey-control')).toBe('')
    }

    document.body.innerHTML = `
      <button type="button">Sign in with a passkey</button>
    `
    const labeled = findPasskeyControl()
    expect(labeled.kind).toBe(PasskeyControlLookupKind.Found)
    if (labeled.kind === PasskeyControlLookupKind.Found) {
      expect(labeled.control.textContent).toContain('passkey')
    }
    expect(pageHasPasskeyControl()).toBe(true)
  })

  test('binds the exact later passkey candidate approved by Rust', () => {
    document.body.innerHTML = `<form id="login" action="/auth/login"><input autocomplete="username" /><button id="inert" disabled>Use passkey</button><button id="safe">Use passkey</button></form>`
    const control = findWorkflowPasskeyControl(observedAuthenticationWorkflow())
    expect(control.kind).toBe(PasskeyControlLookupKind.Found)
    if (control.kind === PasskeyControlLookupKind.Found)
      expect(control.control.id).toBe('safe')
  })
})
