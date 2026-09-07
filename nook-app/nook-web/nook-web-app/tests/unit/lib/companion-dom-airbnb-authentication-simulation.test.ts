// @vitest-environment-options { "url": "https://www.airbnb.com/login" }

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

const AIRBNB_FAKE_CREDENTIALS: FakeLoginCredentials = {
  username: 'pilot@nook.test',
  password: 'extension-fill-password',
}

enum AirbnbFixtureControl {
  Continue = 'Continue',
  ContinueWithGoogle = 'Continue with Google',
  ContinueWithApple = 'Continue with Apple',
  DeleteAccount = 'Delete account',
}

enum AirbnbFixtureState {
  Untouched = 'untouched',
  Activated = 'activated',
}

enum AirbnbFixtureOwnership {
  Owned = 'owned',
  Unowned = 'unowned',
}

enum AirbnbFixtureDestination {
  Omitted = 'omitted',
  CrossOrigin = 'cross-origin',
}

enum AirbnbFixtureSubmitLayout {
  Sole = 'sole',
  Ambiguous = 'ambiguous',
}

type AirbnbFixtureOptions = {
  readonly primaryLabel: AirbnbFixtureControl
  readonly ownership: AirbnbFixtureOwnership
  readonly destination: AirbnbFixtureDestination
  readonly submitLayout: AirbnbFixtureSubmitLayout
}

const AIRBNB_FIXTURE_DEFAULTS: AirbnbFixtureOptions = {
  primaryLabel: AirbnbFixtureControl.Continue,
  ownership: AirbnbFixtureOwnership.Owned,
  destination: AirbnbFixtureDestination.Omitted,
  submitLayout: AirbnbFixtureSubmitLayout.Sole,
}

type AirbnbDom = {
  readonly form: HTMLFormElement
  readonly root: HTMLElement
  readonly identity: HTMLInputElement
  readonly primary: HTMLButtonElement
  readonly alternatives: readonly HTMLButtonElement[]
}

class AirbnbAuthenticationFixture {
  private constructor(private readonly options: AirbnbFixtureOptions) {}

  static stable(): AirbnbAuthenticationFixture {
    return new AirbnbAuthenticationFixture(AIRBNB_FIXTURE_DEFAULTS)
  }

  static withPrimary(
    primaryLabel: AirbnbFixtureControl,
  ): AirbnbAuthenticationFixture {
    return new AirbnbAuthenticationFixture({
      ...AIRBNB_FIXTURE_DEFAULTS,
      primaryLabel,
    })
  }

  static crossOrigin(): AirbnbAuthenticationFixture {
    return new AirbnbAuthenticationFixture({
      ...AIRBNB_FIXTURE_DEFAULTS,
      destination: AirbnbFixtureDestination.CrossOrigin,
    })
  }

  static ambiguous(): AirbnbAuthenticationFixture {
    return new AirbnbAuthenticationFixture({
      ...AIRBNB_FIXTURE_DEFAULTS,
      submitLayout: AirbnbFixtureSubmitLayout.Ambiguous,
    })
  }

  static unowned(): AirbnbAuthenticationFixture {
    return new AirbnbAuthenticationFixture({
      ...AIRBNB_FIXTURE_DEFAULTS,
      ownership: AirbnbFixtureOwnership.Unowned,
    })
  }

  html(): string {
    const { destination, ownership, primaryLabel, submitLayout } = this.options
    const action =
      destination === AirbnbFixtureDestination.CrossOrigin
        ? ' action="https://attacker.example/login"'
        : ''
    const formTarget =
      ownership === AirbnbFixtureOwnership.Unowned
        ? ' form="airbnb-unrelated-form"'
        : ''
    const surface = `<label>Phone number or email<input type="text" inputmode="email" autocomplete="tel-national"></label><button type="submit"${formTarget} data-testid="airbnb-primary">${primaryLabel}</button>${submitLayout === AirbnbFixtureSubmitLayout.Ambiguous ? '<button type="submit">Primary action</button>' : ''}`
    const authentication =
      ownership === AirbnbFixtureOwnership.Owned
        ? `<form${action} data-testid="airbnb-auth-form">${surface}</form>`
        : `<form id="airbnb-unrelated-form"></form><section data-testid="airbnb-unowned">${surface}</section>`
    return `<main>${authentication}<button type="button" aria-label="Continue with Google"></button><button type="button" aria-label="Continue with Apple"></button></main>`
  }

  install(): AirbnbDom {
    document.body.innerHTML = this.html()
    const form = document.querySelector<HTMLFormElement>(
      this.options.ownership === AirbnbFixtureOwnership.Owned
        ? '[data-testid="airbnb-auth-form"]'
        : '#airbnb-unrelated-form',
    )
    const root = document.querySelector<HTMLElement>(
      this.options.ownership === AirbnbFixtureOwnership.Owned
        ? '[data-testid="airbnb-auth-form"]'
        : '[data-testid="airbnb-unowned"]',
    )
    const identity = root?.querySelector<HTMLInputElement>('input')
    const primary = root?.querySelector<HTMLButtonElement>(
      '[data-testid="airbnb-primary"]',
    )
    const alternatives = [
      ...document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Continue with"]',
      ),
    ]
    if (!form || !root || !identity || !primary || alternatives.length !== 2) {
      throw new Error('expected Airbnb DOM fixture')
    }
    return { form, root, identity, primary, alternatives }
  }

  expectAdvanceRejected(): void {
    const fixture = this.install()
    let state = AirbnbFixtureState.Untouched
    fixture.primary.addEventListener('click', () => {
      state = AirbnbFixtureState.Activated
    })
    const [observation] = summarizeAuthenticationWorkflowForms()
    if (!observation) throw new Error('expected rejected Airbnb observation')
    const request: Parameters<typeof clickAdvanceControl>[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
      usernameField: fixture.identity,
    }
    expect(clickAdvanceControl(request)).toBe(false)
    expect(state).toBe(AirbnbFixtureState.Untouched)
  }
}

afterEach(() => {
  document.body.replaceChildren()
  history.replaceState({}, '', '/login')
})

describe('Airbnb DOM-backed authentication simulation', () => {
  test('fills only the associated-label identity and activates Continue once', () => {
    expect(location.href).toBe('https://www.airbnb.com/login')
    const fixture = AirbnbAuthenticationFixture.stable().install()
    const observations = summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    const [observation] = observations
    if (!observation) throw new Error('expected Airbnb observation')
    expect(observation.formScope.kind).toBe(PasswordFormScopeKind.Owned)
    if (observation.formScope.kind !== PasswordFormScopeKind.Owned) {
      throw new Error('expected owned Airbnb observation')
    }
    expect(observation.formScope.owner).toBe(fixture.form)
    expect(fixture.form.hasAttribute('method')).toBe(false)
    expect(fixture.form.hasAttribute('action')).toBe(false)
    expect(fixture.form.method).toBe('get')
    expect(fixture.form.action).toBe('https://www.airbnb.com/login')
    expect(fixture.identity).toMatchObject({
      type: 'text',
      inputMode: 'email',
      autocomplete: 'tel-national',
    })
    expect(fixture.identity.hasAttribute('name')).toBe(false)
    expect(fixture.identity.hasAttribute('aria-label')).toBe(false)
    const associatedLabel = fixture.identity.labels?.[0]
    if (!associatedLabel) throw new Error('expected associated Airbnb label')
    expect(associatedLabel.textContent?.trim()).toBe('Phone number or email')
    expect(fixture.primary).toMatchObject({ type: 'submit', disabled: false })

    const facts = authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.fields).toMatchObject({
      usernameFieldCount: 1,
      currentPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
    })
    const advance = facts.detailedAdvanceControl
    if (!advance || advance.kind !== 'observed') {
      throw new Error('expected Airbnb advance-control facts')
    }
    const [control] = advance.observations
    if (!control) throw new Error('expected Airbnb Continue facts')
    expect(control).toMatchObject({
      actionability: 'actionable',
      authenticationUsername: 'explicit',
      destinationIdentity: 'https://www.airbnb.com/login',
      formIdentity: '',
      label: AirbnbFixtureControl.Continue,
      ownership: 'owned-form',
      semanticSubmitControlCount: 1,
      submissionDestinationSource: 'omitted',
      submissionMethod: 'get',
    })
    expect(authentication_advance_control_is_safe(control)).toBe(true)
    const workflow = classify_companion_authentication_workflow_facts({
      observations: [facts],
    })
    expect(companion_authentication_workflow_match_kind(workflow)).toBe(
      CompanionAuthenticationWorkflowMatchKind.Matched,
    )
    if (!('snapshot' in workflow)) throw new Error('expected matched workflow')
    expect(workflow.snapshot).toMatchObject({
      kind: AuthenticationWorkflowKind.Login,
      action: AuthenticationWorkflowAction.ContinueWithNook,
    })

    let primaryActivations = 0
    let alternativeState = AirbnbFixtureState.Untouched
    fixture.primary.addEventListener('click', () => {
      primaryActivations += 1
    })
    for (const alternative of fixture.alternatives) {
      alternative.addEventListener('click', () => {
        alternativeState = AirbnbFixtureState.Activated
      })
      expect(alternative.type).toBe('button')
      expect(alternative.form).not.toBeInstanceOf(HTMLFormElement)
    }
    expect(
      fillLoginCredentials({
        kind: PasswordFormQueryKind.Scoped,
        root: observation.root,
        formScope: observation.formScope,
        credentials: AIRBNB_FAKE_CREDENTIALS,
      }),
    ).toBe(true)
    expect(fixture.identity.value).toBe(AIRBNB_FAKE_CREDENTIALS.username)
    expect(
      submitLoginForm({
        kind: PasswordFormQueryKind.Scoped,
        root: observation.root,
        formScope: observation.formScope,
      }),
    ).toBe(FormSubmissionResult.Submitted)
    expect(primaryActivations).toBe(1)
    expect(alternativeState).toBe(AirbnbFixtureState.Untouched)
    expect(document.querySelectorAll('input')).toHaveLength(1)
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
  })

  test.each([
    AirbnbFixtureControl.ContinueWithGoogle,
    AirbnbFixtureControl.ContinueWithApple,
    AirbnbFixtureControl.DeleteAccount,
  ])('rejects unsafe primary label %s', (label) => {
    AirbnbAuthenticationFixture.withPrimary(label).expectAdvanceRejected()
  })

  test.each(['/signup', '/account/delete', '/login/google'])(
    'rejects destination drift to %s',
    (destination) => {
      history.replaceState({}, '', destination)
      AirbnbAuthenticationFixture.stable().expectAdvanceRejected()
    },
  )

  test('rejects a cross-origin destination', () => {
    AirbnbAuthenticationFixture.crossOrigin().expectAdvanceRejected()
  })

  test('rejects ambiguous semantic submits', () => {
    AirbnbAuthenticationFixture.ambiguous().expectAdvanceRejected()
    expect(
      document.querySelectorAll('form button[type="submit"]'),
    ).toHaveLength(2)
  })

  test('rejects an unowned field and control', () => {
    const scenario = AirbnbAuthenticationFixture.unowned()
    scenario.expectAdvanceRejected()
    const fixture = scenario.install()
    expect(fixture.identity.form).not.toBeInstanceOf(HTMLFormElement)
    expect(fixture.primary.form).toBe(fixture.form)
  })
})
