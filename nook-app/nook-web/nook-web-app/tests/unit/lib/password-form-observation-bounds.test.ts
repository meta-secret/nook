import { afterEach, describe, expect, test } from 'vitest'
import {
  classifiedAuthenticationWorkflowObservations,
  liveApprovedAuthenticationWorkflow,
} from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import {
  MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
  MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
} from '../../../../nook-web-shared/src/extension/password-form-submission-controls'
import {
  authenticationPageObservationFacts,
  fillLoginCredentials,
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

function ownedFormId(observation: PasswordFormObservation): string {
  return observation.formScope.kind === PasswordFormScopeKind.Owned
    ? observation.formScope.owner.id
    : ''
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('authentication observation bounds', () => {
  test('does not strip destructive query evidence from an oversized destination', () => {
    const query = `action=delete-account&state=${'a'.repeat(600)}`
    document.body.innerHTML = `
      <form aria-label="Login" action="/login?${query}">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Continue</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'absent',
    })
    expect(facts.ceremony.authenticationContext?.destinationIdentity).toBe('')
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
  })

  test('isolates a candidate whose raw form identity exceeds the bound', () => {
    document.body.innerHTML = `
      <form
        id="${'n'.repeat(500)}"
        class="delete-account"
        aria-label="Login"
        action="/login"
      >
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Continue</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const formIdentity = facts.ceremony.authenticationContext?.formIdentity
    if (!formIdentity) {
      throw new Error('expected form identity')
    }
    expect(formIdentity).toContain('delete-account')
    expect(new TextEncoder().encode(formIdentity).length).toBeGreaterThan(512)
    expect(facts.detailedAdvanceControl).toMatchObject({ kind: 'absent' })
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
  })

  test('isolates a control whose machine identity would lose a destructive suffix', () => {
    document.body.innerHTML = `
      <form aria-label="Login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button
          id="${'n'.repeat(500)}"
          name="action"
          value="delete-account"
          type="submit"
        >Sign in</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl).toMatchObject({
      kind: 'absent',
    })
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(false)
  })

  test('keeps a login submitter when a shared form has too many candidates', () => {
    const navButtons = Array.from(
      { length: MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT },
      (_, index) => `<button type="submit">Nav ${index}</button>`,
    ).join('')
    document.body.innerHTML = `
      <form aria-label="Login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        ${navButtons}
        <button type="submit">Sign in</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.detailedAdvanceControl.kind).toBe('observed')
    if (facts.detailedAdvanceControl.kind !== 'observed') {
      throw new Error('expected observed advance controls')
    }
    expect(facts.detailedAdvanceControl.observations).toHaveLength(
      MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    )
    expect(
      facts.detailedAdvanceControl.observations.some((candidate) =>
        candidate.label.includes('Sign in'),
      ),
    ).toBe(true)
    expect(
      facts.detailedAdvanceControl.observations.every(
        (candidate) =>
          candidate.semanticSubmitControlCount <=
          MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
      ),
    ).toBe(true)
  })

  test('bounds OTP handler candidates before transport', () => {
    const fields = Array.from(
      { length: 51 },
      () =>
        '<input autocomplete="one-time-code" oninput="this.form.requestSubmit()" onchange="validateCode()" />',
    ).join('')
    document.body.innerHTML = `
      <form id="otp-login" action="/mfa/challenge">
        ${fields}
        <button type="submit">Verify code</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.oneTimeCodeHandlerSignals.length).toBe(
      MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    )
    expect(
      facts.ceremony.oneTimeCodeHandlerSignals.some((signal) =>
        signal.includes('requestSubmit'),
      ),
    ).toBe(true)
  })

  test('uses the current page destination for form-less OTP auto-submit', () => {
    window.history.replaceState({}, '', '/login/verify')
    document.body.innerHTML = `
      <input
        autocomplete="one-time-code"
        oninput="this.form.requestSubmit()"
      />
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.ceremony.oneTimeCodeHandlerSignals).toEqual([
      'oninput=this.form.requestSubmit()',
    ])
    expect(facts.ceremony.authenticationContext?.destinationIdentity).toBe(
      location.href,
    )
  })

  test('indexes classified facts against the same filtered workflow forms', () => {
    document.body.innerHTML = `
      <form
        id="${'n'.repeat(500)}"
        class="delete-account"
        aria-label="Login"
        action="/login"
      >
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Continue</button>
      </form>
      <form id="safe-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const classifiedRequest: Parameters<
      typeof classifiedAuthenticationWorkflowObservations
    >[0] = {
      workflowForms: summarizeAuthenticationWorkflowForms(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }
    const classified =
      classifiedAuthenticationWorkflowObservations(classifiedRequest)
    const selected = classified[0]
    if (!selected) {
      throw new Error('expected the transportable login workflow')
    }
    expect(classified).toHaveLength(1)
    expect(ownedFormId(selected.observation)).toBe('safe-login')
  })

  test('bounds passkey-only observations to the portable workflow batch', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form id="decoy-${index}" action="/login"><button type="button">Use passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      <form id="passkey-login" action="/login">
        <button type="button">Sign in with a passkey</button>
      </form>
      ${decoys}
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'passkey-login',
      ),
    ).toBe(true)
  })

  test('isolates a scope whose classified field count exceeds the bound', () => {
    const extraUsernames = Array.from(
      { length: MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT },
      (_, index) => `<input autocomplete="username" name="extra-${index}" />`,
    ).join('')
    document.body.innerHTML = `
      <form id="overflow-login" action="/login">
        <input autocomplete="username" />
        ${extraUsernames}
        <input type="password" autocomplete="current-password" />
        <button type="submit">Continue</button>
      </form>
      <form id="safe-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const classifiedRequest: Parameters<
      typeof classifiedAuthenticationWorkflowObservations
    >[0] = {
      workflowForms: summarizeAuthenticationWorkflowForms(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }
    const classified =
      classifiedAuthenticationWorkflowObservations(classifiedRequest)
    const selected = classified[0]
    if (!selected) {
      throw new Error('expected the transportable login workflow')
    }
    expect(classified).toHaveLength(1)
    expect(ownedFormId(selected.observation)).toBe('safe-login')
  })

  test('isolates a scope whose combined password count exceeds the bound', () => {
    const currentPasswords = Array.from(
      { length: 50 },
      (_, index) =>
        `<input type="password" autocomplete="current-password" name="current-${index}" />`,
    ).join('')
    const genericPasswords = Array.from(
      { length: 51 },
      (_, index) => `<input type="password" name="generic-${index}" />`,
    ).join('')
    document.body.innerHTML = `
      <form id="overflow-login" action="/login">
        <input autocomplete="username" />
        ${currentPasswords}
        ${genericPasswords}
        <button type="submit">Continue</button>
      </form>
      <form id="safe-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const classifiedRequest: Parameters<
      typeof classifiedAuthenticationWorkflowObservations
    >[0] = {
      workflowForms: summarizeAuthenticationWorkflowForms(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }
    const classified =
      classifiedAuthenticationWorkflowObservations(classifiedRequest)
    const selected = classified[0]
    if (!selected) {
      throw new Error('expected the transportable login workflow')
    }
    expect(classified).toHaveLength(1)
    expect(ownedFormId(selected.observation)).toBe('safe-login')
  })

  test('gives a sibling passkey-only form its own observation', () => {
    document.body.innerHTML = `
      <div class="login-panel">
        <form id="password-login" action="/login">
          <input autocomplete="username" />
          <input type="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
        <form id="passkey-login" action="/webauthn">
          <a href="/webauthn">Use passkey</a>
        </form>
      </div>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const password = observations.find(
      (observation) => ownedFormId(observation) === 'password-login',
    )
    const passkey = observations.find(
      (observation) => ownedFormId(observation) === 'passkey-login',
    )
    if (!password || !passkey) {
      throw new Error('expected independent password and passkey workflows')
    }
    expect(
      authenticationPageObservationFacts({
        observation: password,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }).authenticator.detailedPasskeyControl,
    ).toEqual({ kind: 'absent' })
    expect(
      authenticationPageObservationFacts({
        observation: passkey,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }).authenticator.detailedPasskeyControl,
    ).toMatchObject({
      kind: 'candidates',
      observation: [
        {
          kind: 'labeled',
          observation: {
            ownership: 'owned-form',
            label: expect.stringContaining('passkey'),
          },
        },
      ],
    })
  })

  test('keeps an actionable passkey sibling when field-bearing forms fill the bound', () => {
    const passwordForms = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form id="password-${index}" action="/login"><input autocomplete="username" /><input type="password" autocomplete="current-password" /><button type="submit">Sign in</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${passwordForms}
      <form id="passkey-login" action="/login">
        <button type="button">Sign in with a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'passkey-login',
      ),
    ).toBe(true)
  })

  test('ranks a Rust-safe passkey login ahead of enrollment candidates at the bound', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form id="enroll-${index}" action="/login"><button type="button">${
          index % 2 === 0 ? 'Add passkey' : 'Manage passkeys'
        }</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form id="passkey-login" action="/login">
        <button type="button">Sign in with a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'passkey-login',
      ),
    ).toBe(true)
  })

  test('keeps a Rust-safe Sign in control when destructive submitters fill the bound', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT },
      (_, index) =>
        `<button type="submit" name="aux-${index}">Delete account</button>`,
    ).join('')
    document.body.innerHTML = `
      <form aria-label="Login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        ${decoys}
        <button id="sign-in" type="submit">Sign in</button>
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
          label: expect.stringContaining('Sign in'),
        }),
      ]),
    })
    let activated = ''
    document.querySelector('#sign-in')?.addEventListener('click', () => {
      activated = 'sign-in'
    })
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
    })
    expect(submitLoginForm(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(activated).toBe('sign-in')
  })

  test('keeps an actionable passkey login after hidden template forms fill the bound', () => {
    const hiddenTemplates = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form id="template-${index}" action="/login" hidden><button type="button">Use passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${hiddenTemplates}
      <form id="passkey-login" action="/login">
        <button type="button">Sign in with a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'passkey-login',
      ),
    ).toBe(true)
  })

  test('keeps a Rust-safe passkey candidate when enrollment controls fill the bound', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT },
      (_, index) =>
        `<button type="button">${index % 2 === 0 ? 'Add passkey' : 'Manage passkeys'}</button>`,
    ).join('')
    document.body.innerHTML = `
      <form aria-label="Login" action="/login">
        ${decoys}
        <button id="passkey-login" type="button">Sign in with a passkey</button>
      </form>
    `

    expect(
      authenticationPageObservationFacts({
        observation: observedAuthenticationWorkflow(),
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }).authenticator.detailedPasskeyControl,
    ).toMatchObject({
      kind: 'candidates',
      observation: expect.arrayContaining([
        expect.objectContaining({
          observation: expect.objectContaining({
            label: expect.stringContaining('Sign in with a passkey'),
          }),
        }),
      ]),
    })
  })

  test('keeps a form-less passkey observation inside its local container', () => {
    document.body.innerHTML = `
      <div class="signin-panel">
        <input autocomplete="username" />
      </div>
      <div class="password-panel">
        <input type="password" autocomplete="current-password" />
      </div>
      <div class="passkey-panel">
        <button type="button">Sign in with a passkey</button>
      </div>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(
      observations.some((observation) => observation.root === document),
    ).toBe(false)
    const passkey = observations.find(
      (observation) =>
        observation.formScope.kind === PasswordFormScopeKind.Unowned &&
        observation.root instanceof HTMLElement &&
        observation.root.classList.contains('passkey-panel'),
    )
    if (!passkey) {
      throw new Error('expected a locally scoped passkey observation')
    }
    expect(passkey.summary.usernameFieldCount).toBe(0)
    expect(passkey.summary.passwordFieldCount).toBe(0)
    expect(
      observations.some(
        (observation) =>
          observation.summary.usernameFieldCount > 0 &&
          observation.summary.passwordFieldCount > 0,
      ),
    ).toBe(false)

    const username = document.querySelector<HTMLInputElement>(
      '.signin-panel input',
    )
    const password = document.querySelector<HTMLInputElement>(
      '.password-panel input',
    )
    if (!username || !password) {
      throw new Error('expected separate username and password fields')
    }
    const fillArgs: Parameters<typeof fillLoginCredentials>[0] = {
      credentials: {
        username: 'user@example.test',
        password: 'secret',
      },
      kind: PasswordFormQueryKind.Scoped,
      root: passkey.root,
      formScope: passkey.formScope,
    }
    expect(fillLoginCredentials(fillArgs)).toBe(false)
    expect(username.value).toBe('')
    expect(password.value).toBe('')
  })

  test('keeps a direct-body form-less passkey observable', () => {
    document.body.replaceChildren()
    const passkey = document.createElement('button')
    passkey.type = 'button'
    passkey.textContent = 'Sign in with a passkey'
    document.body.append(passkey)

    const observations = summarizeAuthenticationWorkflowForms()
    const selected = observations[0]
    if (!selected) {
      throw new Error('expected a direct-body passkey workflow')
    }
    expect(selected.summary.passkeyControlPresent).toBe(true)
    expect(
      authenticationPageObservationFacts({
        observation: selected,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }).authenticator.detailedPasskeyControl,
    ).toMatchObject({
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

  test('rejects a previously approved workflow after its destination turns destructive', () => {
    document.body.innerHTML = `
      <form id="login" aria-label="Login" action="/auth/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
    const workflow = observedAuthenticationWorkflow()
    const approvedRequest: Parameters<
      typeof classifiedAuthenticationWorkflowObservations
    >[0] = {
      workflowForms: [workflow],
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }
    const approved =
      classifiedAuthenticationWorkflowObservations(approvedRequest)[0]
    if (!approved) {
      throw new Error('expected an approved login workflow')
    }
    const liveRequest: Parameters<
      typeof liveApprovedAuthenticationWorkflow
    >[0] = {
      approved,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }
    expect(liveApprovedAuthenticationWorkflow(liveRequest)).toBe(true)
    document
      .querySelector('form')
      ?.setAttribute('action', '/settings/delete-account')
    expect(liveApprovedAuthenticationWorkflow(liveRequest)).toBe(false)
  })
})
