import { expect, mock, test } from 'bun:test'
import type { PasswordFormObservation } from '../../nook-web-shared/src/extension/password-forms'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'

const addListener = mock(() => {})
const clearInterval = mock(() => {})
const disconnect = mock(() => {})
const unexpectedRuntimeMessage = async () => {
  throw new Error('unexpected enrollment request')
}
Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
  chrome: {
    i18n: { getMessage: () => 'Picker canceled' },
    runtime: { id: 'nook-extension', onMessage: { addListener } },
  },
  document: { documentElement: {} },
  location: { origin: 'https://login.example.test', pathname: '/enroll' },
  MutationObserver: class {
    observe() {}
    disconnect = disconnect
  },
  window: {
    clearInterval,
    clearTimeout: mock(() => {}),
    setInterval: () => 9,
  },
})

test('delivers cleanup cancellation through the content-script router', async () => {
  const { LoginPickerKind, pickerState, scanState, widgetState } =
    await import('../src/content/autofill/state')
  const { routeAutofillMessage } =
    await import('../src/content/autofill/message-router')
  const { enrollmentCeremonyActive } =
    await import('../src/content/enrollment-flow')
  const { beginEnrollmentEvidenceWatch } =
    await import('../src/content/enrollment-outcome')
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

  const remove = mock(() => {})
  widgetState.attachHost({ remove } as unknown as HTMLElement)
  const watchArgs: Parameters<typeof beginEnrollmentEvidenceWatch>[0] = {
    host: {
      sendAuthenticatorCodeRuntimeMessage: unexpectedRuntimeMessage,
      sendAuthenticationOutcomeRuntimeMessage: unexpectedRuntimeMessage,
    },
    stageId: 'pending',
    callbacks: { commit: async () => {}, reject: () => {}, timeout: () => {} },
  }
  beginEnrollmentEvidenceWatch(watchArgs)
  expect(enrollmentCeremonyActive()).toBe(true)
  widgetState.dismissed = true
  const staleSequence = ++scanState.sequence
  routeAutofillMessage(
    { type: ExtensionRuntimeRequestType.ClearAuthenticationSurface },
    { id: 'nook-extension' },
    sendResponse,
  )
  await Promise.resolve()
  if (staleSequence === scanState.sequence)
    widgetState.attachHost({ remove } as unknown as HTMLElement)
  expect(remove).toHaveBeenCalledTimes(1)
  expect(widgetState.host).not.toHaveProperty('element')
  expect(enrollmentCeremonyActive()).toBe(false)
  expect(clearInterval).toHaveBeenCalledWith(9)
  expect(disconnect).toHaveBeenCalledTimes(1)

  const schedule = mock(() => {})
  scanState.schedule = schedule
  routeAutofillMessage(
    { type: ExtensionRuntimeRequestType.RescanSurfaces },
    { id: 'nook-extension' },
    sendResponse,
  )
  expect(widgetState.dismissed).toBe(true)
  expect(schedule).toHaveBeenCalledTimes(1)
  routeAutofillMessage(
    { type: ExtensionRuntimeRequestType.RefreshSurfaces },
    { id: 'nook-extension' },
    sendResponse,
  )
  expect(widgetState.dismissed).toBe(false)
  expect(schedule).toHaveBeenCalledTimes(2)
})
