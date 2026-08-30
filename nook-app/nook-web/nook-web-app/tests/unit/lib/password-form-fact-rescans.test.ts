import { afterEach, describe, expect, test } from 'vitest'
import {
  authenticationFactAttributeFilter,
  authenticationFactObserverOptions,
} from '../../../../nook-web-shared/src/extension/authentication-fact-attributes'
import {
  authenticationPageObservationFacts,
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

describe('authentication fact rescans', () => {
  test('watches remaining fact-bearing identities used by observation facts', () => {
    expect(authenticationFactAttributeFilter).toEqual(
      expect.arrayContaining([
        'alt',
        'data-qa',
        'data-testid',
        'data-nook-manual-checkpoint',
        'for',
        'formmethod',
        'inert',
        'method',
        'onchange',
        'oninput',
        'open',
        'placeholder',
        'readonly',
        'role',
        'src',
        'title',
        'value',
      ]),
    )
    expect(authenticationFactObserverOptions.characterData).toBe(true)
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/login" role="form">
        <input autocomplete="username" />
        <input type="submit" value="Delete" title="Remove account" />
      </form>
    `
    const before = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(before.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        {
          label: expect.stringContaining('Delete'),
          formIdentity: expect.stringContaining('Login'),
        },
      ],
    })

    const submitter = document.querySelector('input[type="submit"]')
    submitter?.setAttribute('value', 'Sign in')
    submitter?.setAttribute('title', 'Sign in')
    document.querySelector('form')?.setAttribute('role', 'search')

    const after = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(after.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        {
          label: expect.stringContaining('Sign in'),
          formIdentity: expect.stringContaining('Login'),
        },
      ],
    })
  })

  test('rescans after label for, iframe src, or checkpoint attributes change', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/auth/login">
        <label id="email-label">Email</label>
        <input id="user" type="text" />
        <input type="password" autocomplete="current-password" />
        <iframe id="gate" title="Verification"></iframe>
        <button type="submit">Sign in</button>
      </form>
    `
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(0)
    expect(
      observedAuthenticationWorkflow().summary.manualCheckpointPresent,
    ).toBe(false)
    document.querySelector('#email-label')?.setAttribute('for', 'user')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
    document
      .querySelector('#gate')
      ?.setAttribute('src', 'https://hcaptcha.test')
    expect(
      observedAuthenticationWorkflow().summary.manualCheckpointPresent,
    ).toBe(true)
    document.querySelector('#gate')?.removeAttribute('src')
    expect(
      observedAuthenticationWorkflow().summary.manualCheckpointPresent,
    ).toBe(false)
    document
      .querySelector('#gate')
      ?.setAttribute('data-nook-manual-checkpoint', '')
    expect(
      observedAuthenticationWorkflow().summary.manualCheckpointPresent,
    ).toBe(true)
  })

  test('rescans a readonly username field after it becomes editable', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/auth/login">
        <input autocomplete="username" readonly />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(0)
    document
      .querySelector('input[autocomplete="username"]')
      ?.removeAttribute('readonly')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
  })

  test('rescans a text field after data-testid or placeholder identify it', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/auth/login">
        <input id="user" type="text" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(0)
    const field = document.querySelector('#user')
    if (!field) {
      throw new Error('expected the unclassified username field')
    }
    field.setAttribute('placeholder', 'Email or username')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
    field.removeAttribute('placeholder')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(0)
    field.setAttribute('data-testid', 'username')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
    field.removeAttribute('data-testid')
    field.setAttribute('data-qa', 'login_email')
    expect(observedAuthenticationWorkflow().summary.usernameFieldCount).toBe(1)
  })

  test('rescans OTP handler facts when oninput or onchange mutate', () => {
    document.body.innerHTML = `
      <form method="post" id="otp-login" action="/mfa/challenge">
        <input autocomplete="one-time-code" />
        <button type="submit">Verify code</button>
      </form>
    `
    const field = document.querySelector('input')
    if (!field) {
      throw new Error('expected OTP field')
    }

    const before = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(before.ceremony.oneTimeCodeHandlerSignals).toEqual([])

    field.setAttribute('oninput', 'this.form.requestSubmit()')
    field.setAttribute('onchange', 'validateCode()')
    const afterAdd = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(afterAdd.ceremony.oneTimeCodeHandlerSignals).toEqual([
      'oninput=this.form.requestSubmit()',
      'onchange=validateCode()',
    ])

    field.removeAttribute('oninput')
    field.removeAttribute('onchange')
    const afterRemove = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(afterRemove.ceremony.oneTimeCodeHandlerSignals).toEqual([])
  })

  test('rescans submission method when a form method attribute changes', () => {
    document.body.innerHTML = `
      <form id="login" method="get" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const before = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const beforeControl = before.detailedAdvanceControl
    expect(beforeControl ? beforeControl.kind : 'absent').toBe('absent')
    document.querySelector('form')?.setAttribute('method', 'post')
    const after = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(after.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ submissionMethod: 'post' }],
    })
  })

  test('rescans a closed dialog after it opens', () => {
    document.body.innerHTML = `
      <dialog>
        <form method="post" action="/auth/login">
          <input autocomplete="username" />
          <input type="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
      </dialog>
    `
    expect(summarizeAuthenticationWorkflowForms()).toHaveLength(0)
    document.querySelector('dialog')?.setAttribute('open', '')
    expect(
      summarizeAuthenticationWorkflowForms()[0]?.summary.passwordFieldCount,
    ).toBe(1)
  })
})
