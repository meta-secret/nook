import { afterEach, expect, test, vi } from 'vitest'
import { installMockPasskeyRuntime } from '../../../e2e/passkey-mock'
import { authenticationSubmissionBridge } from '../../../../nook-web-shared/src/extension/authentication-direct-submit-bridge'
import type {
  NookPasskeySetup,
  NookPasskeyUnlockOptions,
  build_passkey_creation_options,
  build_passkey_prf_request_options,
  build_passkey_recovery_request_options,
} from '../../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

type BroadAny<Value> = 0 extends 1 & Value ? true : false
type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false
type IsExactly<Left, Right> =
  IsAssignable<Left, Right> extends true ? IsAssignable<Right, Left> : false
type IsNot<Value extends boolean> = Value extends true ? false : true

type CreationOptions =
  | ReturnType<typeof build_passkey_creation_options>
  | ReturnType<NookPasskeySetup['creation_options']>
  | ReturnType<NookPasskeySetup['creation_options_with_label']>

type RequestOptions =
  | ReturnType<typeof build_passkey_prf_request_options>
  | ReturnType<typeof build_passkey_recovery_request_options>
  | ReturnType<NookPasskeyUnlockOptions['request_options']>

type BrowserPasskeyOptionsTypeContract = {
  creationIsTyped: IsNot<BroadAny<CreationOptions>>
  requestIsTyped: IsNot<BroadAny<RequestOptions>>
  creationMatchesBrowser: IsExactly<CreationOptions, CredentialCreationOptions>
  requestMatchesBrowser: IsExactly<RequestOptions, CredentialRequestOptions>
  requestDoesNotFitCreation: IsNot<
    IsAssignable<RequestOptions, CredentialCreationOptions>
  >
}

const browserPasskeyOptionsTypeContract: BrowserPasskeyOptionsTypeContract = {
  creationIsTyped: true,
  requestIsTyped: true,
  creationMatchesBrowser: true,
  requestMatchesBrowser: true,
  requestDoesNotFitCreation: true,
}

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, '__nookE2eLastPrfOutput')
})

test('keeps every Rust passkey option export assigned to its browser ceremony', () => {
  expect(browserPasskeyOptionsTypeContract).toEqual({
    creationIsTyped: true,
    requestIsTyped: true,
    creationMatchesBrowser: true,
    requestMatchesBrowser: true,
    requestDoesNotFitCreation: true,
  })
})

test('allows credential prototype interception without corrupting form descriptors', async () => {
  vi.stubGlobal('navigator', Object.create(navigator))
  vi.stubGlobal('PublicKeyCredential', class {})
  installMockPasskeyRuntime()

  const credentials = navigator.credentials
  const prototype = Reflect.getPrototypeOf(credentials)
  if (!prototype) throw new Error('credentials prototype is required')
  const originalGet = Object.getOwnPropertyDescriptor(prototype, 'get')
  const nativeGet = credentials.get
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
    const stopBridge =
      authenticationSubmissionBridge.installPageAuthenticationDirectSubmitBridge()
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
