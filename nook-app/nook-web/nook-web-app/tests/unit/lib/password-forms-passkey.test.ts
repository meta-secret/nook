import { afterEach, describe, expect, test } from 'vitest'
import {
  classify_companion_authentication_workflow_facts,
  CompanionAuthenticationWorkflowMatchKind,
  companion_authentication_workflow_match_kind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authenticationPageObservationFacts,
  findPasskeyControl,
  findWorkflowPasskeyControl,
  pageHasPasskeyControl,
  PasskeyControlLookupKind,
  PasswordFormScopeKind,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'

afterEach(() => document.body.replaceChildren())

describe('passkey control detection', () => {
  test('does not treat password inputs with webauthn autocomplete as passkey controls', () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="section-login username" name="email" type="email" />
        <input autocomplete="section-login current-password webauthn" name="password" type="password" />
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
    document.body.innerHTML = `<button type="button" data-nook-passkey-control>Continue</button>`
    const marked = findPasskeyControl()
    expect(marked.kind).toBe(PasskeyControlLookupKind.Found)
    document.body.innerHTML = `<button type="button">Sign in with a passkey</button>`
    const labeled = findPasskeyControl()
    expect(labeled.kind).toBe(PasskeyControlLookupKind.Found)
    expect(pageHasPasskeyControl()).toBe(true)
  })

  test('enumerates passkey-only candidates until Rust approves a safe control', () => {
    document.body.innerHTML = `
      <section id="account-settings"><button type="button" data-nook-passkey-control>Delete passkey</button></section>
      <section id="login"><button type="button" data-nook-passkey-control>Use passkey</button></section>
    `
    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(2)
    const facts = observations.map((observation) =>
      authenticationPageObservationFacts({
        observation,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }),
    )
    expect(facts[0]?.authenticator.detailedPasskeyControl).toMatchObject({
      observation: { label: expect.stringContaining('Delete passkey') },
    })
    expect(facts[1]?.authenticator.detailedPasskeyControl).toMatchObject({
      observation: { label: expect.stringContaining('Use passkey') },
    })
    const match = classify_companion_authentication_workflow_facts({
      observations: facts,
    })
    expect(companion_authentication_workflow_match_kind(match)).toBe(
      CompanionAuthenticationWorkflowMatchKind.Matched,
    )
    expect(
      'snapshot' in match ? match.snapshot.observationIndex : undefined,
    ).toBe(1)
  })

  test('enumerates passkey candidates owned by a credential form', () => {
    document.body.innerHTML = `
      <form id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
        <button type="button" data-nook-passkey-control>Delete passkey</button>
      </form>
      <button form="login" type="button" data-nook-passkey-control>Use passkey</button>
    `
    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(2)
    const facts = observations.map((observation) => {
      const facts = authenticationPageObservationFacts({
        observation,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      })
      return {
        ...facts,
        authenticator: {
          ...facts.authenticator,
          matchingPasskeyAccountCount: 1,
        },
      }
    })
    expect(facts[0]?.authenticator.detailedPasskeyControl).toMatchObject({
      observation: { label: expect.stringContaining('Delete passkey') },
    })
    expect(facts[1]?.authenticator.detailedPasskeyControl).toMatchObject({
      observation: {
        ownership: 'owned-form',
        label: expect.stringContaining('Use passkey'),
      },
    })
    const match = classify_companion_authentication_workflow_facts({
      observations: facts,
    })
    expect(
      'snapshot' in match ? match.snapshot.observationIndex : undefined,
    ).toBe(1)
    const approved = findWorkflowPasskeyControl(observations[1]!)
    expect(approved.kind).toBe(PasskeyControlLookupKind.Found)
    if (approved.kind === PasskeyControlLookupKind.Found) {
      expect(approved.control.textContent).toContain('Use passkey')
    }
  })

  test('enumerates a passkey-only form beside a credential form', () => {
    document.body.innerHTML = `
      <form id="password-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
      <form id="passkey-login" action="/login/passkey">
        <button type="button" data-nook-passkey-control>Use passkey</button>
      </form>
    `
    const observations = summarizeAuthenticationWorkflowForms()
    const passkeyObservation = observations.find(
      (observation) =>
        observation.passkeyControl?.textContent === 'Use passkey',
    )
    expect(passkeyObservation).toBeDefined()
    expect(
      passkeyObservation?.formScope.kind === PasswordFormScopeKind.Owned
        ? passkeyObservation.formScope.owner.id
        : undefined,
    ).toBe('passkey-login')
    if (!passkeyObservation) return
    const facts = authenticationPageObservationFacts({
      observation: passkeyObservation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      observation: {
        ownership: 'owned-form',
        label: expect.stringContaining('Use passkey'),
      },
    })
  })

  test('keeps an external form-associated passkey control owned', () => {
    document.body.innerHTML = `
      <form id="login" action="/login"></form>
      <button form="login" type="button" data-nook-passkey-control>Use passkey</button>
    `
    const observation = summarizeAuthenticationWorkflowForms()[0]!
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      observation: { ownership: 'owned-form' },
    })
  })

  test('treats an in-form passkey link as locally scoped', () => {
    document.body.innerHTML = `
      <form id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
        <a href="/login" data-nook-passkey-control>Use passkey</a>
      </form>
    `
    const observation = summarizeAuthenticationWorkflowForms()[0]!
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      observation: { ownership: 'locally-scoped' },
    })
  })
})
