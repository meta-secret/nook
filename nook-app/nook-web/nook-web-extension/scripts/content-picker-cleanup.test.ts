import { expect, mock, test } from 'bun:test'
import type { PasswordFormObservation } from '../../nook-web-shared/src/extension/password-forms'
import type { LoginCredentials } from '../../nook-web-shared/src/extension/password-form-field-actions'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
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
  document: { documentElement: {}, querySelectorAll: () => [] },
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
    setInterval: mock(() => 1),
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

test('mismatched stage response dismisses only the requested stage', async () => {
  const { beginEnrollmentCeremony } =
    await import('../src/content/enrollment-flow')
  let requestedStageId = ''
  let dismissedStageId = ''
  let markDismissStarted = () => {}
  let finishDismiss: (accepted: boolean) => void = () => {}
  const dismissStarted = new Promise<void>((resolve) => {
    markDismissStarted = resolve
  })
  const dismissGate = new Promise<boolean>((resolve) => {
    finishDismiss = resolve
  })
  const host = {
    description: { textContent: '' },
    panel: { querySelector: () => undefined },
    setBusy: () => {},
    translatedMessage: () => 'Staging enrollment',
    sendAuthenticatorEnrollmentStageRuntimeMessage: async (
      message: Parameters<
        EnrollmentFlowHost['sendAuthenticatorEnrollmentStageRuntimeMessage']
      >[0],
    ) => {
      requestedStageId = message.payload.stageId
      return {
        kind: 'delivered',
        response: { kind: 0, stageId: 'response-supplied-mismatch' },
      }
    },
    sendAuthenticatorEnrollmentDismissRuntimeMessage: async (
      message: Parameters<
        EnrollmentFlowHost['sendAuthenticatorEnrollmentDismissRuntimeMessage']
      >[0],
    ) => {
      dismissedStageId = message.payload.stageId
      markDismissStarted()
      return dismissGate
    },
  } as unknown as EnrollmentFlowHost
  const enrollment = beginEnrollmentCeremony({
    host,
    section: {} as HTMLElement,
    vaultStoreId: 'vault-mismatch',
    otpauthUri: { value: 'otpauth://mismatch-secret' },
    candidate: {
      sourceLabel: 'QR',
      otpauthUri: 'otpauth://mismatch-secret',
    },
  })
  await dismissStarted
  expect(dismissedStageId).toBe(requestedStageId)
  expect(dismissedStageId).not.toBe('response-supplied-mismatch')
  expect(host.description.textContent).toBe('Staging enrollment')
  finishDismiss(true)
  await enrollment
})
