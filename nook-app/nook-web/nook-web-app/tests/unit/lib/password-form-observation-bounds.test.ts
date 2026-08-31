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
  FormSubmissionResult,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'

const wholeDocumentPasswordFormSubmission: Parameters<
  typeof submitLoginForm
>[0] = { kind: PasswordFormQueryKind.Root, root: document }

function didSubmit(request: Parameters<typeof submitLoginForm>[0]): boolean {
  return submitLoginForm(request) === FormSubmissionResult.Submitted
}

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

function detailedAdvance(
  facts: ReturnType<typeof authenticationPageObservationFacts>,
) {
  const detailed = facts.detailedAdvanceControl
  return detailed ? detailed : { kind: 'absent' as const }
}

function handlerSignals(
  facts: ReturnType<typeof authenticationPageObservationFacts>,
) {
  const signals = facts.ceremony.oneTimeCodeHandlerSignals
  return signals ? signals : []
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('authentication observation bounds', () => {
  test('does not strip destructive query evidence from an oversized destination', () => {
    const query = `action=delete-account&state=${'a'.repeat(600)}`
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/login?${query}">
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
    expect(didSubmit(wholeDocumentPasswordFormSubmission)).toBe(false)
  })

  test('isolates a candidate whose raw form identity exceeds the bound', () => {
    document.body.innerHTML = `
      <form method="post"
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
    expect(didSubmit(wholeDocumentPasswordFormSubmission)).toBe(false)
  })

  test('isolates a control whose machine identity would lose a destructive suffix', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/login">
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
    expect(didSubmit(wholeDocumentPasswordFormSubmission)).toBe(false)
  })

  test('keeps a login submitter when a shared form has too many candidates', () => {
    const navButtons = Array.from(
      { length: MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT },
      (_, index) => `<button type="submit">Nav ${index}</button>`,
    ).join('')
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/login">
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
    const advance = detailedAdvance(facts)
    if (advance.kind !== 'observed') {
      throw new Error('expected observed advance controls')
    }
    expect(advance.observations).toHaveLength(
      MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    )
    expect(
      advance.observations.some((candidate) =>
        candidate.label.includes('Sign in'),
      ),
    ).toBe(true)
    expect(
      advance.observations.every(
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
      <form method="post" id="otp-login" action="/mfa/challenge">
        ${fields}
        <button type="submit">Verify code</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(handlerSignals(facts).length).toBe(
      MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
    )
    expect(
      handlerSignals(facts).some((signal) => signal.includes('requestSubmit')),
    ).toBe(true)
  })

  test('prefers Rust-valid OTP submit handlers when decoy requestSubmit strings fill the bound', () => {
    const decoys = Array.from(
      { length: MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT },
      () =>
        '<input autocomplete="one-time-code" oninput="validate_requestSubmit()" />',
    ).join('')
    document.body.innerHTML = `
      <form method="post" id="otp-login" action="/mfa/challenge">
        ${decoys}
        <input autocomplete="one-time-code" oninput="this.form.submit()" />
        <button type="submit">Verify code</button>
      </form>
    `

    const facts = authenticationPageObservationFacts({
      observation: observedAuthenticationWorkflow(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(handlerSignals(facts)[0]).toBe('oninput=this.form.submit()')
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
      <form method="post"
        id="${'n'.repeat(500)}"
        class="delete-account"
        aria-label="Login"
        action="/login"
      >
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
        <button type="submit">Continue</button>
      </form>
      <form method="post" id="safe-login" action="/login">
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
        `<form method="post" id="decoy-${index}" action="/login"><button type="button">Use passkey</button></form>`,
    ).join('')
    document.body.innerHTML = `
      <form method="post" id="passkey-login" action="/login">
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
      <form method="post" id="overflow-login" action="/login">
        <input autocomplete="username" />
        ${extraUsernames}
        <input type="password" autocomplete="current-password" />
        <button type="submit">Continue</button>
      </form>
      <form method="post" id="safe-login" action="/login">
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
      <form method="post" id="overflow-login" action="/login">
        <input autocomplete="username" />
        ${currentPasswords}
        ${genericPasswords}
        <button type="submit">Continue</button>
      </form>
      <form method="post" id="safe-login" action="/login">
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

  test('refreshes approved facts when the snapshot key stays the same', () => {
    document.body.innerHTML = `
      <form method="post" aria-label="Login" action="/login">
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
    const first =
      classifiedAuthenticationWorkflowObservations(classifiedRequest)[0]
    if (!first) {
      throw new Error('expected the login workflow')
    }
    document
      .querySelector('input[type="password"]')
      ?.setAttribute('autocomplete', 'password')
    const refreshedRequest: Parameters<
      typeof classifiedAuthenticationWorkflowObservations
    >[0] = {
      workflowForms: summarizeAuthenticationWorkflowForms(),
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }
    const refreshed =
      classifiedAuthenticationWorkflowObservations(refreshedRequest)[0]
    if (!refreshed) {
      throw new Error('expected the refreshed login workflow')
    }
    const staleCheck: Parameters<typeof liveApprovedAuthenticationWorkflow>[0] =
      {
        approved: first,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }
    const refreshedCheck: Parameters<
      typeof liveApprovedAuthenticationWorkflow
    >[0] = {
      approved: refreshed,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }
    expect(liveApprovedAuthenticationWorkflow(staleCheck)).toBe(false)
    expect(liveApprovedAuthenticationWorkflow(refreshedCheck)).toBe(true)
    let submitted = false
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault()
      submitted = true
    })
    expect(didSubmit(wholeDocumentPasswordFormSubmission)).toBe(true)
    expect(submitted).toBe(true)
  })

  test('rejects a previously approved login after a higher-priority OTP workflow appears', () => {
    document.body.innerHTML = `
      <form method="post" id="login" aria-label="Login" action="/auth/login">
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
    const approved =
      classifiedAuthenticationWorkflowObservations(classifiedRequest)[0]
    if (!approved) {
      throw new Error('expected the login workflow')
    }
    const otp = document.createElement('form')
    otp.method = 'post'
    otp.id = 'otp'
    otp.action = '/auth/verify'
    otp.setAttribute('aria-label', 'Verify')
    otp.innerHTML = `
      <input autocomplete="one-time-code" />
      <button type="submit">Verify</button>
    `
    document.body.prepend(otp)
    const liveCheck: Parameters<typeof liveApprovedAuthenticationWorkflow>[0] =
      {
        approved,
        authenticatorSetupHint: false,
        backupCodesHint: false,
      }
    expect(liveApprovedAuthenticationWorkflow(liveCheck)).toBe(false)
  })
})
