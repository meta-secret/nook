import { expect, mock, test } from 'bun:test'
import type { PasswordFormObservation } from '../../nook-web-shared/src/extension/password-forms'
import type { LoginCredentials } from '../../nook-web-shared/src/extension/password-form-field-actions'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
import type {
  WebsiteLoginSaveActionResponse,
  WebsiteLoginSaveOfferView,
} from '../src/lib/login-save-messages'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'

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
  location: { origin: 'https://login.example.test' },
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
  expect(widgetState.host.kind).toBe(WidgetHostKind.Detached)
  expect(saveOfferState.watch.kind).toBe(SavePageWatchKind.Idle)
  expect(saveOfferState.dismissedOfferIds.has(staleOfferId)).toBe(true)
  expect(schedule).not.toHaveBeenCalled()
  expect(sendResponse).not.toHaveBeenCalled()
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
  await expect(responseCapture.response).resolves.toEqual({ ok: true })
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
