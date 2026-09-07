// @vitest-environment-options { "url": "https://auth.tesla.com/oauth2/v1/authorize" }

import { afterEach, describe, expect, test } from 'vitest'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  CompanionAuthenticationWorkflowMatchKind,
  authentication_advance_control_is_safe,
  classify_companion_authentication_workflow_facts,
  companion_authentication_workflow_match_kind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authenticationPageObservationFacts,
  fillLoginCredentials,
  FormSubmissionResult,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  submitLoginForm,
  summarizeAuthenticationWorkflowForms,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { clickAdvanceControl } from '../../../../nook-web-shared/src/extension/password-form-submission-controls'
import type { FakeLoginCredentials } from './companion-credential-fill-simulation'

const TESLA_FAKE_CREDENTIALS: FakeLoginCredentials = {
  username: 'pilot@nook.test',
  password: 'extension-fill-password',
}

enum TeslaFixturePrimaryControl {
  Next = 'Next',
  TroubleSigningIn = 'Trouble Signing In?',
  CreateAccount = 'Create Account',
  ContinueWithGoogle = 'Continue with Google',
  UsePasskey = 'Use passkey',
  DeleteAccount = 'Delete account',
}

enum TeslaFixtureControlState {
  Untouched = 'untouched',
  Activated = 'activated',
}

enum TeslaFixtureFormOwnership {
  Owned = 'owned',
  Unowned = 'unowned',
}

enum TeslaFixtureFormDestination {
  Omitted = 'omitted',
  CrossOrigin = 'cross-origin',
}

enum TeslaFixtureSubmitLayout {
  Sole = 'sole',
  Ambiguous = 'ambiguous',
}

enum TeslaFixtureAutocomplete {
  EmailWebAuthn = 'email webauthn',
  Email = 'email',
}

type TeslaFixtureOptions = {
  readonly primaryLabel: TeslaFixturePrimaryControl
  readonly ownership: TeslaFixtureFormOwnership
  readonly destination: TeslaFixtureFormDestination
  readonly submitLayout: TeslaFixtureSubmitLayout
  readonly autocomplete: TeslaFixtureAutocomplete
}

const TESLA_FIXTURE_DEFAULTS: TeslaFixtureOptions = {
  primaryLabel: TeslaFixturePrimaryControl.Next,
  ownership: TeslaFixtureFormOwnership.Owned,
  destination: TeslaFixtureFormDestination.Omitted,
  submitLayout: TeslaFixtureSubmitLayout.Sole,
  autocomplete: TeslaFixtureAutocomplete.EmailWebAuthn,
}

type TeslaDomElements = {
  readonly root: HTMLElement
  readonly email: HTMLInputElement
  readonly primary: HTMLButtonElement
  readonly alternatives: readonly HTMLElement[]
}

class TeslaAuthenticationFixture {
  private constructor(private readonly options: TeslaFixtureOptions) {}

  static stable(): TeslaAuthenticationFixture {
    return new TeslaAuthenticationFixture(TESLA_FIXTURE_DEFAULTS)
  }

  static withPrimaryControl(
    primaryLabel: TeslaFixturePrimaryControl,
  ): TeslaAuthenticationFixture {
    return new TeslaAuthenticationFixture({
      ...TESLA_FIXTURE_DEFAULTS,
      primaryLabel,
    })
  }

  static withCrossOriginAction(): TeslaAuthenticationFixture {
    return new TeslaAuthenticationFixture({
      ...TESLA_FIXTURE_DEFAULTS,
      destination: TeslaFixtureFormDestination.CrossOrigin,
    })
  }

  static withGenericEmail(): TeslaAuthenticationFixture {
    return new TeslaAuthenticationFixture({
      ...TESLA_FIXTURE_DEFAULTS,
      autocomplete: TeslaFixtureAutocomplete.Email,
    })
  }

  static ambiguous(): TeslaAuthenticationFixture {
    return new TeslaAuthenticationFixture({
      ...TESLA_FIXTURE_DEFAULTS,
      submitLayout: TeslaFixtureSubmitLayout.Ambiguous,
    })
  }

  static unowned(): TeslaAuthenticationFixture {
    return new TeslaAuthenticationFixture({
      ...TESLA_FIXTURE_DEFAULTS,
      ownership: TeslaFixtureFormOwnership.Unowned,
    })
  }

  html(): string {
    const { autocomplete, destination, ownership, primaryLabel, submitLayout } =
      this.options
    const actionAttribute =
      destination === TeslaFixtureFormDestination.CrossOrigin
        ? ' action="https://attacker.example/sign-in"'
        : ''
    const primaryFormAttribute =
      ownership === TeslaFixtureFormOwnership.Unowned
        ? ' form="tesla-unrelated-form"'
        : ''
    const content = `<label>Email<input name="identity" autocomplete="${autocomplete}" aria-label="Email"></label><button type="submit" disabled${primaryFormAttribute} data-testid="tesla-primary">${primaryLabel}</button>${submitLayout === TeslaFixtureSubmitLayout.Ambiguous ? '<button type="submit">Primary action</button>' : ''}`
    const authenticationSurface =
      ownership === TeslaFixtureFormOwnership.Owned
        ? `<form${actionAttribute} data-testid="tesla-auth-form">${content}</form>`
        : `<form id="tesla-unrelated-form" data-testid="tesla-unrelated-form"></form><section data-testid="tesla-unowned-surface">${content}</section>`
    return `<header><a href="https://www.tesla.com/" aria-label="Tesla home">Tesla</a></header><main><h1>Sign In</h1>${authenticationSurface}<a href="/forgot">Trouble Signing In?</a><p>Or</p><button type="button">Create Account</button><button type="button">Select Language</button></main><footer><a href="/privacy">Privacy</a><a href="/contact">Contact</a></footer>`
  }

  install(): TeslaDomElements {
    const { ownership } = this.options
    document.body.innerHTML = this.html()
    const root = document.querySelector<HTMLElement>(
      ownership === TeslaFixtureFormOwnership.Owned
        ? '[data-testid="tesla-auth-form"]'
        : '[data-testid="tesla-unowned-surface"]',
    )
    const email = root?.querySelector<HTMLInputElement>('[aria-label="Email"]')
    const primary = root?.querySelector<HTMLButtonElement>(
      '[data-testid="tesla-primary"]',
    )
    if (!root || !email || !primary) {
      throw new Error('expected Tesla DOM fixture')
    }
    email.addEventListener('input', () => {
      primary.disabled = email.value.trim().length === 0
    })
    return {
      root,
      email,
      primary,
      alternatives: [
        ...document.querySelectorAll<HTMLElement>(
          'header a, main > a, main > button[type="button"], footer a',
        ),
      ],
    }
  }

  expectAdvanceRejected(): void {
    const fixture = this.install()
    fixture.email.value = TESLA_FAKE_CREDENTIALS.username
    fixture.email.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(fixture.primary.disabled).toBe(false)
    let primaryState = TeslaFixtureControlState.Untouched
    fixture.primary.addEventListener('click', () => {
      primaryState = TeslaFixtureControlState.Activated
    })
    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected rejected Tesla form')
    const request: Parameters<typeof clickAdvanceControl>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
      usernameField: fixture.email,
    }
    expect(clickAdvanceControl(request)).toBe(false)
    expect(primaryState).toBe(TeslaFixtureControlState.Untouched)
    expect(fixture.email.value).toBe(TESLA_FAKE_CREDENTIALS.username)
  }
}

afterEach(() => {
  document.body.replaceChildren()
  history.replaceState({}, '', '/oauth2/v1/authorize')
})

describe('Tesla DOM-backed authentication simulation', () => {
  test('fills only Email, enables Next, and activates it exactly once', () => {
    expect(location.href).toBe('https://auth.tesla.com/oauth2/v1/authorize')
    const fixture = TeslaAuthenticationFixture.stable().install()
    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    const [observation] = observations
    if (!observation) throw new Error('expected Tesla observation')
    expect(observation.root).toBe(document)
    expect(observation.formScope.kind).toBe(PasswordFormScopeKind.Owned)
    if (observation.formScope.kind !== PasswordFormScopeKind.Owned) {
      throw new Error('expected owned Tesla observation')
    }
    expect(observation.formScope.owner).toBe(fixture.root)
    const form = fixture.root
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('expected owned Tesla form')
    }
    expect(form.hasAttribute('method')).toBe(false)
    expect(form.method).toBe('get')
    expect(form.hasAttribute('action')).toBe(false)
    expect(form.action).toBe('https://auth.tesla.com/oauth2/v1/authorize')
    expect(fixture.email.hasAttribute('type')).toBe(false)
    expect(fixture.email.type).toBe('text')
    expect(fixture.primary.disabled).toBe(true)

    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const detailedAdvanceControl = facts.detailedAdvanceControl
    if (!detailedAdvanceControl || detailedAdvanceControl.kind !== 'observed') {
      throw new Error('expected typed Tesla advance-control facts')
    }
    const [initialControl] = detailedAdvanceControl.observations
    if (!initialControl) throw new Error('expected inert Tesla control facts')
    expect(initialControl).toMatchObject({
      actionability: 'inert',
      authenticationUsername: 'web-authn-email',
      sourceOrigin: 'https://auth.tesla.com',
      destinationIdentity: 'https://auth.tesla.com/oauth2/v1/authorize',
      formIdentity: '',
      label: TeslaFixturePrimaryControl.Next,
      ownership: 'owned-form',
      semanticSubmitControlCount: 1,
      submissionDestinationSource: 'omitted',
      submissionMethod: 'get',
    })
    expect(authentication_advance_control_is_safe(initialControl)).toBe(false)
    const initialWorkflow = classify_companion_authentication_workflow_facts({
      observations: [facts],
    })
    expect(companion_authentication_workflow_match_kind(initialWorkflow)).toBe(
      CompanionAuthenticationWorkflowMatchKind.Matched,
    )
    if (!('snapshot' in initialWorkflow)) {
      throw new Error('expected initially detected Tesla workflow')
    }
    expect(initialWorkflow.snapshot).toMatchObject({
      kind: AuthenticationWorkflowKind.Login,
      action: AuthenticationWorkflowAction.ContinueWithNook,
    })

    fixture.email.value = TESLA_FAKE_CREDENTIALS.username
    fixture.email.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(fixture.primary.disabled).toBe(false)
    const refreshedObservation = summarizeAuthenticationWorkflowForms()[0]
    if (!refreshedObservation) throw new Error('expected enabled Tesla form')
    const refreshedFacts = authenticationPageObservationFacts({
      observation: refreshedObservation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    const refreshedAdvanceControl = refreshedFacts.detailedAdvanceControl
    if (
      !refreshedAdvanceControl ||
      refreshedAdvanceControl.kind !== 'observed'
    ) {
      throw new Error('expected enabled Tesla advance-control facts')
    }
    expect(
      refreshedAdvanceControl.observations.some(
        authentication_advance_control_is_safe,
      ),
    ).toBe(true)
    fixture.email.value = ''
    fixture.email.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const fillRequest: Parameters<typeof fillLoginCredentials>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: refreshedObservation.root,
      formScope: refreshedObservation.formScope,
      credentials: TESLA_FAKE_CREDENTIALS,
    }
    let primaryActivationCount = 0
    let alternativesState = TeslaFixtureControlState.Untouched
    fixture.primary.addEventListener('click', () => {
      primaryActivationCount += 1
    })
    for (const alternative of fixture.alternatives) {
      alternative.addEventListener('click', () => {
        alternativesState = TeslaFixtureControlState.Activated
      })
    }
    expect(fillLoginCredentials(fillRequest)).toBe(true)
    expect(fixture.email.value).toBe(TESLA_FAKE_CREDENTIALS.username)
    expect(fixture.primary.disabled).toBe(false)
    const submissionRequest: Parameters<typeof submitLoginForm>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: refreshedObservation.root,
      formScope: refreshedObservation.formScope,
    }
    expect(submitLoginForm(submissionRequest)).toBe(
      FormSubmissionResult.Submitted,
    )
    expect(primaryActivationCount).toBe(1)
    expect(alternativesState).toBe(TeslaFixtureControlState.Untouched)
    expect(document.querySelectorAll('input')).toHaveLength(1)
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('hCaptcha')
  })

  test.each([
    TeslaFixturePrimaryControl.TroubleSigningIn,
    TeslaFixturePrimaryControl.CreateAccount,
    TeslaFixturePrimaryControl.ContinueWithGoogle,
    TeslaFixturePrimaryControl.UsePasskey,
    TeslaFixturePrimaryControl.DeleteAccount,
  ])('rejects unsafe local activation %s', (primaryLabel) => {
    TeslaAuthenticationFixture.withPrimaryControl(
      primaryLabel,
    ).expectAdvanceRejected()
  })

  test('rejects Next while the observed empty-state control is disabled', () => {
    const fixture = TeslaAuthenticationFixture.stable().install()
    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected inert Tesla form')
    const request: Parameters<typeof clickAdvanceControl>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
      usernameField: fixture.email,
    }
    expect(fixture.primary.disabled).toBe(true)
    expect(clickAdvanceControl(request)).toBe(false)
    expect(fixture.email.value).toBe('')
  })

  test.each(['/signup', '/recover', '/oauth2/v1/token', '/account/delete'])(
    'rejects destination drift to %s',
    (destination) => {
      history.replaceState({}, '', destination)
      TeslaAuthenticationFixture.stable().expectAdvanceRejected()
    },
  )

  test('rejects generic email autocomplete without WebAuthn evidence', () => {
    TeslaAuthenticationFixture.withGenericEmail().expectAdvanceRejected()
  })

  test('rejects an authored cross-origin destination', () => {
    TeslaAuthenticationFixture.withCrossOriginAction().expectAdvanceRejected()
  })

  test('rejects ambiguous semantic submits', () => {
    TeslaAuthenticationFixture.ambiguous().expectAdvanceRejected()
    expect(
      document.querySelectorAll('form button[type="submit"]'),
    ).toHaveLength(2)
  })

  test('rejects an unowned field and control', () => {
    TeslaAuthenticationFixture.unowned().expectAdvanceRejected()
    const email = document.querySelector<HTMLInputElement>('[name="identity"]')
    const primary = document.querySelector<HTMLButtonElement>(
      '[data-testid="tesla-primary"]',
    )
    if (!email || !primary) throw new Error('expected unowned Tesla surface')
    expect(email.form).not.toBeInstanceOf(HTMLFormElement)
    expect(primary.closest('form')).not.toBeInstanceOf(HTMLFormElement)
  })
})
