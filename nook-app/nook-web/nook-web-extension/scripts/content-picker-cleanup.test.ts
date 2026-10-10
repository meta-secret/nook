import { expect, mock, test } from 'bun:test'
import { Schema } from 'effect'
import { Window } from 'happy-dom'
import {
  LoginSaveNavigationMode,
  LoginSaveOutcomeSensor,
  type LoginSaveOutcomeSensorRequest,
} from '../src/content/autofill/login-save-outcome-sensor'
import type { PendingSaveWatch } from '../src/content/autofill/state'
import {
  CompanionWasmContentResponseKind,
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { handleCompanionWasmMessage } from '../src/offscreen/session-companion-wasm-operations'
import type { PasswordFormObservation } from '../../nook-web-shared/src/extension/password-forms'
import { PasswordFormScopeKind } from '../../nook-web-shared/src/extension/password-forms'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
import type {
  WebsiteLoginSaveActionResponse,
  WebsiteLoginSaveOfferView,
  WebsiteLoginSaveOfferMessage,
  WebsiteLoginSaveOfferResponse,
} from '../src/lib/login-save-messages'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { AuthenticationWorkflowActivity } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  AuthenticationWorkflowApproval,
  AuthenticationWorkflowSnapshotIngress,
} from '../src/lib/auth-workflow-messages'

type NativeSaveBrowserGlobals = Pick<
  Window,
  | 'document'
  | 'location'
  | 'Element'
  | 'HTMLElement'
  | 'HTMLFormElement'
  | 'HTMLInputElement'
  | 'HTMLButtonElement'
  | 'SubmitEvent'
  | 'KeyboardEvent'
  | 'MutationObserver'
  | 'NodeFilter'
  | 'getComputedStyle'
> & { window: Window }
type ClearedLoginCaptureExpectation = {
  payload: Pick<
    WebsiteLoginSaveOfferMessage['payload'],
    'username' | 'password' | 'capturedValues'
  >
}

await companionWasmReady

function pickerApproval(): AuthenticationWorkflowApproval {
  const admission = AuthenticationWorkflowSnapshotIngress.admit({
    type: 'nook:authentication-workflow-snapshot',
    payload: {
      origin: 'https://login.example.test',
      observations: [
        {
          fields: {
            usernameFieldCount: 1,
            currentPasswordFieldCount: 1,
            newPasswordFieldCount: 0,
            genericPasswordFieldCount: 0,
            oneTimeCodeFieldCount: 0,
            actionablePasswordFieldCount: 1,
            readonlyPasswordFieldCount: 0,
          },
          ceremony: {
            oneTimeCodeProgression: 'advance-control-required',
            oneTimeCodeHandlerSignal: '',
            authenticationContext: {
              authenticationUsername: 'explicit',
              sourceOrigin: 'https://login.example.test',
              formIdentity: 'login',
              destinationIdentity: '/login',
            },
            manualCheckpoint: 'absent',
            advanceControl: 'absent',
          },
          authenticator: {
            authenticatorSetup: 'absent',
            backupCodesCopy: '',
            passkeyControl: 'absent',
            passkeyAccountAvailability: 'unavailable',
            matchingPasskeyAccountCount: 0,
            detailedPasskeyControl: { kind: 'absent' },
          },
          credentialSubmission: { kind: 'absent' },
          detailedAdvanceControl: { kind: 'absent' },
        },
      ],
    },
  })
  if (admission.kind !== 'accepted') {
    throw new Error('picker approval fixture must be admitted')
  }
  const [facts] = admission.message.payload.observations
  if (!facts) throw new Error('picker approval fixture requires facts')
  return {
    workflowKey: 'login:cleanup',
    facts,
  }
}

const addListener = mock(() => {})
class ContentPickerDocumentFixture {
  install(): void {
    Object.assign(globalThis, {
      document: {
        createElement: () => this.fakeElement(),
      },
    })
  }

  private fakeElement() {
    return {
      disabled: false,
      hidden: false,
      isConnected: true,
      remove: mock(() => {}),
      replaceChildren: mock(() => {}),
      append: mock(() => {}),
      textContent: '',
    }
  }
}
new ContentPickerDocumentFixture().install()
type NativeSaveCaptureHandler = {
  readonly captureSubmission: (event: Event) => Promise<void>
}
class NativeSaveCaptureFixture {
  private readonly previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    HTMLFormElement: globalThis.HTMLFormElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLButtonElement: globalThis.HTMLButtonElement,
    SubmitEvent: globalThis.SubmitEvent,
    KeyboardEvent: globalThis.KeyboardEvent,
    MutationObserver: globalThis.MutationObserver,
    NodeFilter: globalThis.NodeFilter,
    getComputedStyle: globalThis.getComputedStyle,
  }
  private readonly options = { url: 'https://login.example.test/login' }
  private readonly browser = new Window(this.options)
  install(): void {
    const browser = this.browser
    const globals: NativeSaveBrowserGlobals = {
      window: browser,
      document: browser.document,
      location: browser.location,
      Element: browser.Element,
      HTMLElement: browser.HTMLElement,
      HTMLFormElement: browser.HTMLFormElement,
      HTMLInputElement: browser.HTMLInputElement,
      HTMLButtonElement: browser.HTMLButtonElement,
      SubmitEvent: browser.SubmitEvent,
      KeyboardEvent: browser.KeyboardEvent,
      MutationObserver: browser.MutationObserver,
      NodeFilter: browser.NodeFilter,
      getComputedStyle: browser.getComputedStyle.bind(browser),
    }
    Object.assign(globalThis, globals)
    document.body.innerHTML =
      '<form><input autocomplete="username" value="person@example.test"><input type="password" autocomplete="current-password" value="submitted-password"><button>Sign in</button></form>'
  }
  capture(handler: NativeSaveCaptureHandler): Promise<void> {
    const form = document.querySelector('form')
    switch (true) {
      case form instanceof HTMLFormElement:
        break
      case true:
      default:
        throw new Error('expected native save fixture')
    }
    const options: SubmitEventInit = { bubbles: true }
    const event = new SubmitEvent('submit', options)
    const trust: PropertyDescriptor = { value: true }
    Object.defineProperty(event, 'isTrusted', trust)
    let operation = Promise.resolve()
    const listener: AddEventListenerOptions = { once: true, capture: true }
    form.addEventListener(
      'submit',
      (received) => {
        operation = handler.captureSubmission(received)
      },
      listener,
    )
    form.dispatchEvent(event)
    return operation
  }
  offer(offerId: string): WebsiteLoginSaveOfferView {
    return {
      offerId,
      decision: 0,
      vaultStoreId: 'vault-1',
      vaultName: 'Personal',
      baseline: {
        source: 'SubmittedLogin',
        submitted_at: Date.now(),
        submitted_url: new URL('/login', location.origin).href,
        captured_workflow: 0,
        initial_auth_fields: 'Present',
        controls: [],
      },
      selection: {
        kind: 'SubmittedLogin',
        username_field_index: { value: 0 },
        password_field_index: { value: 1 },
      },
    }
  }
  watch(offerId: string): PendingSaveWatch {
    const offer = this.offer(offerId)
    const request: LoginSaveOutcomeSensorRequest = {
      baseline: offer.baseline,
      submittedNodes: [],
      navigationMode: LoginSaveNavigationMode.SameDocument,
    }
    return {
      offer,
      sensor: new LoginSaveOutcomeSensor(request),
      startedAt: offer.baseline.submitted_at,
      authPath: '/login',
      sawMutation: false,
    }
  }
  restore(): void {
    Object.assign(globalThis, this.previous)
  }
}
type RuntimeResponseCallback = (response: unknown) => void

enum RuntimeResponseStateKind {
  Immediate = 'immediate',
  Deferred = 'deferred',
  Waiting = 'waiting',
}

type RuntimeResponseState =
  | {
      kind: RuntimeResponseStateKind.Immediate
      response: unknown
    }
  | { kind: RuntimeResponseStateKind.Deferred }
  | {
      kind: RuntimeResponseStateKind.Waiting
      callback: RuntimeResponseCallback
    }

let runtimeResponseState: RuntimeResponseState = {
  kind: RuntimeResponseStateKind.Immediate,
  response: { kind: 'completed' } satisfies WebsiteLoginSaveActionResponse,
}

function useImmediateRuntimeResponse(response: unknown): void {
  runtimeResponseState = { kind: RuntimeResponseStateKind.Immediate, response }
}

function deferRuntimeResponse(): void {
  runtimeResponseState = { kind: RuntimeResponseStateKind.Deferred }
}

function resolveDeferredRuntimeResponse({
  response,
  subsequentResponse,
}: {
  response: unknown
  subsequentResponse: unknown
}): void {
  if (runtimeResponseState.kind !== RuntimeResponseStateKind.Waiting) {
    throw new Error('deferred runtime response unavailable')
  }
  const { callback } = runtimeResponseState
  useImmediateRuntimeResponse(subsequentResponse)
  callback(response)
}

function routeCompanionFixture(
  message: unknown,
  callback: RuntimeResponseCallback,
): boolean {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    !('payload' in message) ||
    !message.payload ||
    typeof message.payload !== 'object'
  )
    return false
  let request: CompanionWasmSessionMessage
  switch (message.type) {
    case CompanionWasmSessionMessageType.DecodeContentRuntimeResponse: {
      if (!('kind' in message.payload) || !('response' in message.payload))
        throw new Error('Invalid decoder fixture request')
      const kind = Schema.decodeUnknownSync(
        Schema.Enum(CompanionWasmContentResponseKind),
      )(message.payload.kind)
      request = {
        type: message.type,
        payload: { kind, response: message.payload.response },
      }
      break
    }
    case CompanionWasmSessionMessageType.ProjectAuthenticationNavigationPath: {
      if (
        !('pathname' in message.payload) ||
        typeof message.payload.pathname !== 'string'
      )
        throw new Error('Invalid navigation fixture request')
      request = {
        type: message.type,
        payload: { pathname: message.payload.pathname },
      }
      break
    }
    case CompanionWasmSessionMessageType.ExtractAuthenticationBackupCodeCandidates: {
      if (
        !('text' in message.payload) ||
        typeof message.payload.text !== 'string'
      )
        throw new Error('Invalid extraction fixture request')
      request = { type: message.type, payload: { text: message.payload.text } }
      break
    }
    default:
      return false
  }
  void handleCompanionWasmMessage(request).then((result) =>
    result.match(
      (value) => callback({ ok: true, result: value }),
      () => callback({ ok: false }),
    ),
  )
  return true
}

function isSaveActionCall(parameters: readonly unknown[]): boolean {
  const message = parameters[0]
  return Boolean(
    message &&
    typeof message === 'object' &&
    'type' in message &&
    typeof message.type === 'string' &&
    message.type.startsWith('nook:website-login-save-'),
  )
}

const sendMessage = mock(
  (_message: unknown, callback: RuntimeResponseCallback) => {
    if (routeCompanionFixture(_message, callback)) return
    if (runtimeResponseState.kind === RuntimeResponseStateKind.Immediate) {
      callback(runtimeResponseState.response)
      return
    }
    if (runtimeResponseState.kind === RuntimeResponseStateKind.Waiting) {
      throw new Error('runtime response already waiting')
    }
    runtimeResponseState = {
      kind: RuntimeResponseStateKind.Waiting,
      callback,
    }
  },
)
Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
  chrome: {
    i18n: { getMessage: () => 'Picker canceled' },
    runtime: {
      id: 'nook-extension',
      lastError: false,
      onMessage: { addListener },
      sendMessage,
    },
  },
  location: { origin: 'https://login.example.test', pathname: '/login' },
  window: { clearTimeout: mock(() => {}) },
})

type RefreshResponse = { ok: true } | { ok: false }

function captureRefreshResponse(): {
  sendResponse: (response: RefreshResponse) => void
  response: Promise<RefreshResponse>
} {
  let resolveResponse: ((response: RefreshResponse) => void) | false = false
  const response = new Promise<RefreshResponse>((resolve) => {
    resolveResponse = resolve
  })
  return {
    sendResponse: (value) => {
      if (!resolveResponse)
        throw new Error('refresh response capture unavailable')
      resolveResponse(value)
    },
    response,
  }
}

test('delivers cleanup cancellation through the content-script router', async () => {
  const { LoginPickerKind, pickerState } =
    await import('../src/content/autofill/state')
  const { routeAutofillMessage } =
    await import('../src/content/autofill/message-router')
  const description = document.createElement('p')
  const continueButton = document.createElement('button')
  continueButton.disabled = true
  continueButton.hidden = false
  const workflow: PasswordFormObservation = {
    root: document,
    formScope: { kind: PasswordFormScopeKind.Unowned },
    summary: {
      passwordFieldCount: 1,
      currentPasswordFieldCount: 1,
      newPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      usernameFieldCount: 1,
      oneTimeCodeFieldCount: 0,
      manualCheckpointPresent: false,
      passkeyControlPresent: false,
      formCount: 1,
      observedAt: 1,
    },
  }
  const step = document.createElement('p')
  const title = document.createElement('h2')
  const closeSurface = mock(() => {})
  pickerState.openLogin({
    requestId: 'login-request',
    workflow,
    step,
    title,
    description,
    continueButton,
    timeoutId: 7,
    surface: { close: closeSurface },
    approval: pickerApproval(),
  })
  const sendResponse = mock(() => {})

  routeAutofillMessage(
    {
      type: 'nook:website-login-canceled',
      payload: {
        origin: 'https://login.example.test',
        requestId: 'login-request',
      },
    },
    { id: 'nook-extension' },
    sendResponse,
  )

  expect(pickerState.login.kind).toBe(LoginPickerKind.Closed)
  expect(closeSurface).toHaveBeenCalledTimes(1)
  expect(description.textContent).toBe('Picker canceled')
  expect(continueButton.disabled).toBe(false)
  expect(sendResponse).toHaveBeenCalledWith({ ok: true })
})

for (const invalidateSequence of [true, false]) {
  test(`rejects delayed save projection after ${invalidateSequence ? 'scan invalidation' : 'offer replacement'}`, async () => {
    const { saveOfferState, scanState, widgetState } =
      await import('../src/content/autofill/state')
    const { loginSaveInteraction } =
      await import('../src/content/autofill/login-save')
    const offer: WebsiteLoginSaveOfferView =
      new NativeSaveCaptureFixture().offer('delayed-save')
    saveOfferState.showOffer(offer)
    const priorHost = widgetState.host
    const callbacks: RuntimeResponseCallback[] = []
    sendMessage.mockImplementationOnce((_message, callback) => {
      callbacks.push(callback)
    })
    const rendering = loginSaveInteraction.renderSaveOfferWidget(offer)
    if (invalidateSequence) scanState.invalidatePendingScan()
    else saveOfferState.showOffer({ ...offer })
    const callback = callbacks.shift()
    if (!callback) throw new Error('Expected delayed progress request')
    const request: CompanionWasmSessionMessage = {
      type: CompanionWasmSessionMessageType.GetAuthenticationActivityProgress,
      payload: { activity: AuthenticationWorkflowActivity.SaveOffer },
    }
    const result = await handleCompanionWasmMessage(request)
    result.match(
      (value) => callback({ ok: true, result: value }),
      () => {
        throw new Error('Expected actual Rust progress')
      },
    )
    expect(await rendering).toBe(false)
    expect(widgetState.host).toBe(priorHost)
    saveOfferState.clearActiveOffer()
  })
}

test('refresh preserves dismissal while clearing stale surface state', async () => {
  useImmediateRuntimeResponse({
    kind: 'completed',
  } satisfies WebsiteLoginSaveActionResponse)
  sendMessage.mockClear()
  const {
    SavePageWatchKind,
    WidgetHostKind,
    saveOfferState,
    scanState,
    widgetState,
  } = await import('../src/content/autofill/state')
  const { routeAutofillMessage } =
    await import('../src/content/autofill/message-router')
  const remove = mock(() => {})
  const host = document.createElement('div')
  host.remove = remove
  widgetState.attachHost(host)
  widgetState.dismissed = true
  widgetState.busy = true
  const staleOfferId = 'stale-save-offer'
  const pendingWatch: PendingSaveWatch = new NativeSaveCaptureFixture().watch(
    staleOfferId,
  )
  saveOfferState.watchPage(pendingWatch)
  const schedule = mock(() => {})
  scanState.schedule = schedule
  const responseCapture = captureRefreshResponse()
  const sendResponse = mock(responseCapture.sendResponse)

  routeAutofillMessage(
    { type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces },
    { id: 'nook-extension' },
    sendResponse,
  )

  expect(widgetState.dismissed).toBe(true)
  expect(widgetState.busy).toBe(false)
  expect(widgetState.host.kind).toBe(WidgetHostKind.Detached)
  expect(schedule).not.toHaveBeenCalled()
  expect(sendResponse).not.toHaveBeenCalled()
  expect(await responseCapture.response).toEqual({ ok: true })
  expect(saveOfferState.watch.kind).toBe(SavePageWatchKind.Idle)
  expect(saveOfferState.dismissedOfferIds.has(staleOfferId)).toBe(true)
  expect(sendMessage).toHaveBeenCalledWith(
    {
      type: 'nook:website-login-save-dismiss',
      payload: {
        origin: 'https://login.example.test',
        offerId: staleOfferId,
      },
    },
    expect.any(Function),
  )
  expect(remove).toHaveBeenCalledTimes(1)
  expect(schedule).toHaveBeenCalledTimes(1)
  expect(sendResponse).toHaveBeenCalledWith({ ok: true })
})

test('refresh does not rescan when staged offer dismissal is rejected', async () => {
  const { saveOfferState, scanState, widgetState } =
    await import('../src/content/autofill/state')
  const { routeAutofillMessage } =
    await import('../src/content/autofill/message-router')
  const remove = mock(() => {})
  const host = document.createElement('div')
  host.remove = remove
  widgetState.attachHost(host)
  const pendingWatch: PendingSaveWatch = new NativeSaveCaptureFixture().watch(
    'rejected-save-offer',
  )
  saveOfferState.watchPage(pendingWatch)
  useImmediateRuntimeResponse({
    kind: 'rejected',
    reason: 'login-save-dismiss-failed',
  } satisfies WebsiteLoginSaveActionResponse)
  const schedule = mock(() => {})
  scanState.schedule = schedule
  const responseCapture = captureRefreshResponse()
  const sendResponse = mock(responseCapture.sendResponse)

  routeAutofillMessage(
    { type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces },
    { id: 'nook-extension' },
    sendResponse,
  )
  expect(await responseCapture.response).toEqual({ ok: false })

  expect(remove).toHaveBeenCalledTimes(1)
  expect(schedule).not.toHaveBeenCalled()
  expect(sendResponse).toHaveBeenCalledWith({ ok: false })
})

test('AlreadySaved clears the prior local save watch and prompt while rejected capture preserves them', async () => {
  const {
    SaveOfferDisplayKind,
    SavePageWatchKind,
    WidgetHostKind,
    saveOfferState,
    widgetState,
  } = await import('../src/content/autofill/state')
  const { loginSaveInteraction } =
    await import('../src/content/autofill/login-save')
  const native = new NativeSaveCaptureFixture()
  native.install()
  const originalClearInterval = window.clearInterval
  const clearInterval = mock(() => {})
  window.clearInterval = clearInterval
  const observer = new MutationObserver(() => {})
  const disconnect = mock(() => {})
  observer.disconnect = disconnect
  const pendingWatch: PendingSaveWatch = native.watch('prior-duplicate-offer')
  pendingWatch.timer = 7
  pendingWatch.observer = observer
  saveOfferState.watchPage(pendingWatch)
  saveOfferState.showOffer(pendingWatch.offer)
  const host = document.createElement('div')
  document.body.append(host)
  widgetState.attachHost(host)
  try {
    const rejected: WebsiteLoginSaveOfferResponse = {
      kind: 'rejected',
      reason: 'login-save-plan-failed',
    }
    useImmediateRuntimeResponse(rejected)
    await native.capture(loginSaveInteraction)
    expect(saveOfferState.watch.kind).toBe(SavePageWatchKind.Watching)
    expect(saveOfferState.display.kind).toBe(SaveOfferDisplayKind.Visible)
    expect(host.isConnected).toBe(true)
    expect(disconnect).not.toHaveBeenCalled()

    const alreadySaved: WebsiteLoginSaveOfferResponse = { kind: 'not-required' }
    useImmediateRuntimeResponse(alreadySaved)
    await native.capture(loginSaveInteraction)
    expect(saveOfferState.watch.kind).toBe(SavePageWatchKind.Idle)
    expect(saveOfferState.display.kind).toBe(SaveOfferDisplayKind.Hidden)
    expect(widgetState.host.kind).toBe(WidgetHostKind.Detached)
    expect(host.isConnected).toBe(false)
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(clearInterval).toHaveBeenCalledWith(7)
    await loginSaveInteraction.evaluatePendingSaveEvidence()
    expect(saveOfferState.display.kind).toBe(SaveOfferDisplayKind.Hidden)
  } finally {
    loginSaveInteraction.stopPendingSaveWatch()
    window.clearInterval = originalClearInterval
    native.restore()
  }
})

test('keeps a submitted login offer when the success page advances the scan', async () => {
  const { SavePageWatchKind, saveOfferState, scanState } =
    await import('../src/content/autofill/state')
  const { loginSaveInteraction } =
    await import('../src/content/autofill/login-save')
  const native = new NativeSaveCaptureFixture()
  native.install()
  const originalMutationObserver = globalThis.MutationObserver
  const originalSetInterval = window.setInterval
  const originalClearInterval = window.clearInterval
  const originalDocumentElement = document.documentElement
  const originalEvaluatePendingSaveEvidence =
    loginSaveInteraction.evaluatePendingSaveEvidence
  loginSaveInteraction.evaluatePendingSaveEvidence = async () => {}
  class SubmittedLoginMutationObserver {
    observe(): void {}
    disconnect(): void {}
    takeRecords(): MutationRecord[] {
      return []
    }
  }
  Object.assign(globalThis, {
    MutationObserver: SubmittedLoginMutationObserver,
  })
  Object.defineProperty(document, 'documentElement', {
    configurable: true,
    value: {},
  })
  Object.assign(window, {
    setInterval: () => 7,
    clearInterval: () => {},
  })
  deferRuntimeResponse()
  sendMessage.mockClear()
  const initialSequence = scanState.sequence
  const staging = native.capture(loginSaveInteraction)
  scanState.sequence = initialSequence + 1

  resolveDeferredRuntimeResponse({
    response: {
      kind: 'offer-available',
      offer: native.offer('successful-submit-offer'),
    },
    subsequentResponse: { kind: 'unavailable' },
  })
  await staging

  expect(saveOfferState.watch.kind).toBe(SavePageWatchKind.Watching)
  const expectedClearedCapture: ClearedLoginCaptureExpectation = {
    payload: { username: '', password: '', capturedValues: ['', ''] },
  }
  expect(sendMessage.mock.calls.filter(isSaveActionCall)[0]?.[0]).toMatchObject(
    expectedClearedCapture,
  )
  expect(sendMessage.mock.calls.filter(isSaveActionCall)).toHaveLength(1)

  loginSaveInteraction.stopPendingSaveWatch()
  Object.assign(globalThis, { MutationObserver: originalMutationObserver })
  Object.defineProperty(document, 'documentElement', {
    configurable: true,
    value: originalDocumentElement,
  })
  loginSaveInteraction.evaluatePendingSaveEvidence =
    originalEvaluatePendingSaveEvidence
  Object.assign(window, {
    setInterval: originalSetInterval,
    clearInterval: originalClearInterval,
  })
  native.restore()
})

test('refresh dismisses an in-flight save offer before rescanning', async () => {
  const { SavePageWatchKind, scanState, saveOfferState } =
    await import('../src/content/autofill/state')
  const { loginSaveInteraction } =
    await import('../src/content/autofill/login-save')
  const native = new NativeSaveCaptureFixture()
  native.install()
  const originalEvaluatePendingSaveEvidence =
    loginSaveInteraction.evaluatePendingSaveEvidence
  loginSaveInteraction.evaluatePendingSaveEvidence = async () => {}
  const originalMutationObserver = globalThis.MutationObserver
  const originalSetInterval = window.setInterval
  const originalClearInterval = window.clearInterval
  class RefreshMutationObserver {
    observe(): void {}
    disconnect(): void {}
    takeRecords(): MutationRecord[] {
      return []
    }
  }
  Object.assign(globalThis, { MutationObserver: RefreshMutationObserver })
  Object.assign(window, {
    setInterval: () => 7,
    clearInterval: () => {},
  })
  const { routeAutofillMessage } =
    await import('../src/content/autofill/message-router')
  deferRuntimeResponse()
  sendMessage.mockClear()
  const staging = native.capture(loginSaveInteraction)
  const schedule = mock(() => {})
  scanState.schedule = schedule
  const responseCapture = captureRefreshResponse()
  const sendResponse = mock(responseCapture.sendResponse)

  routeAutofillMessage(
    { type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces },
    { id: 'nook-extension' },
    sendResponse,
  )
  expect(schedule).not.toHaveBeenCalled()
  expect(sendResponse).not.toHaveBeenCalled()

  resolveDeferredRuntimeResponse({
    response: {
      kind: 'offer-available',
      offer: native.offer('in-flight-offer'),
    },
    subsequentResponse: {
      kind: 'completed',
    } satisfies WebsiteLoginSaveActionResponse,
  })
  await staging
  expect(await responseCapture.response).toEqual({ ok: true })

  const expectedClearedCapture: ClearedLoginCaptureExpectation = {
    payload: { username: '', password: '', capturedValues: ['', ''] },
  }
  expect(sendMessage.mock.calls.filter(isSaveActionCall)[0]?.[0]).toMatchObject(
    expectedClearedCapture,
  )
  expect(saveOfferState.watch.kind).toBe(SavePageWatchKind.Idle)
  expect(sendMessage.mock.calls.filter(isSaveActionCall).at(-1)).toEqual([
    {
      type: 'nook:website-login-save-dismiss',
      payload: {
        origin: 'https://login.example.test',
        offerId: 'in-flight-offer',
      },
    },
    expect.any(Function),
  ])
  expect(schedule).toHaveBeenCalledTimes(1)
  loginSaveInteraction.evaluatePendingSaveEvidence =
    originalEvaluatePendingSaveEvidence
  Object.assign(globalThis, { MutationObserver: originalMutationObserver })
  Object.assign(window, {
    setInterval: originalSetInterval,
    clearInterval: originalClearInterval,
  })
  native.restore()
})
