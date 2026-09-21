import { afterEach, describe, expect, test } from 'vitest'
import {
  authentication_advance_control_is_safe,
  looks_like_login_advance_control_label,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  FormSubmissionResult,
  PasswordFormQueryKind,
  passwordFormInteraction as forms,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentPasswordFormSubmission: Parameters<
  typeof forms.submitLoginForm
>[0] = { kind: PasswordFormQueryKind.Root, root: document }

function didSubmit(): boolean {
  const workflow = forms.summarizeAuthenticationWorkflowForms()[0]
  const facts = workflow
    ? forms.authenticationPageObservationFacts({
        observation: workflow,
        authenticatorSetupHint: false,
      })
    : false
  const detailedAdvanceControl = facts ? facts.detailedAdvanceControl : false
  const approvedAdvanceControls =
    detailedAdvanceControl && detailedAdvanceControl.kind === 'observed'
      ? detailedAdvanceControl.observations.filter(
          (control) =>
            authentication_advance_control_is_safe(control) &&
            looks_like_login_advance_control_label(control.label),
        )
      : []
  return (
    forms.submitLoginForm({
      ...wholeDocumentPasswordFormSubmission,
      approvedAdvanceControls,
    }) === FormSubmissionResult.Submitted
  )
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('password form submission method policy', () => {
  test('does not fill when the approved submitter uses formmethod dialog', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
      <button type="submit" form="login" formmethod="dialog">Sign in</button>
    `

    expect(
      forms.fillLoginCredentials({
        credentials: { username: 'vault-user', password: 'vault-pass' },
        kind: PasswordFormQueryKind.Root,
        root: document,
      }),
    ).toBe(false)
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe('')
    expect(didSubmit()).toBe(false)
  })

  test('does not submit GET-default formmethod overrides after filling passwords', () => {
    for (const formmethod of ['get', '', 'invalid', ' post ']) {
      document.body.innerHTML = `
        <form id="login" method="post" action="/auth/login">
          <input autocomplete="username" />
          <input type="password" autocomplete="current-password" />
        </form>
        <button id="unsafe" type="submit" form="login" formmethod="${formmethod}">Sign in</button>
      `
      let submitted = false
      document.querySelector('form')?.addEventListener('submit', (event) => {
        event.preventDefault()
        submitted = true
      })

      expect(
        forms.fillLoginCredentials({
          credentials: { username: 'vault-user', password: 'vault-pass' },
          kind: PasswordFormQueryKind.Root,
          root: document,
        }),
      ).toBe(false)
      expect(
        document.querySelector<HTMLInputElement>('input[type="password"]')
          ?.value,
      ).toBe('')
      expect(didSubmit()).toBe(false)
      expect(submitted).toBe(false)
    }
  })
})
