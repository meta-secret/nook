import { expect, mock, test } from 'bun:test'
import type { PasswordFormObservation } from '../../nook-web-shared/src/extension/password-forms'
import type { LoginCredentials } from '../../nook-web-shared/src/extension/password-form-field-actions'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'
import type {
  WebsiteLoginSaveActionResponse,
  WebsiteLoginSaveOfferView,
} from '../src/lib/login-save-messages'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  AuthenticationWorkflowApproval,
  AuthenticationWorkflowSnapshotIngress,
} from '../src/lib/auth-workflow-messages'

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
  widgetState.attachHost({
    remove,
    isConnected: true,
  } as unknown as HTMLElement)
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
  widgetState.attachHost({
    isConnected: true,
    remove,
  } as unknown as HTMLElement)
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

test('refresh dismisses an in-flight save offer before rescanning', async () => {
  const { SavePageWatchKind, scanState, saveOfferState } =
    await import('../src/content/autofill/state')
  const { loginSaveInteraction } =
    await import('../src/content/autofill/login-save')
  const { routeAutofillMessage } =
    await import('../src/content/autofill/message-router')
  const credentials: LoginCredentials = {
    username: 'person@example.test',
    password: 'secret-password',
  }
  deferRuntimeResponse()
  sendMessage.mockClear()
  const staging = loginSaveInteraction.stageSaveForCredentials(credentials)
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
  expect(await responseCapture.response).toEqual({ ok: true })

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
  expect(schedule).toHaveBeenCalledTimes(1)
})
