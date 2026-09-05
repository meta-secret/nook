import { afterEach, expect, test, vi } from 'vitest'
import { installMockPasskeyRuntime } from '../../../e2e/passkey-mock'
import { installPageAuthenticationDirectSubmitBridge } from '../../../../nook-web-shared/src/extension/authentication-direct-submit-bridge'

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, '__nookE2eLastPrfOutput')
})

test('allows credential prototype interception without corrupting form descriptors', async () => {
  vi.stubGlobal('navigator', Object.create(navigator))
  vi.stubGlobal('PublicKeyCredential', class {})
  installMockPasskeyRuntime()

  const credentials = navigator.credentials
  const prototype = Object.getPrototypeOf(credentials) as CredentialsContainer
  const originalGet = Object.getOwnPropertyDescriptor(prototype, 'get')
  const nativeGet = prototype.get
  const interceptedGet = vi.fn(function (
    this: CredentialsContainer,
    request: CredentialRequestOptions,
  ) {
    return nativeGet.call(this, request)
  })
  Object.defineProperty(prototype, 'get', {
    configurable: true,
    writable: true,
    value: interceptedGet,
  })

  try {
    // A plain-object credentials mock installs `get` on Object.prototype,
    // making the bridge's data descriptor look like an accessor descriptor.
    const stopBridge = installPageAuthenticationDirectSubmitBridge()
    try {
      const request: CredentialRequestOptions = {
        publicKey: {
          challenge: new Uint8Array(32),
          extensions: { prf: { eval: { first: new Uint8Array(32) } } },
        },
      }
      const credential = await credentials.get(request)
      expect(credential).toBeInstanceOf(PublicKeyCredential)
      expect(interceptedGet).toHaveBeenCalledWith(request)
      expect(Object.hasOwn(Object.prototype, 'get')).toBe(false)
    } finally {
      stopBridge()
    }
  } finally {
    Reflect.deleteProperty(prototype, 'get')
    if (originalGet) Object.defineProperty(prototype, 'get', originalGet)
  }
})
