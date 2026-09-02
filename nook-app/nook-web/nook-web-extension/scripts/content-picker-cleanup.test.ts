import { expect, mock, test } from 'bun:test'
import type { PasswordFormObservation } from '../../nook-web-shared/src/extension/password-forms'
import type { LoginCredentials } from '../../nook-web-shared/src/extension/password-form-field-actions'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
import { BROWSER_MESSAGE_KEYS } from '../src/lib/browser-message-keys'
import type {
  WebsiteLoginSaveActionResponse,
  WebsiteLoginSaveOfferView,
} from '../src/lib/login-save-messages'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import type { DecodedOtpauthCandidate } from '../src/lib/page-qr-capture'
import type { EnrollmentFlowHost } from '../src/content/enrollment-flow'

await companionWasmReady

const addListener = mock(() => {})
type RuntimeResponseCallback = (response: unknown) => void
let runEnrollmentPoll = () => {}

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

const sendMessage = mock(
  (_message: unknown, callback: RuntimeResponseCallback) => {
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
  document: {
    documentElement: {},
    querySelector: () => undefined,
    querySelectorAll: () => [],
  },
  location: {
    origin: 'https://login.example.test',
    pathname: '/enroll',
  },
  MutationObserver: class {
    observe(): void {}
    disconnect(): void {}
  },
  window: {
    clearInterval: mock(() => {}),
    clearTimeout: mock(() => {}),
    setInterval: mock((callback: TimerHandler) => {
      if (typeof callback === 'function') runEnrollmentPoll = callback
      return 1
    }),
  },
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

const deferred = <T>() => Promise.withResolvers<T>()

test('delivers cleanup cancellation through the content-script router', async () => {
  const { LoginPickerKind, pickerState } =
    await import('../src/content/autofill/state')
  const { routeAutofillMessage } =
    await import('../src/content/autofill/message-router')
  const description = { textContent: '' } as HTMLParagraphElement
  const continueButton = {
    disabled: true,
    hidden: false,
    isConnected: true,
  } as HTMLButtonElement
  pickerState.openLogin({
    requestId: 'login-request',
    workflow: {} as PasswordFormObservation,
    step: {} as HTMLParagraphElement,
    title: {} as HTMLHeadingElement,
    description,
    continueButton,
    timeoutId: 7,
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
  expect(description.textContent).toBe('Picker canceled')
  expect(continueButton.disabled).toBe(false)
  expect(sendResponse).toHaveBeenCalledWith({ ok: true })
})

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
  widgetState.attachHost({ remove } as unknown as HTMLElement)
  widgetState.dismissed = true
  widgetState.busy = true
  const staleOfferId = 'stale-save-offer'
  saveOfferState.watchPage({
    offer: { offerId: staleOfferId } as WebsiteLoginSaveOfferView,
    startedAt: 1,
    authPath: '/login',
    sawMutation: false,
  })
  const schedule = mock(() => {})
  scanState.schedule = schedule
  const responseCapture = captureRefreshResponse()
  const sendResponse = mock(responseCapture.sendResponse)

  expect(
    routeAutofillMessage(
      { type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces },
      { id: 'nook-extension' },
      sendResponse,
    ),
  ).toBe(true)
  expect(widgetState.dismissed).toBe(true)
  expect(widgetState.busy).toBe(false)
  expect(widgetState.host.kind).toBe(WidgetHostKind.Attached)
  expect(schedule).not.toHaveBeenCalled()
  expect(sendResponse).not.toHaveBeenCalled()
  await expect(responseCapture.response).resolves.toEqual({ ok: true })
  expect(widgetState.host.kind).toBe(WidgetHostKind.Detached)
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
  expect(remove).toHaveBeenCalledOnce()
  expect(schedule).toHaveBeenCalledOnce()
  expect(sendResponse).toHaveBeenCalledWith({ ok: true })
})

test('refresh does not rescan when staged offer dismissal is rejected', async () => {
  const { saveOfferState, scanState, widgetState } =
    await import('../src/content/autofill/state')
  const { routeAutofillMessage } =
    await import('../src/content/autofill/message-router')
  const remove = mock(() => {})
  widgetState.attachHost({ remove } as unknown as HTMLElement)
  saveOfferState.watchPage({
    offer: { offerId: 'rejected-save-offer' } as WebsiteLoginSaveOfferView,
    startedAt: 1,
    authPath: '/login',
    sawMutation: false,
  })
  useImmediateRuntimeResponse({
    kind: 'rejected',
    reason: 'login-save-dismiss-failed',
  } satisfies WebsiteLoginSaveActionResponse)
  const schedule = mock(() => {})
  scanState.schedule = schedule
  const responseCapture = captureRefreshResponse()
  const sendResponse = mock(responseCapture.sendResponse)

  expect(
    routeAutofillMessage(
      { type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces },
      { id: 'nook-extension' },
      sendResponse,
    ),
  ).toBe(true)
  await expect(responseCapture.response).resolves.toEqual({ ok: false })

  expect(remove).toHaveBeenCalledOnce()
  expect(schedule).not.toHaveBeenCalled()
  expect(sendResponse).toHaveBeenCalledWith({ ok: false })
})

test('refresh dismisses an in-flight save offer before rescanning', async () => {
  const { SavePageWatchKind, scanState, saveOfferState } =
    await import('../src/content/autofill/state')
  const { stageSaveForCredentials } =
    await import('../src/content/autofill/login-save')
  const { routeAutofillMessage } =
    await import('../src/content/autofill/message-router')
  const credentials: LoginCredentials = {
    username: 'person@example.test',
    password: 'secret-password',
  }
  deferRuntimeResponse()
  sendMessage.mockClear()
  const staging = stageSaveForCredentials(credentials)
  const schedule = mock(() => {})
  scanState.schedule = schedule
  const responseCapture = captureRefreshResponse()
  const sendResponse = mock(responseCapture.sendResponse)

  expect(
    routeAutofillMessage(
      { type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces },
      { id: 'nook-extension' },
      sendResponse,
    ),
  ).toBe(true)
  expect(schedule).not.toHaveBeenCalled()
  expect(sendResponse).not.toHaveBeenCalled()

  resolveDeferredRuntimeResponse({
    response: {
      kind: 'offer-available',
      offer: {
        offerId: 'in-flight-offer',
        decision: 0,
        vaultStoreId: 'vault-1',
        vaultName: 'Personal',
      },
    },
    subsequentResponse: {
      kind: 'completed',
    } satisfies WebsiteLoginSaveActionResponse,
  })
  await staging
  await expect(responseCapture.response).resolves.toEqual({ ok: true })

  expect(credentials).toEqual({ username: '', password: '' })
  expect(saveOfferState.watch.kind).toBe(SavePageWatchKind.Idle)
  expect(sendMessage).toHaveBeenLastCalledWith(
    {
      type: 'nook:website-login-save-dismiss',
      payload: {
        origin: 'https://login.example.test',
        offerId: 'in-flight-offer',
      },
    },
    expect.any(Function),
  )
  expect(schedule).toHaveBeenCalledOnce()
})

test('refresh retains staged enrollment UI when dismissal fails', async () => {
  const {
    assignStagedEnrollmentCeremony,
    beginActiveEnrollmentCeremony,
    cancelActiveEnrollmentCeremony,
  } = await import('../src/content/enrollment-flow')
  const { routeAutofillMessage, removeScannedWidget } =
    await import('../src/content/autofill/message-router')
  const { scanState, widgetState } =
    await import('../src/content/autofill/state')
  let dismissalAccepted = false
  const description = { textContent: 'Enrollment retry available' }
  const host = {
    description,
    sendAuthenticatorEnrollmentDismissRuntimeMessage: async () =>
      dismissalAccepted,
  } as EnrollmentFlowHost
  const sensitiveMaterial = {
    uri: { value: '' },
    payload: { otpauthUri: '' },
    candidate: { sourceLabel: '', otpauthUri: '' },
  }
  const generation = beginActiveEnrollmentCeremony({
    host,
    stageId: 'stage-refresh-dismissal',
    sensitiveMaterial,
  })
  expect(
    assignStagedEnrollmentCeremony({
      authorizationGeneration: generation,
      host,
      stageId: 'stage-refresh-dismissal',
    }),
  ).toBe(true)
  const remove = mock(() => {})
  widgetState.attachHost({ remove } as unknown as HTMLElement)
  const schedule = mock(() => {})
  scanState.schedule = schedule
  const responseCapture = captureRefreshResponse()

  routeAutofillMessage(
    { type: ExtensionRuntimeRequestType.RefreshAuthenticationSurfaces },
    { id: 'nook-extension' },
    responseCapture.sendResponse,
  )

  await expect(responseCapture.response).resolves.toEqual({ ok: false })
  expect(remove).not.toHaveBeenCalled()
  expect(description.textContent).toBe('Enrollment retry available')
  expect(schedule).not.toHaveBeenCalled()
  dismissalAccepted = true
  expect(await cancelActiveEnrollmentCeremony()).toBe(true)
  removeScannedWidget()
})

test('pending cancellation revokes the serialized stage and scrubs local URI', async () => {
  const { beginEnrollmentCeremony, cancelActiveEnrollmentCeremony } =
    await import('../src/content/enrollment-flow')
  const uri = { value: 'otpauth://pending-secret' }
  const candidate: DecodedOtpauthCandidate = {
    sourceLabel: 'QR',
    otpauthUri: uri.value,
  }
  const neverSettles = new Promise<void>(() => {})
  const serializedMessages: Parameters<
    EnrollmentFlowHost['sendAuthenticatorEnrollmentStageRuntimeMessage']
  >[0][] = []
  let contentPayload: { otpauthUri: string } | false = false
  const dismissalStageIds: string[] = []
  const host = {
    description: { textContent: '' },
    translatedMessage: () => 'Staging enrollment',
    sendAuthenticatorEnrollmentStageRuntimeMessage: (
      message: (typeof serializedMessages)[number],
    ) => {
      contentPayload = message.payload
      serializedMessages.push(structuredClone(message))
      return neverSettles
    },
    sendAuthenticatorEnrollmentDismissRuntimeMessage: async (
      message: Parameters<
        EnrollmentFlowHost['sendAuthenticatorEnrollmentDismissRuntimeMessage']
      >[0],
    ) => {
      dismissalStageIds.push(message.payload.stageId)
      return true
    },
  } as unknown as EnrollmentFlowHost
  void beginEnrollmentCeremony({
    host,
    section: {} as HTMLElement,
    vaultStoreId: 'vault-pending',
    otpauthUri: uri,
    candidate,
  })
  expect(serializedMessages).toHaveLength(1)
  expect(serializedMessages[0]?.payload.otpauthUri).toBe(
    'otpauth://pending-secret',
  )
  expect(await cancelActiveEnrollmentCeremony()).toBe(true)
  expect(uri.value).toBe('')
  expect(candidate.otpauthUri).toBe('')
  expect(contentPayload && contentPayload.otpauthUri).toBe('')
  expect(dismissalStageIds).toEqual([serializedMessages[0]?.payload.stageId])
  expect(serializedMessages[0]?.payload.otpauthUri).toBe(
    'otpauth://pending-secret',
  )
})

async function runMismatchedStageResponse(
  dismissalResults: boolean[],
  onFirstDismiss?: () => Promise<void>,
  scenario: 'mismatch' | 'expiry' | 'confirmation' = 'mismatch',
) {
  const { beginEnrollmentCeremony } =
    await import('../src/content/enrollment-flow')
  let requestedStageId = ''
  const dismissedStageIds: string[] = []
  type Control = { textContent: string; triggerTrusted: () => void }
  const controls: Control[] = []
  Object.assign(document, {
    createElement: () => {
      let click: (event: { isTrusted: boolean }) => void = () => {}
      return {
        textContent: '',
        setAttribute: () => {},
        addEventListener: (
          _type: string,
          listener: (event: { isTrusted: boolean }) => void,
        ) => {
          click = listener
        },
        triggerTrusted: () => click({ isTrusted: true }),
      }
    },
  })
  let busy = false
  let codeRequestCount = 0
  let commitReady = false
  let refreshRequestCount = 0
  const refreshRequested = deferred<void>()
  let cancelRenderCount = 0
  const cancelRetryRendered = deferred<void>()
  const confirm = deferred<unknown>()
  const confirmStarted = deferred<void>()
  const dismiss = deferred<boolean>()
  const section = {
    replaceChildren: () => {
      controls.splice(0)
      cancelRenderCount += 1
      if (cancelRenderCount === 2) cancelRetryRendered.resolve()
    },
    append: (control: Control) => controls.push(control),
  } as unknown as HTMLElement
  const hostDefinition: Partial<EnrollmentFlowHost> = {
    description: { textContent: '' },
    panel: { querySelector: () => undefined },
    isBusy: () => busy,
    setBusy: (value: boolean) => {
      busy = value
    },
    requestWorkflowReclassification: () => {
      refreshRequestCount += 1
      refreshRequested.resolve()
    },
    translatedMessage: (key: string) => key,
    sendAuthenticatorEnrollmentStageRuntimeMessage: async (message) => {
      requestedStageId = message.payload.stageId
      return {
        kind: 'delivered',
        response: {
          kind: 0,
          stageId:
            scenario !== 'mismatch'
              ? requestedStageId
              : 'response-supplied-mismatch',
        },
      }
    },
    sendAuthenticatorCodeRuntimeMessage: async () => ({
      kind: 'delivered',
      response:
        scenario === 'expiry' && codeRequestCount++ > 0
          ? { kind: 1, reason: 'authenticator-stage-missing' }
          : { kind: 0, code: '123456', expiresAt: Date.now() + 30_000 },
    }),
    sendAuthenticationOutcomeRuntimeMessage: async () =>
      scenario === 'confirmation' && commitReady
        ? {
            kind: 'delivered',
            response: {
              kind: 0,
              verdict: { verdict: 0, allowsCredentialCommit: true },
            },
          }
        : { kind: 'unavailable' },
    sendAuthenticatorEnrollmentConfirmRuntimeMessage: () => {
      confirmStarted.resolve()
      return confirm.promise
    },
    sendAuthenticatorEnrollmentDismissRuntimeMessage: async (message) => {
      dismissedStageIds.push(message.payload.stageId)
      if (scenario === 'confirmation') {
        return dismiss.promise
      }
      const dismissed = dismissalResults.shift() ?? true
      if (dismissedStageIds.length === 1) await onFirstDismiss?.()
      return dismissed
    },
  }
  const host = hostDefinition as EnrollmentFlowHost
  await beginEnrollmentCeremony({
    host,
    section,
    vaultStoreId: 'vault-mismatch',
    otpauthUri: { value: 'otpauth://mismatch-secret' },
    candidate: {
      sourceLabel: 'QR',
      otpauthUri: 'otpauth://mismatch-secret',
    },
  })
  return {
    controls,
    confirm,
    confirmStarted: confirmStarted.promise,
    cancelRetryRendered: cancelRetryRendered.promise,
    dismiss,
    dismissedStageIds,
    host,
    refreshRequestCount: () => refreshRequestCount,
    refreshRequested: refreshRequested.promise,
    requestedStageId,
    startCommit: () => {
      commitReady = true
      runEnrollmentPoll()
    },
  }
}

test('mismatched stage response dismisses only the requested stage', async () => {
  const result = await runMismatchedStageResponse([true])
  expect(result.dismissedStageIds).toEqual([result.requestedStageId])
  expect(result.dismissedStageIds).not.toContain('response-supplied-mismatch')
})

test('failed mismatched cleanup retains the known stage for cancel retry', async () => {
  const { cancelActiveEnrollmentCeremony, enrollmentCeremonyActive } =
    await import('../src/content/enrollment-flow')
  const result = await runMismatchedStageResponse([false, false, true])
  expect(enrollmentCeremonyActive()).toBe(true)
  expect(result.host.description.textContent).toBe(
    BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
  )
  expect(result.controls.map(({ textContent }) => textContent)).toEqual([
    BROWSER_MESSAGE_KEYS.WidgetEnrollCancel,
  ])
  result.host.description.textContent =
    BROWSER_MESSAGE_KEYS.WidgetEnrollVerifyPending
  result.controls[0]?.triggerTrusted()
  await result.cancelRetryRendered
  expect(result.host.description.textContent).toBe(
    BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
  )
  expect(result.controls).toHaveLength(1)
  result.controls[0]?.triggerTrusted()
  await result.refreshRequested
  expect(result.dismissedStageIds).toHaveLength(3)
  expect(new Set(result.dismissedStageIds)).toEqual(
    new Set([result.requestedStageId]),
  )
  expect(result.dismissedStageIds).not.toContain('response-supplied-mismatch')
  expect(enrollmentCeremonyActive()).toBe(false)
  expect(await cancelActiveEnrollmentCeremony()).toBe(true)
})
test('expired staged poll retires enrollment and requests fresh actions', async () => {
  const { enrollmentCeremonyActive } =
    await import('../src/content/enrollment-flow')
  const result = await runMismatchedStageResponse([], undefined, 'expiry')
  runEnrollmentPoll()
  await result.refreshRequested
  expect(result.host.description.textContent).toBe(
    BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
  )
  expect(result.refreshRequestCount()).toBe(1)
  expect(enrollmentCeremonyActive()).toBe(false)
})
test('confirmed save remains authoritative while cancellation is rejected', async () => {
  const { cancelActiveEnrollmentCeremony, enrollmentCeremonyActive } =
    await import('../src/content/enrollment-flow')
  const result = await runMismatchedStageResponse([], undefined, 'confirmation')
  result.startCommit()
  await result.confirmStarted
  result.controls[0]?.triggerTrusted()
  result.confirm.resolve({ kind: 'delivered', response: { kind: 0 } })
  await result.cancelRetryRendered
  result.dismiss.resolve(false)
  await Promise.resolve()
  await Promise.resolve()
  expect(result.host.description.textContent).toBe(
    BROWSER_MESSAGE_KEYS.WidgetEnrollSaved,
  )
  expect(result.controls).toHaveLength(0)
  expect(result.refreshRequestCount()).toBe(0)
  expect(await cancelActiveEnrollmentCeremony()).toBe(true)
  expect(enrollmentCeremonyActive()).toBe(false)
})
test('stale mismatched cleanup continuation does not mutate UI', async () => {
  const { cancelActiveEnrollmentCeremony, enrollmentCeremonyActive } =
    await import('../src/content/enrollment-flow')
  const result = await runMismatchedStageResponse([false, true], async () => {
    expect(await cancelActiveEnrollmentCeremony()).toBe(true)
  })
  expect(result.controls).toHaveLength(0)
  expect(result.host.description.textContent).toBe(
    BROWSER_MESSAGE_KEYS.WidgetEnrollStaging,
  )
  expect(enrollmentCeremonyActive()).toBe(false)
})
