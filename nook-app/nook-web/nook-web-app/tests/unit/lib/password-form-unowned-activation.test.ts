import { afterEach, describe, expect, test } from 'vitest'
import {
  authentication_advance_control_is_safe,
  looks_like_login_advance_control_label,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  FormSubmissionResult,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  passwordFormInteraction as forms,
} from '../../../../nook-web-shared/src/extension/password-forms'

afterEach(() => {
  document.body.replaceChildren()
})

describe('unowned localized login activation', () => {
  test.each([
    ['<button aria-label="Anmelden" title="Anmelden">Anmelden</button>', true],
    [
      '<button aria-label="Se connecter" title="Se connecter">Se connecter</button>',
      true,
    ],
    ['<button type="submit">Supprimer le compte</button>', false],
    ['<form method="post" id="f"><button>Entrar</button></form>', false],
  ])('gates form-less localized control %s', (control, expected) => {
    document.body.innerHTML = `
      <div role="form" class="signin-panel">
        <input data-qa="login_email" name="email" type="email" />
        ${control}
      </div>
    `
    const workflow = forms.summarizeAuthenticationWorkflowForms()[0]
    expect(workflow?.formScope.kind).toBe(PasswordFormScopeKind.Unowned)
    if (!workflow) throw new Error('expected localized login workflow')
    const facts = forms.authenticationPageObservationFacts({
      observation: workflow,
      authenticatorSetupHint: false,
    })
    const detailedAdvanceControl = facts.detailedAdvanceControl
    const approvedAdvanceControls =
      detailedAdvanceControl?.kind === 'observed'
        ? detailedAdvanceControl.observations.filter(
            (candidate) =>
              authentication_advance_control_is_safe(candidate) &&
              looks_like_login_advance_control_label(candidate.label),
          )
        : []
    const result = forms.submitLoginForm({
      kind: PasswordFormQueryKind.Scoped,
      root: workflow.root,
      formScope: workflow.formScope,
      approvedAdvanceControls,
    })

    expect(result === FormSubmissionResult.Submitted).toBe(expected)
  })
})
