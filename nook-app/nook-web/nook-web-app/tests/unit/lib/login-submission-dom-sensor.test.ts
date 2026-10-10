import type { LoginCredentials } from '../../../../nook-web-shared/src/extension/password-forms'
import type { LoginSubmissionIntent, AuthenticationCeremonyContextObservation } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { afterEach, describe, expect, test } from 'vitest'
import {
  LoginSubmissionDomObservationKind,
  LoginSubmissionDomSensor,
  type LoginSubmissionDomObservation,
  type LoginSubmissionCredentialIndices,
} from '../../../../nook-web-extension/src/content/autofill/login-submission-dom-sensor'

/** Simulates trusted Chrome input at the DOM sensor boundary. */
class LoginSubmissionDomFixture {
  private readonly sensor = new LoginSubmissionDomSensor()
  private observation: LoginSubmissionDomObservation = {
    kind: LoginSubmissionDomObservationKind.Ignored,
  }
  constructor() {this.sensor.rememberPasswordFields()}

  click(selector: string): LoginSubmissionDomObservation {
    const options: MouseEventInit = {bubbles: true}
    const event = new MouseEvent('click', options)
    const request: LoginSubmissionDomDispatch = {selector, event}
    return this.dispatch(request)
  }

  enter(selector: string): LoginSubmissionDomObservation {
    const options: KeyboardEventInit = { key: 'Enter', bubbles: true }
    const event = new KeyboardEvent('keydown', options)
    const request: LoginSubmissionDomDispatch = {selector, event}
    return this.dispatch(request)
  }

  private dispatch({ selector, event }: LoginSubmissionDomDispatch): LoginSubmissionDomObservation {
    const target = document.querySelector(selector)
    switch (target instanceof HTMLElement) {
      case false:
        throw new Error('expected submission event target')
      case true:
        break
    }
    const trust: PropertyDescriptor = { value: true }
    Object.defineProperty(event, 'isTrusted', trust)
    const options: AddEventListenerOptions = {once: true}
    target.addEventListener(event.type, (received) => {
      this.observation = this.sensor.observe(received)
    }, options)
    target.dispatchEvent(event)
    return this.observation
  }
}

type LoginSubmissionDomDispatch = {
  readonly selector: string
  readonly event: Event
}

afterEach(() => document.body.replaceChildren())

describe('submitted login DOM snapshot', () => {
  test('captures values before JavaScript clears and replaces form-less fields', () => {
    document.body.innerHTML = `<main><div class="login">
      <input autocomplete="username" value="submitted-user" />
      <input type="password" autocomplete="current-password" value="  submitted-password  " />
      <button type="button"><span id="activate">Sign in</span></button>
    </div></main>`
    const fixture = new LoginSubmissionDomFixture()
    const observation = fixture.click('#activate')
    switch (observation.kind) {
      case LoginSubmissionDomObservationKind.Ignored:
        throw new Error('expected a control submission snapshot')
      case LoginSubmissionDomObservationKind.Observed:
        break
    }
    document.body.replaceChildren()
    const indices: LoginSubmissionCredentialIndices = { usernameIndex: 0, passwordIndex: 1 }
    const expectedCredentials: LoginCredentials = {username: 'submitted-user', password: '  submitted-password  '}
    expect(observation.snapshot.credentials(indices)).toEqual(expectedCredentials)
    observation.snapshot.dispose()
    expect(observation.snapshot.captureRecord().fields).toEqual([])
  })

  test('Enter collects only inputs in the targeted form and observes a shown password', () => {
    document.body.innerHTML = `<form id="first">
      <input autocomplete="username" value="first-user" />
      <input id="password" type="text" autocomplete="current-password" value="first-password" />
    </form><form id="other">
      <input autocomplete="username" value="other-user" />
      <input type="password" value="other-password" />
    </form>`
    const fixture = new LoginSubmissionDomFixture()
    const observation = fixture.enter('#password')
    switch (observation.kind) {
      case LoginSubmissionDomObservationKind.Ignored:
        throw new Error('expected an Enter snapshot')
      case LoginSubmissionDomObservationKind.Observed:
        break
    }
    const indices: LoginSubmissionCredentialIndices = { usernameIndex: 0, passwordIndex: 1 }
    const expectedCredentials: LoginCredentials = {username: 'first-user', password: 'first-password'}
    expect(observation.snapshot.credentials(indices)).toEqual(expectedCredentials)
    expect(observation.snapshot.captureRecord().fields[1]?.input_type).toBe('text')
    observation.snapshot.dispose()
  })

  test('separate form-less containers keep their credential values separate', () => {
    document.body.innerHTML = `<main><section>
      <input autocomplete="username" value="first-user" />
      <input type="password" value="first-password" />
      <button id="first" type="button">Sign in</button>
    </section><section>
      <input autocomplete="username" value="other-user" />
      <input type="password" value="other-password" />
      <button type="button">Sign in</button>
    </section></main>`
    const fixture = new LoginSubmissionDomFixture()
    const observation = fixture.click('#first')
    switch (observation.kind) {
      case LoginSubmissionDomObservationKind.Ignored:
        throw new Error('expected scoped form-less snapshot')
      case LoginSubmissionDomObservationKind.Observed:
        break
    }
    const indices: LoginSubmissionCredentialIndices = { usernameIndex: 0, passwordIndex: 1 }
    const expectedCredentials: LoginCredentials = {username: 'first-user', password: 'first-password'}
    expect(observation.snapshot.credentials(indices)).toEqual(expectedCredentials)
    observation.snapshot.dispose()
  })

  test('typing focus and widget clicks do not create submission snapshots', () => {
    document.body.innerHTML = `<main>
      <input autocomplete="username" /><input type="password" />
      <div id="nook-auth-widget"><button id="save" type="button">Save</button></div>
    </main>`
    const sensor = new LoginSubmissionDomSensor()
    expect(sensor.observe(new Event('input')).kind).toBe(LoginSubmissionDomObservationKind.Ignored)
    expect(sensor.observe(new Event('focusin')).kind).toBe(LoginSubmissionDomObservationKind.Ignored)
    const fixture = new LoginSubmissionDomFixture()
    expect(fixture.click('#save').kind).toBe(LoginSubmissionDomObservationKind.Ignored)
  })

  test('does not combine credentials from separate incomplete semantic containers', () => {
    document.body.innerHTML = '<main><section><input autocomplete="username" value="other-user"></section><section><input type="password" value="secret"><button id="login" type="button">Sign in</button></section></main>'
    const fixture = new LoginSubmissionDomFixture()
    expect(fixture.click('#login').kind).toBe(LoginSubmissionDomObservationKind.Ignored)
  })

  test('retains the pre-handler intent context and drains a transition occurring during staging', () => {
    document.body.innerHTML = '<main id="signup"><input autocomplete="username"><input type="password"><h1>Create account</h1><button id="submit" type="button">Create account</button></main>'
    const fixture = new LoginSubmissionDomFixture()
    const observation = fixture.click('#submit')
    switch (observation.kind) {case LoginSubmissionDomObservationKind.Observed: break; case LoginSubmissionDomObservationKind.Ignored: throw new Error('expected submission snapshot')}
    document.querySelector('main')?.replaceChildren()
    const expectedIntent: Pick<LoginSubmissionIntent, 'control_label'> & {context: {ceremony: {authenticationContext: Pick<AuthenticationCeremonyContextObservation, 'formIdentity'>}}} = {control_label: 'Create account', context: {ceremony: {authenticationContext: {formIdentity: expect.stringContaining('Create account')}}}}
    expect(observation.snapshot.intent()).toMatchObject(expectedIntent)
    expect(observation.snapshot.mutationOccurred()).toBe(true)
    observation.snapshot.dispose()
  })
})
