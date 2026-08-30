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

function ownedFormId(observation: PasswordFormObservation): string {
  return observation.formScope.kind === PasswordFormScopeKind.Owned
    ? observation.formScope.owner.id
    : ''
}

function observedAuthenticationWorkflow(): PasswordFormObservation {
  const observation = summarizeAuthenticationWorkflowForms()[0]
  if (!observation) throw new Error('expected an authentication workflow')
  return observation
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('authentication workflow ranking', () => {
  test('gives a sibling passkey-only form its own observation', () => {
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
        `<form method="post" id="password-${index}" action="/login"><input autocomplete="username" /><input type="password" autocomplete="current-password" /><button type="submit">Sign in</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${passwordForms}
      <form method="post" id="passkey-login" action="/login">
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

  test('caps oversized field-bearing pages before facts ranking', () => {
    document.body.innerHTML = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS * 2 },
      (_, index) =>
        `<form method="post" id="password-${index}" action="/login"><input autocomplete="username" /><input type="password" autocomplete="current-password" /><button type="submit">Sign in</button></form>`,
    ).join('')

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'password-0',
      ),
    ).toBe(true)
  })

  test('keeps a passkey-only form when the only password field is a hidden decoy', () => {
    document.body.innerHTML = `
      <form method="post" id="passkey-login" action="/login">
        <input type="password" hidden autocomplete="current-password" />
        <button type="button">Sign in with a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'passkey-login',
      ),
    ).toBe(true)
    expect(
      observations.find(
        (observation) => ownedFormId(observation) === 'passkey-login',
      )?.summary.passwordFieldCount,
    ).toBe(0)
  })

  test('keeps a password login when Rust-safe passkey-only forms fill the bound', () => {
    const passkeyForms = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="passkey-${index}" action="/login"><button type="button">Sign in with a passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${passkeyForms}
      <form method="post" id="password-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'password-login',
      ),
    ).toBe(true)
  })

  test('ranks a real passkey login ahead of new-password scopes at the bound', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="enroll-${index}" action="/auth/passkey"><input autocomplete="username" /><input type="password" autocomplete="new-password" /><button type="button">Use passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="passkey-login" action="/login">
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

  test('keeps a password login when unsafe Use passkey forms fill the shortlist', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS * 2 },
      (_, index) =>
        `<form method="post" id="enroll-${index}" action="/login"><input autocomplete="username" /><input type="password" autocomplete="current-password" /><button type="button" class="delete-account">Use passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="password-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'password-login',
      ),
    ).toBe(true)
  })

  test('ranks a Rust-safe passkey login ahead of enrollment candidates at the bound', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="enroll-${index}" action="/login"><button type="button">${
          index % 2 === 0 ? 'Add passkey' : 'Manage passkeys'
        }</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="passkey-login" action="/login">
        <button type="button">Sign in with a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    const ownedFormIds = observations.map(ownedFormId)
    expect(ownedFormIds).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(ownedFormIds).toContain('passkey-login')
  })

  test('keeps a Rust-safe Sign in control when destructive submitters fill the bound', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT },
      (_, index) =>
        `<button type="submit" name="aux-${index}">Delete account</button>`,
    ).join('')
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/auth/login">
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
        `<form method="post" id="template-${index}" action="/login" hidden><button type="button">Use passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${hiddenTemplates}
      <form method="post" id="passkey-login" action="/login">
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
      <form method="post" aria-label="Login" action="/login">
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
      <form method="post" id="login" aria-label="Login" action="/auth/login">
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

  test('rejects a previously approved workflow after password field semantics change', () => {
    document.body.innerHTML = `
      <form method="post" id="login" aria-label="Login" action="/auth/login">
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
      .querySelector('input[type="password"]')
      ?.setAttribute('autocomplete', 'new-password')
    expect(liveApprovedAuthenticationWorkflow(liveRequest)).toBe(false)
  })

  test('preserves enriched passkey matches during live approval checks', () => {
    document.body.innerHTML = `
      <form method="post" id="login" aria-label="Login" action="/auth/login">
        <button type="button">Use passkey</button>
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
    const classified =
      classifiedAuthenticationWorkflowObservations(approvedRequest)[0]
    if (!classified) throw new Error('expected an approved passkey workflow')
    const approved = {
      ...classified,
      facts: {
        ...classified.facts,
        authenticator: {
          ...classified.facts.authenticator,
          matchingPasskeyAccountCount: 1,
        },
      },
    }
    const liveRequest: Parameters<
      typeof liveApprovedAuthenticationWorkflow
    >[0] = {
      approved,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }
    expect(liveApprovedAuthenticationWorkflow(liveRequest)).toBe(true)
  })

  test('keeps a password login when OTP forms with vetoed submitters fill the bound', () => {
    const otpForms = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="otp-${index}" action="/otp"><input autocomplete="one-time-code" inputmode="numeric" /><button type="submit">Delete account</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${otpForms}
      <form method="post" id="password-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'password-login',
      ),
    ).toBe(true)
  })

  test('keeps a later form-less Sign in after inert unowned password decoys fill the shortlist', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS * 2 },
      (_, index) => {
        const control =
          index % 3 === 0
            ? '<button type="button" disabled>Continue</button>'
            : index % 3 === 1
              ? '<button type="button" hidden>Next</button>'
              : '<button type="button">Delete account</button>'
        return `<div id="decoy-${index}"><input type="password" autocomplete="current-password" />${control}</div>`
      },
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <div id="login-panel">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="button">Sign in</button>
      </div>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) =>
          observation.root instanceof Element &&
          observation.root.id === 'login-panel',
      ),
    ).toBe(true)
  })

  test('keeps a later form-less Sign in after twenty unowned password decoys', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<div id="decoy-${index}"><input type="password" autocomplete="current-password" /></div>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <div id="login-panel">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="button">Sign in</button>
      </div>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) =>
          observation.root instanceof Element &&
          observation.root.id === 'login-panel',
      ),
    ).toBe(true)
  })

  test('keeps a later username passkey login after twenty empty-summary scopes', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="manage-${index}" action="/passkeys"><button type="button">Add passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="username-passkey" action="/session">
        <input autocomplete="username" />
        <button type="button">Use passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'username-passkey',
      ),
    ).toBe(true)
  })

  test('keeps a later OTP passkey challenge after twenty safe passkey logins', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="passkey-${index}" action="/login"><button type="button">Sign in with a passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="otp-passkey" action="/verify">
        <input autocomplete="one-time-code" inputmode="numeric" />
        <button type="button">Use passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'otp-passkey',
      ),
    ).toBe(true)
  })

  test('keeps a later OTP passkey after twenty safe passkey logins', () => {
    const logins = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="passkey-${index}" action="/login"><button type="button">Sign in with a passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${logins}
      <form method="post" id="otp-passkey" action="/verify">
        <input autocomplete="one-time-code" inputmode="numeric" />
        <button type="button">Use passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'otp-passkey',
      ),
    ).toBe(true)
  })

  test('keeps an OTP passkey login after empty-summary scopes fill the bound', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="manage-${index}" action="/passkeys"><button type="button">Add passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="otp-passkey" action="/verify">
        <input autocomplete="one-time-code" inputmode="numeric" />
        <button type="button">Use passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'otp-passkey',
      ),
    ).toBe(true)
  })

  test('keeps a later safe passkey login after twenty unsafe passkey scopes', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="manage-${index}" action="/passkeys"><button type="button">Add passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="passkey-login" action="/login">
        <button type="button">Sign in with a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'passkey-login',
      ),
    ).toBe(true)
  })

  test('keeps a progressing username-only login after non-progressing password decoys', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="get" id="password-${index}" action="/search"><input type="password" autocomplete="current-password" /></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="username-login" action="/login">
        <input autocomplete="username" />
        <button type="submit">Sign in</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'username-login',
      ),
    ).toBe(true)
  })

  test('keeps a GET form whose approved submitter posts after non-progressing decoys fill the bound', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS * 2 },
      (_, index) =>
        `<form method="get" id="search-${index}" action="/search"><input type="password" autocomplete="current-password" /></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form id="password-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit" formmethod="post">Sign in</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'password-login',
      ),
    ).toBe(true)
  })

  test('keeps a login whose Sign in submitter is associated from outside the form', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS * 2 },
      (_, index) =>
        `<form method="get" id="search-${index}" action="/search"><input type="password" autocomplete="current-password" /></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
      <button type="submit" form="login">Sign in</button>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some((observation) => ownedFormId(observation) === 'login'),
    ).toBe(true)
  })

  test('summarizes a bounded passkey-only candidate set before ranking', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS + 8 },
      (_, index) =>
        `<form method="post" id="manage-${index}" action="/passkeys"><button type="button">Add passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="passkey-login" action="/login">
        <button type="button">Sign in with a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'passkey-login',
      ),
    ).toBe(true)
  })

  test('does not treat an external new-password field as a passkey-only scope', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS + 8 },
      (_, index) =>
        `<form method="post" id="enroll-${index}" action="/auth/passkey"></form>
         <input type="password" autocomplete="new-password" form="enroll-${index}" />
         <button type="button" form="enroll-${index}">Use passkey</button>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="passkey-login" action="/login">
        <button type="button">Sign in with a passkey</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'passkey-login',
      ),
    ).toBe(true)
  })

  test('keeps a middle password login when non-progressing forms surround the ranking cap', () => {
    const leading = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="otp-${index}" action="/otp"><input autocomplete="one-time-code" inputmode="numeric" /></form>`,
    ).join('')
    document.body.innerHTML = `
      ${leading}
      <form method="post" id="password-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
      <form method="post" id="otp-trailing" action="/otp"><input autocomplete="one-time-code" inputmode="numeric" /></form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations.length).toBeLessThanOrEqual(
      MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
    )
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'password-login',
      ),
    ).toBe(true)
  })

  test('keeps a password login when unsafe Add passkey forms fill the shortlist', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS * 2 },
      (_, index) =>
        `<form method="post" id="enroll-${index}" action="/login"><input autocomplete="username" /><input type="password" autocomplete="current-password" /><button type="button">Add passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="password-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'password-login',
      ),
    ).toBe(true)
  })

  test('keeps a Rust-classifiable login when vetoed password forms fill the shortlist', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS * 2 },
      (_, index) =>
        `<form method="post" id="delete-${index}" action="/account/delete"><input autocomplete="username" /><input type="password" autocomplete="current-password" /><button type="submit">Delete account</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="password-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'password-login',
      ),
    ).toBe(true)
  })

  test('keeps a safe login when destructive Sign in forms fill the shortlist', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS * 2 },
      (_, index) =>
        `<form method="post" id="delete-${index}" action="/account/delete"><input autocomplete="username" /><input type="password" autocomplete="current-password" /><button id="delete-account-${index}" type="submit">Sign in</button></form>`,
    ).join('')
    document.body.innerHTML = `
      ${decoys}
      <form method="post" id="password-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'password-login',
      ),
    ).toBe(true)
  })

  test('keeps a progressing password login when non-progressing OTP forms fill the bound', () => {
    const otpForms = Array.from(
      { length: MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS },
      (_, index) =>
        `<form method="post" id="otp-${index}" action="/otp"><input autocomplete="one-time-code" inputmode="numeric" /></form>`,
    ).join('')
    document.body.innerHTML = `
      ${otpForms}
      <form method="post" id="password-login" action="/login">
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `

    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
    expect(
      observations.some(
        (observation) => ownedFormId(observation) === 'password-login',
      ),
    ).toBe(true)
  })
})
