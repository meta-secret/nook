import { expect, mock, test } from 'bun:test'
import type { PasswordFormObservation } from '../../nook-web-shared/src/extension/password-forms'
import { ExtensionRuntimeRequestType } from '../src/lib/extension-runtime-request-type'

const addListener = mock(() => {})
Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
  chrome: {
    i18n: { getMessage: () => 'Picker canceled' },
    runtime: { id: 'nook-extension', onMessage: { addListener } },
  },
  location: { origin: 'https://login.example.test' },
  window: { clearTimeout: mock(() => {}) },
})

test('delivers cleanup cancellation through the content-script router', async () => {
  const { LoginPickerKind, pickerState, scanState, widgetState } =
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

  const remove = mock(() => {})
  widgetState.attachHost({ remove } as unknown as HTMLElement)
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
})
