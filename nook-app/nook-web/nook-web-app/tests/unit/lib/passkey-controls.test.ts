import { afterEach, describe, expect, test } from 'vitest'
import {
  findPasskeyControl,
  findPasskeyControlForScope,
  pageHasPasskeyControl,
  PasskeyControlLookupKind,
  PasswordFormScopeKind,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'

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

  test('rejects passkey controls that are not actionable', () => {
    document.body.innerHTML = `
      <button type="button" data-nook-passkey-control hidden>Continue</button>
      <button type="button" disabled>Sign in with a passkey</button>
      <button type="button" aria-disabled="true">Use passkey</button>
      <section inert><button type="button">Continue with passkey</button></section>
    `

    expect(findPasskeyControl().kind).toBe(PasskeyControlLookupKind.Absent)
    expect(pageHasPasskeyControl()).toBe(false)
    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
  })

  test('scopes passkey controls to their observed form', () => {
    document.body.innerHTML = `
      <form id="settings">
        <input autocomplete="current-password" type="password" />
        <button type="submit">Save</button>
      </form>
      <form id="login">
        <input autocomplete="username" />
        <button type="button">Use a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const settings = observations.find(
      ({ formScope }) =>
        formScope.kind === PasswordFormScopeKind.Owned &&
        formScope.owner.id === 'settings',
    )
    const login = observations.find(
      ({ formScope }) =>
        formScope.kind === PasswordFormScopeKind.Owned &&
        formScope.owner.id === 'login',
    )
    expect(settings?.summary.passkeyControlPresent).toBe(false)
    expect(login?.summary.passkeyControlPresent).toBe(true)
  })

  test('keeps a separate passkey-only form beside credential forms', () => {
    document.body.innerHTML = `
      <form id="credentials">
        <input autocomplete="username" />
        <input autocomplete="current-password" type="password" />
        <button type="submit">Sign in</button>
      </form>
      <form id="passkey">
        <button id="passkey-control" type="button">Use a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const passkeyObservation = observations.find(
      ({ formScope }) =>
        formScope.kind === PasswordFormScopeKind.Owned &&
        formScope.owner.id === 'passkey',
    )
    expect(passkeyObservation?.summary).toMatchObject({
      passwordFieldCount: 0,
      usernameFieldCount: 0,
      passkeyControlPresent: true,
    })

    const lookupArgs: Parameters<typeof findPasskeyControlForScope>[0] = {
      root: passkeyObservation?.root ?? document,
      formScope: passkeyObservation?.formScope ?? {
        kind: PasswordFormScopeKind.Unowned,
      },
    }
    const lookup = findPasskeyControlForScope(lookupArgs)
    expect(lookup.kind).toBe(PasskeyControlLookupKind.Found)
    if (lookup.kind === PasskeyControlLookupKind.Found) {
      expect(lookup.control.id).toBe('passkey-control')
    }
  })

  test('keeps an unowned passkey-only control beside an owned credential form', () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username" />
        <input autocomplete="current-password" type="password" />
        <button type="submit">Sign in</button>
      </form>
      <button type="button">Use a passkey</button>
    `

    const passkeyObservation = summarizeAuthenticationWorkflowForms().find(
      ({ formScope, summary }) =>
        formScope.kind === PasswordFormScopeKind.Unowned &&
        summary.passkeyControlPresent,
    )
    expect(passkeyObservation?.summary).toMatchObject({
      passwordFieldCount: 0,
      passkeyControlPresent: true,
    })
  })
})
