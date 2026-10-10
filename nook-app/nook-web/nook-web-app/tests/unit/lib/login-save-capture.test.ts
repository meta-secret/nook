import {
  classify_companion_login_save_capture,
  decode_extension_session_request,
  type ExtensionSessionRequest,
  type LoginSubmissionCapture as LoginSubmissionCaptureRecord,
  type LoginSaveCaptureBaseline,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  LoginSaveNavigationMode,
  LoginSaveOutcomeSensor,
  type LoginSaveOutcomeSensorRequest,
} from '../../../../nook-web-extension/src/content/autofill/login-save-outcome-sensor'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { handleCompanionWasmMessage } from '../../../../nook-web-extension/src/offscreen/session-companion-wasm-operations'
import {
  LoginSubmissionCapture,
  LoginSubmissionCaptureFailure,
  type CapturedLoginSubmission,
} from '../../../../nook-web-extension/src/content/autofill/login-submission-capture'
import {
  LoginCredentialsLookupKind,
  type LoginCredentials,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { Effect } from 'effect'
import { SessionOperationFailureKind } from '../../../../nook-web-extension/src/lib/session-operation-queue'
import type { LoginSubmissionDomSnapshot } from '../../../../nook-web-extension/src/content/autofill/login-submission-dom-sensor'
import { ExtensionSessionMessageType } from '../../../../nook-web-extension/src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../../../../nook-web-extension/src/offscreen/session-request-adapter'

vi.mock(
  '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport',
  async () => {
    const actual = await vi.importActual<
      typeof import('../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport')
    >(
      '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport',
    )
    const send: typeof actual.sendCompanionWasmRuntimeMessage = async (
      _browser,
      message,
    ) => {
      const result = await handleCompanionWasmMessage(message)
      return result.match(
        (response) => ({
          kind: actual.CompanionWasmRuntimeDeliveryKind.Delivered,
          response,
        }),
        () => ({ kind: actual.CompanionWasmRuntimeDeliveryKind.Unavailable }),
      )
    }
    return { ...actual, sendCompanionWasmRuntimeMessage: send }
  },
)

/** Exercises the same single intent owner installed in the content script. */
class LoginSaveCaptureFixture {
  readonly staged: {
    kind: Exclude<
      ReturnType<typeof classify_companion_login_save_capture>['kind'],
      'Ignored'
    >
    credentials: LoginCredentials
    startedAt: number
    url: string
    baseline: LoginSaveCaptureBaseline
  }[] = []
  private readonly runtime: ConstructorParameters<
    typeof LoginSubmissionCapture
  >[0] = { stage: this.stage.bind(this) }
  readonly capture = new LoginSubmissionCapture(this.runtime)
  constructor() {
    this.capture.enable()
  }
  readonly ingress: {
    values: string[]
    capture: LoginSubmissionCaptureRecord
  }[] = []
  private readiness = Promise.resolve()
  holdFirstIngress(): () => void {
    let release = () => {}
    this.readiness = new Promise((resolve) => {
      release = resolve
    })
    return release
  }
  private async stage({ snapshot }: CapturedLoginSubmission): Promise<void> {
    const capture = snapshot.captureRecord()
    const values = snapshot.capturedValues()
    let explicit: LoginCredentials = { username: '', password: '' }
    switch (snapshot.explicitCredentials.kind) {
      case LoginCredentialsLookupKind.Absent:
        break
      case LoginCredentialsLookupKind.Found:
        explicit = { ...snapshot.explicitCredentials.credentials }
        break
    }
    const ingress: Parameters<typeof this.ingress.push>[0] = { values, capture }
    this.ingress.push(ingress)
    await this.readiness
    try {
      const request: Extract<
        ExtensionSessionRequest,
        { type: typeof ExtensionSessionMessageType.PlanLoginSave }
      > = {
        type: ExtensionSessionMessageType.PlanLoginSave,
        payload: {
          origin: location.origin,
          sender: { tab_id: 1, frame_id: 0 },
          vaultStoreId: 'vault-fixture',
          deviceId: 'device',
          devicePublicKey: 'public',
          deviceSigningPublicKey: 'signing',
          username: explicit.username,
          password: explicit.password,
          capturedValues: values,
          capture,
          queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
        },
      }
      decode_extension_session_request(request)
      const decision = classify_companion_login_save_capture(capture)
      let credentials: LoginCredentials
      switch (decision.kind) {
        case 'SubmittedLogin': {
          const username = values[decision.username_field_index.value]
          const password = values[decision.password_field_index.value]
          switch (
            typeof username === 'string' &&
            typeof password === 'string'
          ) {
            case true:
              break
            case false:
              throw new Error('captured values absent')
          }
          credentials = { username, password }
          break
        }
        case 'ExplicitAuthentication':
          credentials = { ...explicit }
          break
        case 'Ignored':
          return
      }
      const staged: Parameters<typeof this.staged.push>[0] = {
        kind: decision.kind,
        credentials,
        startedAt: snapshot.startedAt,
        url: snapshot.submittedUrl,
        baseline: decision.baseline,
      }
      this.staged.push(staged)
    } finally {
      values.fill('')
      explicit.username = ''
      explicit.password = ''
    }
  }
  async submit(): Promise<void> {
    const form = document.querySelector('form')
    switch (form instanceof HTMLFormElement) {
      case false:
        throw new Error('expected submitted form')
      case true:
        break
    }
    const options: SubmitEventInit = { bubbles: true, cancelable: true }
    const submitter = form.querySelector('button')
    switch (submitter instanceof HTMLButtonElement) {
      case true:
        options.submitter = submitter
        break
      case false:
        break
    }
    const event = new SubmitEvent('submit', options)
    const trust: PropertyDescriptor = { value: true }
    Object.defineProperty(event, 'isTrusted', trust)
    let operation = Promise.resolve()
    const listenerOptions: AddEventListenerOptions = {
      once: true,
      capture: true,
    }
    form.addEventListener(
      'submit',
      (received) => {
        operation = this.capture.capture(received)
      },
      listenerOptions,
    )
    form.dispatchEvent(event)
    await operation
  }
  async enter(selector: string): Promise<void> {
    const field = document.querySelector(selector)
    switch (true) {
      case field instanceof HTMLInputElement:
        break
      case true:
        throw new Error('expected Enter target')
    }
    const options: KeyboardEventInit = { key: 'Enter', bubbles: true }
    const event = new KeyboardEvent('keydown', options)
    const trust: PropertyDescriptor = { value: true }
    Object.defineProperty(event, 'isTrusted', trust)
    let operation = Promise.resolve()
    const listenerOptions: AddEventListenerOptions = {
      once: true,
      capture: true,
    }
    field.addEventListener(
      'keydown',
      (received) => {
        operation = this.capture.capture(received)
      },
      listenerOptions,
    )
    field.dispatchEvent(event)
    await operation
  }
  async click(selector: string): Promise<void> {
    const control = document.querySelector(selector)
    switch (true) {
      case control instanceof HTMLElement:
        break
      case true:
        throw new Error('expected Click target')
    }
    const options: MouseEventInit = { bubbles: true }
    const event = new MouseEvent('click', options)
    const trust: PropertyDescriptor = { value: true }
    Object.defineProperty(event, 'isTrusted', trust)
    let operation = Promise.resolve()
    const listenerOptions: AddEventListenerOptions = {
      once: true,
      capture: true,
    }
    control.addEventListener(
      'click',
      (received) => {
        operation = this.capture.capture(received)
      },
      listenerOptions,
    )
    control.dispatchEvent(event)
    await operation
  }
}

enum LoginCaptureFailureMode {
  Synchronous = 'synchronous',
  Rejected = 'rejected',
}
class LoginCaptureFailureFixture {
  readonly snapshots: LoginSubmissionDomSnapshot[] = []
  private readonly runtime: ConstructorParameters<
    typeof LoginSubmissionCapture
  >[0] = { stage: this.stage.bind(this) }
  private readonly capture = new LoginSubmissionCapture(this.runtime)
  constructor(private readonly mode: LoginCaptureFailureMode) {}
  private stage({ snapshot }: CapturedLoginSubmission): Promise<void> {
    this.snapshots.push(snapshot)
    switch (this.mode) {
      case LoginCaptureFailureMode.Synchronous:
        throw new Error('untrusted credential-bearing exception')
      case LoginCaptureFailureMode.Rejected:
        return Promise.reject(
          new Error('untrusted credential-bearing exception'),
        )
    }
  }
  submit(): Effect.Effect<void, LoginSubmissionCaptureFailure> {
    const form = document.querySelector('form')
    switch (true) {
      case form instanceof HTMLFormElement:
        break
      case true:
        throw new Error('expected submitted form')
    }
    const options: SubmitEventInit = { bubbles: true }
    const event = new SubmitEvent('submit', options)
    const trust: PropertyDescriptor = { value: true }
    Object.defineProperty(event, 'isTrusted', trust)
    form.dispatchEvent(event)
    return this.capture.captureEffect(event)
  }
}

afterEach(() => {
  const navigationState: Record<string, never> = {}
  vi.useRealTimers()
  document.body.replaceChildren()
  history.replaceState(navigationState, '', '/')
})

describe('submitted login capture through the typed classifier', () => {
  test('retains bounded typed failures and disposes snapshots for synchronous and rejected staging', async () => {
    for (const mode of [
      LoginCaptureFailureMode.Synchronous,
      LoginCaptureFailureMode.Rejected,
    ]) {
      document.body.innerHTML =
        '<form><input autocomplete="username" value="user"><input type="password" autocomplete="current-password" value="secret"></form>'
      const fixture = new LoginCaptureFailureFixture(mode)
      const result = await Effect.runPromise(Effect.result(fixture.submit()))
      switch (result._tag) {
        case 'Success':
          throw new Error('staging failure must remain failed')
        case 'Failure':
          expect(result.failure).toBeInstanceOf(LoginSubmissionCaptureFailure)
          expect(result.failure.kind).toBe(SessionOperationFailureKind.Failed)
          expect(Reflect.has(result.failure, 'cause')).toBe(false)
          break
      }
      expect(fixture.snapshots).toHaveLength(1)
      expect(fixture.snapshots[0]?.capturedValues()).toEqual([])
    }
  })
  test('Rust rejects the entire overflowing scope including a late OTP rather than a credential prefix', async () => {
    const subsequentInputCount: ArrayLike<string> = { length: 98 }
    const laterInputs = Array.from(
      subsequentInputCount,
      () => '<input type="text">',
    ).join('')
    document.body.innerHTML = `<form><input autocomplete="username" value="user"><input type="password" autocomplete="current-password" value="secret">${laterInputs}<input autocomplete="one-time-code" value="123456"><button>Sign in</button></form>`
    const fixture = new LoginSaveCaptureFixture()
    await expect(fixture.submit()).rejects.toThrow()
    expect(fixture.ingress[0]?.capture.fields).toHaveLength(101)
    expect(
      fixture.ingress[0]?.capture.fields.at(-1)?.autocomplete_tokens,
    ).toEqual(['one-time-code'])
    expect(fixture.staged).toEqual([])
    expect(fixture.ingress[0]?.values.every((value) => value === '')).toBe(true)
  })
  test('native submission preserves pre-handler credentials and the exact password', async () => {
    document.body.innerHTML =
      '<form><input autocomplete="username" value="user"><input type="password" autocomplete="current-password" value="  exact password  "><button>Sign in</button></form>'
    const fixture = new LoginSaveCaptureFixture()
    document
      .querySelector('form')
      ?.addEventListener('submit', () => document.body.replaceChildren())
    await fixture.submit()
    expect(fixture.staged).toMatchObject([
      {
        kind: 'SubmittedLogin',
        credentials: { username: 'user', password: '  exact password  ' },
      },
    ])
  })
  test('ordinary native submission without a submitter is captured once', async () => {
    document.body.innerHTML =
      '<form><input autocomplete="username" value="user"><input type="password" autocomplete="current-password" value="secret"></form>'
    const fixture = new LoginSaveCaptureFixture()
    await fixture.submit()
    expect(fixture.staged).toHaveLength(1)
  })
  test('the same raw control projection captures Continue, localized and icon-only semantic clicks', async () => {
    for (const control of [
      '<button type="button">Continue</button>',
      '<button type="submit">Weiter</button>',
      '<button type="submit" aria-label="登入"><svg></svg></button>',
    ]) {
      document.body.innerHTML = `<main><div><input autocomplete="username" value="user"><input type="password" autocomplete="current-password" value="secret">${control}</div></main>`
      const fixture = new LoginSaveCaptureFixture()
      await fixture.click('button')
      expect(fixture.staged).toMatchObject([
        {
          kind: 'SubmittedLogin',
          credentials: { username: 'user', password: 'secret' },
        },
      ])
    }
  })
  test('password change retains its separate explicit-authentication source and replacement selection', async () => {
    document.body.innerHTML =
      '<form id="change-password"><input autocomplete="username" value="user"><input type="password" autocomplete="current-password" value="old"><input type="password" autocomplete="new-password" value="  replacement  "><input type="password" autocomplete="new-password" value="  replacement  "><button>Update password</button></form>'
    const fixture = new LoginSaveCaptureFixture()
    await fixture.submit()
    expect(fixture.staged).toMatchObject([
      {
        kind: 'ExplicitAuthentication',
        credentials: { username: 'user', password: '  replacement  ' },
      },
    ])
  })
  test('registration never stages a generic submitted login', async () => {
    document.body.innerHTML =
      '<form id="signup"><input autocomplete="username" value="user"><input type="password" autocomplete="new-password" value="new"><input type="password" autocomplete="new-password" value="new"><button>Create account</button></form>'
    const fixture = new LoginSaveCaptureFixture()
    await fixture.submit()
    expect(fixture.staged).toMatchObject([{ kind: 'ExplicitAuthentication' }])
  })
  test('disabled capture prevents new ownership', async () => {
    document.body.innerHTML =
      '<form><input autocomplete="username" value="user"><input type="password" value="secret"><button>Sign in</button></form>'
    const fixture = new LoginSaveCaptureFixture()
    fixture.capture.discard()
    await fixture.submit()
    fixture.capture.discard()
    fixture.capture.enable()
    expect(fixture.staged).toEqual([])
  })
  test('Enter from a sibling search input cannot submit credentials in a shared ancestor', async () => {
    document.body.innerHTML =
      '<main><div><div><input id="search" type="search" aria-label="Search" value="query"></div><div><input autocomplete="username" value="user"><input type="password" autocomplete="current-password" value="secret"></div></div></main>'
    const fixture = new LoginSaveCaptureFixture()
    await fixture.enter('#search')
    const expectedTarget: LoginSubmissionCaptureRecord['intent']['target'] = {
      kind: 'CredentialField',
      field_index: { value: 0 },
    }
    expect(fixture.ingress[0]?.capture.intent.target).toEqual(expectedTarget)
    expect(fixture.staged).toEqual([])
    await fixture.enter('input[autocomplete="username"]')
    expect(fixture.staged).toMatchObject([
      {
        kind: 'SubmittedLogin',
        credentials: { username: 'user', password: 'secret' },
      },
    ])
  })
  test('first ingress owns native credentials while classification is pending and recovers a navigation baseline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    document.body.innerHTML =
      '<form><input autocomplete="username" value="user"><input type="password" autocomplete="current-password" value="  exact password  "><button>Sign in</button></form>'
    const fixture = new LoginSaveCaptureFixture()
    const release = fixture.holdFirstIngress()
    const operation = fixture.submit()
    expect(fixture.ingress).toHaveLength(1)
    expect(fixture.ingress[0]?.values).toEqual(['user', '  exact password  '])
    document.body.replaceChildren()
    const navigationState: Record<string, never> = {}
    history.replaceState(navigationState, '', '/account')
    expect(fixture.ingress[0]?.values).toEqual(['user', '  exact password  '])
    release()
    await operation
    const staged = fixture.staged[0]
    switch (typeof staged) {
      case 'object':
        break
      default:
        throw new Error('expected owned staged login')
    }
    expect(staged.credentials.password).toBe('  exact password  ')
    expect(fixture.ingress[0]?.values).toEqual(['', ''])
    const request: LoginSaveOutcomeSensorRequest = {
      baseline: staged.baseline,
      submittedNodes: [],
      navigationMode: LoginSaveNavigationMode.DocumentNavigation,
    }
    const sensor = new LoginSaveOutcomeSensor(request)
    await sensor.collect()
    vi.setSystemTime(1750)
    const evidence = await sensor.collect()
    switch (evidence.kind) {
      case 'SubmittedLogin':
        expect((await sensor.eligibility(evidence)).eligibility).toBe(
          'Eligible',
        )
        break
      case 'ExplicitAuthentication':
        throw new Error('expected submitted login')
    }
    expect(staged.baseline.submitted_at).toBe(1000)
  })
})
