import { afterEach, describe, expect, test } from 'vitest'
import {
  authenticationPageObservationFacts,
  fillLoginCredentials,
  PasswordFormQueryKind,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'

function observedAuthenticationWorkflow() {
  const observation = summarizeAuthenticationWorkflowForms()[0]
  if (!observation) throw new Error('expected an authentication workflow')
  return observation
}

function authenticationFacts() {
  return authenticationPageObservationFacts({
    observation: observedAuthenticationWorkflow(),
    authenticatorSetupHint: false,
    backupCodesHint: false,
  })
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('credential submission observation facts', () => {
  test('binds the selected owned POST submission', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Delete account</button>
        <button type="submit">Sign in</button>
      </form>
    `

    expect(authenticationFacts().credentialSubmission).toMatchObject({
      kind: 'observed',
      facts: {
        method: 'post',
        formIdentity: 'login',
        destinationIdentity: expect.stringContaining('/login'),
      },
    })
  })

  test('binds an actionable implicit owned POST submission', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
    `

    expect(authenticationFacts().credentialSubmission).toMatchObject({
      kind: 'observed',
      facts: {
        actionability: 'actionable',
        method: 'post',
        destinationIdentity: expect.stringContaining('/session'),
      },
    })
  })

  test('binds readonly and effectively disabled password-field transitions', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" readonly />
        <fieldset id="password-fields">
          <input type="password" autocomplete="current-password" />
        </fieldset>
        <button type="submit">Sign in</button>
      </form>
    `

    expect(authenticationFacts().fields).toMatchObject({
      currentPasswordFieldCount: 2,
      actionablePasswordFieldCount: 1,
      readonlyPasswordFieldCount: 1,
    })

    const readonlyOnly =
      document.querySelector<HTMLInputElement>('input[readonly]')
    document
      .querySelector<HTMLFieldSetElement>('#password-fields')
      ?.setAttribute('disabled', '')
    expect(
      fillLoginCredentials({
        credentials: { username: 'vault-user', password: 'vault-password' },
        kind: PasswordFormQueryKind.Root,
        root: document,
      }),
    ).toBe(false)
    expect(readonlyOnly?.value).toBe('')

    expect(authenticationFacts().fields).toMatchObject({
      currentPasswordFieldCount: 1,
      actionablePasswordFieldCount: 0,
      readonlyPasswordFieldCount: 1,
    })
  })
})
