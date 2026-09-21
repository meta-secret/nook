// @vitest-environment-options { "url": "https://www.linkedin.com/login/?trk=guest_homepage-basic_nav-header-signin" }

import { afterEach, describe, expect, test } from 'vitest'

import {
  AuthenticationWorkflowAction,
  AuthenticationWorkflowKind,
  CompanionAuthenticationWorkflowMatchKind,
  classify_companion_authentication_workflow_facts,
  companion_authentication_workflow_match_kind,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  FormSubmissionResult,
  PasswordFormQueryKind,
  PasswordFormScopeKind,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { authenticationSubmissionControls } from '../../../../nook-web-shared/src/extension/password-form-submission-controls'

type LinkedInDomElements = {
  readonly root: HTMLElement
  readonly username: HTMLInputElement
  readonly password: HTMLInputElement
  readonly hiddenUsername: HTMLInputElement
  readonly hiddenPassword: HTMLInputElement
  readonly signIn: HTMLButtonElement
  readonly alternatives: readonly HTMLElement[]
  readonly keepSignedIn: HTMLInputElement
}

class LinkedInDomFixture {
  static install(primaryLabel = 'Sign in'): LinkedInDomElements {
    document.body.innerHTML = `<main>
    <section data-testid="linkedin-responsive-duplicate" style="display:none">
      <button type="button">Sign in with Apple</button>
      <div class="e5616576 _1957d19a _3ff5f032 _3e0ed175 d73e1ea3 _09ab8b1b _991ffcd1 d1901be7">
        <div class="_649b9f0b d1901be7"><div class="_6f6ba678 _1957d19a _3ff5f032 d1901be7">
          <label for="«r1»">Email or phone</label><div class="dfaf4f38 d1901be7">
            <input id="«r1»" type="email" autocomplete="username">
          </div>
        </div></div>
        <div class="dcd57938 _1957d19a d1901be7"><div class="_6f6ba678 _1957d19a _3ff5f032 d1901be7">
          <label for="«r2»">Password</label><div class="dfaf4f38 d1901be7">
            <input id="«r2»" type="password" autocomplete="current-password">
            <div class="c0d882ed dabfd919 _42ca2b07 _6b579e31"><button type="button" aria-label="Show password"></button></div>
          </div>
        </div></div>
        <label for="hidden-keep">Keep me signed in</label>
        <input id="hidden-keep" type="checkbox" tabindex="-1" checked>
        <button type="button">Sign in</button>
      </div>
    </section>
    <section data-testid="linkedin-active-surface">
      <button type="button">Sign in with Apple</button>
      <div class="e5616576 _1957d19a _3ff5f032 _3e0ed175 d73e1ea3 _09ab8b1b _991ffcd1 d1901be7">
        <div class="_649b9f0b d1901be7"><div class="_6f6ba678 _1957d19a _3ff5f032 d1901be7">
          <label for="«r3»">Email or phone</label><div class="dfaf4f38 d1901be7">
            <input id="«r3»" type="email" autocomplete="username webauthn">
          </div>
        </div></div>
        <div class="dcd57938 _1957d19a d1901be7"><div class="_6f6ba678 _1957d19a _3ff5f032 d1901be7">
          <label for="«r4»">Password</label><div class="dfaf4f38 d1901be7">
            <input id="«r4»" type="password" autocomplete="current-password">
            <div class="c0d882ed dabfd919 _42ca2b07 _6b579e31"><button type="button" aria-label="Show password"></button></div>
          </div>
        </div></div>
        <label for="active-keep">Keep me signed in</label>
        <input id="active-keep" type="checkbox" tabindex="-1" checked>
        <button type="button" data-testid="primary">${primaryLabel}</button>
      </div>
    </section>
    <a href="/checkpoint/rp/request-password-reset">Forgot password?</a>
    <a href="/signup">Join now</a><a href="/legal/privacy-policy">Privacy Policy</a>
    <label>Language<select><option>English</option></select></label>
    </main>`
    const activeSurface = document.querySelector<HTMLElement>(
      '[data-testid="linkedin-active-surface"]',
    )
    const root = activeSurface?.querySelector<HTMLElement>(':scope > div')
    const username = root?.querySelector<HTMLInputElement>(
      'input[autocomplete~="username"]',
    )
    const password = root?.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    )
    const duplicate = document.querySelector<HTMLElement>(
      '[data-testid="linkedin-responsive-duplicate"]',
    )
    const hiddenUsername = duplicate?.querySelector<HTMLInputElement>(
      'input[autocomplete="username"]',
    )
    const hiddenPassword = duplicate?.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    )
    const signIn = root?.querySelector<HTMLButtonElement>(
      '[data-testid="primary"]',
    )
    const keepSignedIn = root?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )
    if (
      !root ||
      !username ||
      !password ||
      !hiddenUsername ||
      !hiddenPassword ||
      !signIn ||
      !keepSignedIn
    ) {
      throw new Error('expected LinkedIn DOM fixture')
    }
    return {
      root,
      username,
      password,
      hiddenUsername,
      hiddenPassword,
      signIn,
      keepSignedIn,
      alternatives: [
        ...document.querySelectorAll<HTMLElement>(
          'button:not([data-testid="primary"]), a, select',
        ),
      ],
    }
  }
}

afterEach(() => {
  document.body.replaceChildren()
  history.replaceState({}, '', '/login/')
})

describe('LinkedIn DOM-backed authentication simulation', () => {
  test('fills and activates only the visible form-less combined surface', () => {
    const fixture = LinkedInDomFixture.install()
    const observations =
      passwordFormInteraction.summarizeAuthenticationWorkflowForms()
    expect(observations).toHaveLength(1)
    const [observation] = observations
    if (!observation) throw new Error('expected LinkedIn observation')
    expect(observation.root === fixture.root).toBe(true)
    expect(observation.formScope.kind).toBe(PasswordFormScopeKind.Unowned)
    const facts = passwordFormInteraction.authenticationPageObservationFacts({
      observation,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    })
    expect(facts.fields).toMatchObject({
      usernameFieldCount: 1,
      currentPasswordFieldCount: 1,
    })
    expect(facts.ceremony.authenticationContext).toMatchObject({
      sourceOrigin: 'https://www.linkedin.com',
      formIdentity:
        'e5616576 _1957d19a _3ff5f032 _3e0ed175 d73e1ea3 _09ab8b1b _991ffcd1 d1901be7',
      destinationIdentity:
        'https://www.linkedin.com/login/?trk=guest_homepage-basic_nav-header-signin',
    })
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

    const fillRequest: Parameters<
      typeof passwordFormInteraction.fillLoginCredentials
    >[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
      credentials: {
        username: 'pilot@nook.test',
        password: 'extension-fill-password',
      },
    }
    expect(passwordFormInteraction.fillLoginCredentials(fillRequest)).toBe(true)
    let primaryActivations = 0
    let alternativeActivations = 0
    fixture.signIn.addEventListener('click', () => (primaryActivations += 1))
    for (const alternative of fixture.alternatives) {
      alternative.addEventListener('click', () => (alternativeActivations += 1))
      alternative.addEventListener(
        'change',
        () => (alternativeActivations += 1),
      )
    }
    const detailedAdvanceControl =
      'detailedAdvanceControl' in facts ? facts.detailedAdvanceControl : false
    const submitRequest: Parameters<
      typeof passwordFormInteraction.submitLoginForm
    >[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: observation.root,
      formScope: observation.formScope,
      approvedAdvanceControls:
        detailedAdvanceControl && detailedAdvanceControl.kind === 'observed'
          ? detailedAdvanceControl.observations
          : [],
    }
    expect(passwordFormInteraction.submitLoginForm(submitRequest)).toBe(
      FormSubmissionResult.Submitted,
    )
    expect(primaryActivations).toBe(1)
    expect(alternativeActivations).toBe(0)
    expect(fixture.username.value).toBe('pilot@nook.test')
    expect(fixture.password.value).toBe('extension-fill-password')
    expect(fixture.hiddenUsername.value).toBe('')
    expect(fixture.hiddenPassword.value).toBe('')
    expect(fixture.keepSignedIn.checked).toBe(true)
    expect(document.querySelectorAll('form')).toHaveLength(0)
    expect(
      [fixture.username, fixture.password].every(
        (field) => field.hasAttribute('id') && !field.hasAttribute('name'),
      ),
    ).toBe(true)
  })

  test.each([
    'Show password',
    'Keep me signed in',
    'Forgot password',
    'Sign in with Apple',
    'Use passkey',
    'Continue with SAML',
    'Sign in with SSO',
    'Join now',
    'Terms of Service',
    'Privacy Policy',
    'Delete account',
  ])('rejects unsafe combined activation %s', (label) => {
    const fixture = LinkedInDomFixture.install(label)
    let activations = 0
    fixture.signIn.addEventListener('click', () => (activations += 1))
    const request: Parameters<
      typeof authenticationSubmissionControls.clickAdvanceControl
    >[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: fixture.root,
      formScope: { kind: PasswordFormScopeKind.Unowned },
      usernameField: fixture.username,
    }
    expect(authenticationSubmissionControls.clickAdvanceControl(request)).toBe(
      false,
    )
    expect(activations).toBe(0)
  })

  test('rejects combined activation after destination drift', () => {
    const fixture = LinkedInDomFixture.install()
    history.replaceState({}, '', '/signup')
    let activations = 0
    fixture.signIn.addEventListener('click', () => (activations += 1))
    const request: Parameters<
      typeof authenticationSubmissionControls.clickAdvanceControl
    >[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: fixture.root,
      formScope: { kind: PasswordFormScopeKind.Unowned },
      usernameField: fixture.username,
    }
    expect(authenticationSubmissionControls.clickAdvanceControl(request)).toBe(
      false,
    )
    expect(activations).toBe(0)
  })

  test('rejects inert combined activation', () => {
    const fixture = LinkedInDomFixture.install()
    fixture.signIn.setAttribute('aria-disabled', 'true')
    let activations = 0
    fixture.signIn.addEventListener('click', () => (activations += 1))
    const request: Parameters<
      typeof authenticationSubmissionControls.clickAdvanceControl
    >[0] = {
      kind: PasswordFormQueryKind.Scoped,
      root: fixture.root,
      formScope: { kind: PasswordFormScopeKind.Unowned },
      usernameField: fixture.username,
    }
    expect(authenticationSubmissionControls.clickAdvanceControl(request)).toBe(
      false,
    )
    expect(activations).toBe(0)
  })
})
