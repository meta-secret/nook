import { describe, expect, mock, spyOn, test } from 'bun:test'
import { CompanionStartupRuntimeDiagnostics } from '../e2e/helpers/companion-startup-runtime-diagnostics'

type RuntimeCallback = (response: unknown) => void
// Chrome's callback overload fixes this positional host signature.
type RuntimeMessageInvocation = [message: unknown, callback: RuntimeCallback]

describe('companion startup failure diagnostics', () => {
  test('reports a closed-session code without changing the callback response', () => {
    const response = { ok: false, error: 'EXTENSION_SESSION_CLOSED' }
    const nativeSend = mock((...invocation: RuntimeMessageInvocation) => {
      invocation[1](response)
    })
    const runtime = { sendMessage: nativeSend }
    const chromeDescriptor: PropertyDescriptor = { configurable: true, value: { runtime } }
    const priorChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
    const errors = spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(globalThis, 'chrome', chromeDescriptor)
    try {
      new CompanionStartupRuntimeDiagnostics().install()
      const callback = mock((received: unknown) => expect(received).toBe(response))
      const message = { type: 'nook:extension-session-status' }
      runtime.sendMessage(message, callback)
      expect(callback).toHaveBeenCalledTimes(1)
      expect(nativeSend).toHaveBeenCalledTimes(1)
      expect(errors).toHaveBeenCalledWith(
        'Companion startup runtime failure: EXTENSION_SESSION_CLOSED',
      )
    } finally {
      errors.mockRestore()
      switch (priorChrome instanceof Object) {
        case true:
          Object.defineProperty(globalThis, 'chrome', priorChrome)
          break
        case false:
          Reflect.deleteProperty(globalThis, 'chrome')
      }
    }
  })

  test('does not disclose successful payloads or arbitrary failure text', () => {
    const responses = [
      { ok: true, device: { deviceId: 'private-test-payload' } },
      { ok: false, error: 'private-test-error-text' },
    ]
    const nativeSend = mock((...invocation: RuntimeMessageInvocation) => {
      invocation[1](responses.shift())
    })
    const runtime = { sendMessage: nativeSend }
    const chromeDescriptor: PropertyDescriptor = { configurable: true, value: { runtime } }
    const priorChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
    const errors = spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(globalThis, 'chrome', chromeDescriptor)
    try {
      new CompanionStartupRuntimeDiagnostics().install()
      const callback = mock(() => {})
      const message = { type: 'nook:extension-session-status' }
      runtime.sendMessage(message, callback)
      runtime.sendMessage(message, callback)
      expect(callback).toHaveBeenCalledTimes(2)
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
      switch (priorChrome instanceof Object) {
        case true:
          Object.defineProperty(globalThis, 'chrome', priorChrome)
          break
        case false:
          Reflect.deleteProperty(globalThis, 'chrome')
      }
    }
  })
})
