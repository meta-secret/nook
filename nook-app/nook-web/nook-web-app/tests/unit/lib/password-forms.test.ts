import { afterEach, describe, expect, test } from 'vitest'
import {
  authenticationPageObservationFacts,
  fillLoginCredentials,
  fillOneTimeCode,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentPasswordFormSubmission: Parameters<
  typeof submitLoginForm
>[0] = { kind: PasswordFormQueryKind.Root, root: document }

function observedAuthenticationWorkflow(): PasswordFormObservation {
  const observation = summarizeAuthenticationWorkflowForms()[0]
  if (!observation) throw new Error('expected an authentication workflow')
  return observation
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('website one-time-code fields', () => {
  test('preserves executable OTP handler attribute names at the Rust boundary', () => {
    document.body.innerHTML = `
      <form method="post" id="otp-login" action="/mfa/challenge">
        <input
          autocomplete="one-time-code"
          oninput="this.form.requestSubmit()"
        />
        <button type="submit">Verify code</button>
      </form>
    `

    const observation = observedAuthenticationWorkflow()
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.oneTimeCodeHandlerSignals).toEqual([
      'oninput=this.form.requestSubmit()',
    ])
  })

  test('transports OTP handlers as independent Rust policy candidates', () => {
    document.body.innerHTML = `
      <form method="post" id="otp-login" action="/mfa/challenge">
        <input autocomplete="one-time-code" onchange="validateCode()" />
        <input autocomplete="one-time-code" oninput="this.form.requestSubmit()" />
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.oneTimeCodeHandlerSignals).toEqual([
      'oninput=this.form.requestSubmit()',
      'onchange=validateCode()',
    ])
  })

  test('transports every scoped advance-control candidate for Rust selection', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Delete account</button>
        <button type="submit">Sign in</button>
      </form>
    `

    const observation = observedAuthenticationWorkflow()
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const detailed = facts.detailedAdvanceControl
    if (detailed.kind !== 'observed') {
      throw new Error('expected observed advance-control candidates')
    }
    expect(detailed.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining('Delete account'),
        }),
        expect.objectContaining({
          label: expect.stringContaining('Sign in'),
        }),
      ]),
    )
  })

  test('resolves aria-labelledby control names for Rust classification', () => {
    document.body.innerHTML = `
      <form method="post" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <span id="submit-name">Sign in</span>
        <button type="submit" aria-labelledby="submit-name"></button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ label: expect.stringContaining('Sign in') }],
    })
  })

  test('transports implicit owned-form submission evidence without a control', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toEqual({ kind: 'absent' })
    expect(facts.ceremony.advanceControl).toBe('implicit-submission')
  })

  test('rejects implicit GET password submission before fill', () => {
    document.body.innerHTML = `
      <form method="get" aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input id="secret" type="password" autocomplete="current-password" />
      </form>
    `
    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.advanceControl).toBe('absent')
    expect(facts.ceremony.implicitSubmissionMethod).toBe('get')
    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'vault-user', password: 'vault-pass' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(false)
    expect((document.querySelector('#secret') as HTMLInputElement).value).toBe(
      '',
    )
  })

  test('rejects dialog-method password submission before fill', () => {
    document.body.innerHTML = `
      <form method="dialog" aria-label="Login">
        <input autocomplete="username" />
        <input id="secret" type="password" autocomplete="current-password" />
      </form>
    `
    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.advanceControl).toBe('absent')
    expect(facts.ceremony.implicitSubmissionMethod).toBe('dialog')
    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'vault-user', password: 'vault-pass' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(false)
    expect((document.querySelector('#secret') as HTMLInputElement).value).toBe(
      '',
    )
  })

  test('marks a hidden semantic submitter inert and allows implicit submission', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <div hidden><button type="submit">Continue</button></div>
      </form>
    `
    let submitted = false
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
      submitted = true
    })

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        { actionability: 'inert', label: expect.stringContaining('Continue') },
      ],
    })
    expect(facts.ceremony.advanceControl).toBe('implicit-submission')
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(submitted).toBe(true)
  })

  test('marks a native-inert semantic submitter inert and allows implicit submission', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <div inert><button type="submit">Continue</button></div>
      </form>
    `
    let submitted = false
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
      submitted = true
    })

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        { actionability: 'inert', label: expect.stringContaining('Continue') },
      ],
    })
    expect(facts.ceremony.advanceControl).toBe('implicit-submission')
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(submitted).toBe(true)
  })

  test('rescans actionability when an ancestor becomes native-inert', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <div id="panel"><button type="submit">Continue</button></div>
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
          actionability: 'actionable',
          label: expect.stringContaining('Continue'),
        },
      ],
    })

    document.querySelector('#panel')?.setAttribute('inert', '')
    const after = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(after.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        { actionability: 'inert', label: expect.stringContaining('Continue') },
      ],
    })
  })

  test('rescans actionability when an ancestor becomes aria-disabled', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <div id="panel"><button type="submit">Continue</button></div>
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
          actionability: 'actionable',
          label: expect.stringContaining('Continue'),
        },
      ],
    })

    document.querySelector('#panel')?.setAttribute('aria-disabled', 'true')
    const after = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(after.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        { actionability: 'inert', label: expect.stringContaining('Continue') },
      ],
    })
  })

  test('infers implicit submission when the only semantic submitter is inert', () => {
    document.body.innerHTML = `<form method="post" action="/auth/login"><input autocomplete="username" /><button type="submit" disabled>Sign in</button></form>`
    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ actionability: 'inert' }],
    })
    expect(facts.ceremony.advanceControl).toBe('implicit-submission')
  })

  test('uses image submit alt text as bounded control identity', () => {
    document.body.innerHTML = `<form method="post" id="login" action="/auth/login"><input autocomplete="username" /><input type="image" alt="Sign in" /></form>`
    document
      .querySelector('form')
      ?.addEventListener('submit', (event) => event.preventDefault())
    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ label: expect.stringContaining('Sign in') }],
    })
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
  })

  test('resolves default and relative form destinations before Rust classification', () => {
    window.history.replaceState({}, '', '/account/sign-in')
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="../session">
        <input autocomplete="username" />
        <button type="submit">Continue</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.authenticationContext).toMatchObject({
      formIdentity: expect.stringContaining('Login'),
      destinationIdentity: `${location.origin}/session`,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ destinationIdentity: `${location.origin}/session` }],
    })

    document.querySelector('form')?.removeAttribute('action')
    const defaultDestination = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const defaultAuthenticationContext =
      defaultDestination.ceremony.authenticationContext
    if (!defaultAuthenticationContext) {
      throw new Error('expected default authentication context')
    }
    expect(defaultAuthenticationContext.destinationIdentity).toBe(location.href)
  })

  test('isolates an oversized submitter so a sibling login control can still transport', () => {
    const oversizedLabel = `Sign in ${'x'.repeat(600)}`
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">${oversizedLabel}</button>
        <button type="submit">Continue</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ label: expect.stringContaining('Continue') }],
    })
    const observation = facts.detailedAdvanceControl
    if (!observation || observation.kind !== 'observed') {
      throw new Error('expected observed advance control')
    }
    expect(
      observation.observations.every((candidate) =>
        candidate.label.includes('Continue'),
      ),
    ).toBe(true)
  })

  test('transports a passkey-only destructive form identity instead of the document', () => {
    document.body.innerHTML = `
      <form method="post" id="delete-account" action="/login">
        <button type="button" data-nook-passkey-control>Continue</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      kind: 'candidates',
      observation: [
        {
          kind: 'explicitly-marked',
          observation: {
            ownership: 'owned-form',
            formIdentity: expect.stringContaining('delete-account'),
          },
        },
      ],
    })
  })

  test('submits a classified username-only login whose form action is omitted', () => {
    window.history.replaceState({}, '', '/auth/login')
    document.body.innerHTML = `
      <form method="post" aria-label="Login">
        <input autocomplete="username" />
        <button type="submit">Continue</button>
      </form>
    `
    let submissions = 0
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
      submissions += 1
    })

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ destinationIdentity: location.href }],
    })
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(submissions).toBe(1)
  })

  test('does not fill after username input drops POST and no approved submitter remains', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Delete account</button>
      </form>
    `
    document
      .querySelector('input[autocomplete="username"]')
      ?.addEventListener('input', () => {
        document.querySelector('form')?.removeAttribute('method')
      })
    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'vault-user', password: 'vault-pass' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(false)
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe('')
  })

  test('uses the OTP form destination instead of an auxiliary control destination', () => {
    document.body.innerHTML = `
      <form method="post" id="otp-login" action="/mfa/challenge">
        <input autocomplete="one-time-code" oninput="this.form.requestSubmit()" />
        <button type="button" formaction="/cancel">Cancel</button>
        <button type="submit">Verify code</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const authenticationContext = facts.ceremony.authenticationContext
    if (!authenticationContext) {
      throw new Error('expected OTP authentication context')
    }
    expect(authenticationContext.destinationIdentity).toBe(
      `${location.origin}/mfa/challenge`,
    )
  })

  test('transports externally associated submit controls with owned-form scope', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
      <button form="login" type="submit">Sign in</button>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [
        {
          ownership: 'owned-form',
          semanticSubmitControlCount: 1,
          destinationIdentity: `${location.origin}/login`,
        },
      ],
    })
  })

  test('marks a fieldset-disabled submitter inert and allows implicit submission', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/session">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <fieldset disabled>
          <button type="submit">Continue</button>
        </fieldset>
      </form>
    `
    let submitted = false
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
      submitted = true
    })

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: [{ actionability: 'inert' }],
    })
    expect(facts.ceremony.advanceControl).toBe('implicit-submission')
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(submitted).toBe(true)
  })

  test('transports a form-contained passkey link with owned-form scope', () => {
    document.body.innerHTML = `
      <form method="post" id="passkey-login" action="/login">
        <a href="/webauthn">Use passkey</a>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      kind: 'candidates',
      observation: [
        {
          kind: 'labeled',
          observation: {
            ownership: 'owned-form',
            formIdentity: expect.stringContaining('passkey-login'),
            label: expect.stringContaining('passkey'),
          },
        },
      ],
    })
  })

  test('transports a passkey-only form-associated control for Rust selection', () => {
    document.body.innerHTML = `
      <form method="post" id="passkey-login" action="/login">
        <button type="button">Sign in with a passkey</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      kind: 'candidates',
      observation: [
        {
          kind: 'labeled',
          observation: {
            label: expect.stringContaining('passkey'),
          },
        },
      ],
    })
  })

  test('transports an input passkey control labeled by its value', () => {
    document.body.innerHTML = `
      <form method="post" id="passkey-login" action="/login">
        <input type="button" value="Use passkey" />
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      kind: 'candidates',
      observation: [
        {
          kind: 'labeled',
          observation: { label: expect.stringContaining('Use passkey') },
        },
      ],
    })
  })

  test('transports an icon-only passkey control labeled by aria-label', () => {
    document.body.innerHTML = `
      <form method="post" id="passkey-login" action="/login">
        <button type="button" aria-label="Use passkey"><svg></svg></button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      kind: 'candidates',
      observation: [
        {
          kind: 'labeled',
          observation: { label: expect.stringContaining('Use passkey') },
        },
      ],
    })
  })

  test('keeps standalone explicitly marked passkey controls locally scoped', () => {
    document.body.innerHTML = `
      <button type="button" data-nook-passkey-control>Continue</button>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      kind: 'candidates',
      observation: [
        {
          kind: 'explicitly-marked',
          observation: {
            ownership: 'locally-scoped',
            label: expect.stringContaining('Continue'),
          },
        },
      ],
    })
  })

  test('does not transport a passkey control contained by a sibling form', () => {
    document.body.innerHTML = `
      <div class="login-panel">
        <form method="post" id="password-login" action="/login">
          <input autocomplete="username" />
          <input type="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
        <form method="post" id="passkey-login" action="/webauthn">
          <a href="/webauthn">Use passkey</a>
        </form>
      </div>
    `

    const observation = summarizeAuthenticationWorkflowForms().find(
      (workflow) =>
        workflow.formScope.kind === PasswordFormScopeKind.Owned &&
        workflow.formScope.owner.id === 'password-login',
    )
    if (!observation) {
      throw new Error('expected the password-login workflow')
    }
    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toEqual({
      kind: 'absent',
    })
  })

  test('transports a locally adjacent form-less passkey alternative with a credential form', () => {
    document.body.innerHTML = `
      <div class="login-panel">
        <form method="post" id="login" action="/login">
          <input autocomplete="username" />
          <input type="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
        <button type="button">Sign in with a passkey</button>
      </div>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.authenticator.detailedPasskeyControl).toMatchObject({
      kind: 'candidates',
      observation: [
        {
          kind: 'labeled',
          observation: {
            ownership: 'locally-scoped',
            label: expect.stringContaining('passkey'),
          },
        },
      ],
    })
  })

  test('does not bind a shared-parent passkey to either sibling form', () => {
    document.body.innerHTML = `
      <div class="login-panel">
        <form method="post" id="login" action="/login">
          <input autocomplete="username" />
          <input type="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
        <form method="post" id="signup" action="/signup">
          <input autocomplete="username" />
          <input type="password" autocomplete="new-password" />
          <button type="submit">Create account</button>
        </form>
        <button type="button" data-nook-passkey-control>Enroll passkey</button>
      </div>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const login = observations.find(
      (observation) =>
        observation.formScope.kind === PasswordFormScopeKind.Owned &&
        observation.formScope.owner.id === 'login',
    )
    const signup = observations.find(
      (observation) =>
        observation.formScope.kind === PasswordFormScopeKind.Owned &&
        observation.formScope.owner.id === 'signup',
    )
    if (!login || !signup) {
      throw new Error('expected sibling login and signup workflows')
    }
    expect(
      authenticationPageObservationFacts({
        observation: login,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }).authenticator.detailedPasskeyControl,
    ).toEqual({ kind: 'absent' })
    expect(
      authenticationPageObservationFacts({
        observation: signup,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }).authenticator.detailedPasskeyControl,
    ).toEqual({ kind: 'absent' })
  })

  test('counts only actionable semantic submitters for Rust ambiguity', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Proceed</button>
        <button type="submit" disabled>Cancel</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'observed',
      observations: expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining('Proceed'),
          semanticSubmitControlCount: 1,
        }),
      ]),
    })
  })

  test('does not write the password after username events switch the form to GET', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    document
      .querySelector('input[autocomplete="username"]')
      ?.addEventListener('input', () => {
        document.querySelector('form')?.setAttribute('method', 'get')
      })
    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'vault-user', password: 'vault-pass' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(false)
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe('')
  })

  test('does not fill a GET form when a type-button Sign in sits beside a native submitter', () => {
    document.body.innerHTML = `
      <form id="login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <input type="submit" value="Go" />
        <button type="button">Sign in</button>
      </form>
    `
    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'vault-user', password: 'vault-pass' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(false)
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe('')
  })

  test('does not fill through a POST submitter beside a native GET sibling', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
        <button type="submit" formmethod="get">Search</button>
      </form>
    `
    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'vault-user', password: 'vault-pass' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(false)
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe('')
  })

  test('fills a POST login whose type-button advance control carries leftover GET formmethod', () => {
    document.body.innerHTML = `
      <form method="post" id="login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="button" formmethod="get">Sign in</button>
      </form>
    `
    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: { username: 'vault-user', password: 'vault-pass' },
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(true)
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe('vault-pass')
  })

  test('fills the OTP field that owns the recognized auto-submit handler', () => {
    document.body.innerHTML = `
      <input autocomplete="one-time-code" />
      <input
        id="otp-code"
        autocomplete="one-time-code"
        oninput="this.form.requestSubmit()"
      />
    `
    const first = document.querySelector<HTMLInputElement>(
      'input[autocomplete="one-time-code"]',
    )
    const field = document.querySelector<HTMLInputElement>('#otp-code')
    const oneTimeCodeFillArgs: Parameters<typeof fillOneTimeCode>[0] = {
      code: '123456',
      kind: PasswordFormQueryKind.Root,
      root: document,
    }
    expect(fillOneTimeCode(oneTimeCodeFillArgs)).toBe(true)
    expect(first?.value).toBe('')
    expect(field?.value).toBe('123456')
  })
})
