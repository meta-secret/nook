export {}

import type { WebsitePasskeyPerformResponse } from '../lib/webauthn-messages'

const REQUEST_SOURCE = 'nook-passkey-page-v1'
const RESPONSE_SOURCE = 'nook-passkey-extension-v1'

enum ExtensionResponseAction {
  Fallback = 'fallback',
  Result = 'result',
  Error = 'error',
}

enum WebsitePasskeyCeremony {
  Create = 'create',
  Get = 'get',
}

type SerializedCredentialDescriptor = { id: string }

type SerializedCreationOptions = {
  origin: string
  challenge: string
  relyingParty: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  algorithms: number[]
  excludeCredentials: SerializedCredentialDescriptor[]
  residentKeyRequired: boolean
  userVerificationRequired: boolean
}

type SerializedAssertionOptions = {
  origin: string
  challenge: string
  rpId: string
  allowCredentials: SerializedCredentialDescriptor[]
  userVerificationRequired: boolean
}

type SerializedPasskeyRequest =
  | SerializedCreationOptions
  | SerializedAssertionOptions

type NookPublicCredentialJSON = {
  id: string
  rawId: string
  type: 'public-key'
  authenticatorAttachment: 'cross-platform'
  clientExtensionResults: AuthenticationExtensionsClientOutputs
  response:
    | { clientDataJSON: string; attestationObject: string }
    | {
        clientDataJSON: string
        authenticatorData: string
        signature: string
        userHandle: string
      }
}

type NookPublicCredentialResult = Extract<
  WebsitePasskeyPerformResponse,
  { ok: true }
>

type ExtensionResponse = {
  source: typeof RESPONSE_SOURCE
  requestId: string
  action:
    | ExtensionResponseAction.Fallback
    | ExtensionResponseAction.Result
    | ExtensionResponseAction.Error
  result?: WebsitePasskeyPerformResponse
  reason?: string
}

function base64url(value: BufferSource): string {
  const view =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function bytes(value: unknown): ArrayBuffer {
  if (typeof value !== 'string')
    throw new DOMException('Invalid Nook response.', 'DataError')
  const padded =
    value.replaceAll('-', '+').replaceAll('_', '/') +
    '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer
}

function requestId(): string {
  return ((...[v = base64url(crypto.getRandomValues(new Uint8Array(24)))]) =>
    v)(crypto.randomUUID?.())
}

function serializeCreation(
  options: PublicKeyCredentialCreationOptions,
): SerializedCreationOptions {
  return {
    origin: location.origin,
    challenge: base64url(options.challenge),
    relyingParty: {
      id: ((...[v = location.hostname]) => v)(options.rp.id),
      name: options.rp.name,
    },
    user: {
      id: base64url(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    algorithms: options.pubKeyCredParams.map((parameter) => parameter.alg),
    excludeCredentials: ((v) => (v ? v : []))(options.excludeCredentials).map(
      (credential) => ({
        id: base64url(credential.id),
      }),
    ),
    residentKeyRequired:
      options.authenticatorSelection?.residentKey !== 'discouraged',
    userVerificationRequired:
      options.authenticatorSelection?.userVerification === 'required',
  }
}

function serializeAssertion(
  options: PublicKeyCredentialRequestOptions,
): SerializedAssertionOptions {
  return {
    origin: location.origin,
    challenge: base64url(options.challenge),
    rpId: ((...[v = location.hostname]) => v)(options.rpId),
    allowCredentials: ((v) => (v ? v : []))(options.allowCredentials).map(
      (credential) => ({
        id: base64url(credential.id),
      }),
    ),
    userVerificationRequired: options.userVerification === 'required',
  }
}

type PublicCredentialArgs = {
  ceremony: WebsitePasskeyCeremony
  result: NookPublicCredentialResult
}

type NookPublicCredentialResponse =
  | {
      clientDataJSON: ArrayBuffer
      attestationObject: ArrayBuffer
      getTransports: () => string[]
      getPublicKeyAlgorithm: () => number
    }
  | {
      clientDataJSON: ArrayBuffer
      authenticatorData: ArrayBuffer
      signature: ArrayBuffer
      userHandle: ArrayBuffer
    }

type NookPublicCredentialState = {
  id: string
  rawId: ArrayBuffer
  response: NookPublicCredentialResponse
}

class NookPublicCredential implements Credential {
  readonly type = 'public-key'
  readonly authenticatorAttachment = 'cross-platform'

  readonly id: string
  readonly rawId: ArrayBuffer
  readonly response: NookPublicCredentialResponse

  constructor(state: NookPublicCredentialState) {
    this.id = state.id
    this.rawId = state.rawId
    this.response = state.response
  }

  getClientExtensionResults(): AuthenticationExtensionsClientOutputs {
    return {}
  }

  toJSON(): NookPublicCredentialJSON {
    const response = this.response
    const serializedResponse =
      'attestationObject' in response
        ? {
            clientDataJSON: base64url(response.clientDataJSON),
            attestationObject: base64url(response.attestationObject),
          }
        : {
            clientDataJSON: base64url(response.clientDataJSON),
            authenticatorData: base64url(response.authenticatorData),
            signature: base64url(response.signature),
            userHandle: base64url(response.userHandle),
          }
    return {
      id: this.id,
      rawId: this.id,
      type: this.type,
      authenticatorAttachment: this.authenticatorAttachment,
      clientExtensionResults: {},
      response: serializedResponse,
    }
  }
}

function publicCredential({
  ceremony,
  result,
}: PublicCredentialArgs): Credential {
  const id = result.credentialId
  const rawId = bytes(id)
  const clientDataJSON = bytes(result.clientDataJSON)
  if (
    ceremony === WebsitePasskeyCeremony.Create &&
    !('attestationObject' in result)
  ) {
    throw new DOMException('Invalid Nook response.', 'DataError')
  }
  if (
    ceremony === WebsitePasskeyCeremony.Get &&
    !('authenticatorData' in result)
  ) {
    throw new DOMException('Invalid Nook response.', 'DataError')
  }
  const response: NookPublicCredentialResponse =
    ceremony === WebsitePasskeyCeremony.Create &&
    'attestationObject' in result
      ? {
          clientDataJSON,
          attestationObject: bytes(result.attestationObject),
          getTransports: () => ['internal'],
          getPublicKeyAlgorithm: () => -7,
        }
      : ceremony === WebsitePasskeyCeremony.Get &&
          'authenticatorData' in result
        ? {
            clientDataJSON,
            authenticatorData: bytes(result.authenticatorData),
            signature: bytes(result.signature),
            userHandle: bytes(result.userHandle),
          }
        : (() => {
            throw new DOMException('Invalid Nook response.', 'DataError')
          })()
  const credentialState: NookPublicCredentialState = { id, rawId, response }
  return new NookPublicCredential(credentialState)
}

type ExtensionCeremonyArgs = {
  ceremony: WebsitePasskeyCeremony
  options: CredentialCreationOptions | CredentialRequestOptions
  fallback: () => ReturnType<CredentialsContainer['get']>
}

async function extensionCeremony({
  ceremony,
  options,
  fallback,
}: ExtensionCeremonyArgs): ReturnType<CredentialsContainer['get']> {
  if (!('publicKey' in options) || !options.publicKey) return fallback()
  if ('mediation' in options && options.mediation === 'conditional')
    return fallback()
  const id = requestId()
  const request = (() => {
    if (
      ceremony === WebsitePasskeyCeremony.Create &&
      'rp' in options.publicKey &&
      'user' in options.publicKey
    ) {
      return serializeCreation(options.publicKey)
    }
    return serializeAssertion(options.publicKey)
  })()
  const timeout = Math.min(
    Math.max(((...[v = 60_000]) => v)(options.publicKey.timeout), 1_000),
    120_000,
  )
  const signal = options.signal

  return new Promise<Awaited<ReturnType<CredentialsContainer['get']>>>(
    // eslint-disable-next-line max-params -- Promise owns the executor callback signature.
    (resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        window.removeEventListener('message', receive)
        signal?.removeEventListener('abort', abort)
        window.clearTimeout(timer)
        callback()
      }
      const abort = () => {
        const nookTypedArgs0_0: Parameters<typeof window.postMessage>[0] = {
          source: REQUEST_SOURCE,
          type: 'cancel',
          requestId: id,
        }
        window.postMessage(nookTypedArgs0_0, location.origin)
        finish(() =>
          reject(
            signal
              ? signal.reason
              : new DOMException('The operation was aborted.', 'AbortError'),
          ),
        )
      }
      const receive = (event: MessageEvent<ExtensionResponse>) => {
        if (
          event.source !== window ||
          event.origin !== location.origin ||
          event.data?.source !== RESPONSE_SOURCE ||
          event.data.requestId !== id
        )
          return
        if (event.data.action === ExtensionResponseAction.Fallback) {
          finish(() => void fallback().then(resolve, reject))
        } else if (
          event.data.action === ExtensionResponseAction.Result &&
          event.data.result?.ok === true
        ) {
          const { result } = event.data
          finish(() => {
            const credentialArgs: Parameters<typeof publicCredential>[0] = {
              ceremony,
              result,
            }
            return resolve(publicCredential(credentialArgs))
          })
        } else {
          finish(() =>
            reject(
              new DOMException(
                'Nook passkey request was not completed.',
                ((...[v = 'NotAllowedError']) => v)(event.data.reason),
              ),
            ),
          )
        }
      }
      const timer = window.setTimeout(() => {
        const nookTypedArgs0_1: Parameters<typeof window.postMessage>[0] = {
          source: REQUEST_SOURCE,
          type: 'cancel',
          requestId: id,
        }
        window.postMessage(nookTypedArgs0_1, location.origin)
        finish(() =>
          reject(
            new DOMException('The operation timed out.', 'NotAllowedError'),
          ),
        )
      }, timeout)
      window.addEventListener('message', receive)
      const abortOptions: AddEventListenerOptions = { once: true }
      signal?.addEventListener('abort', abort, abortOptions)
      const nookTypedArgs0_2: Parameters<typeof window.postMessage>[0] = {
        source: REQUEST_SOURCE,
        type: 'request',
        requestId: id,
        ceremony,
        request,
        expiresAt: Date.now() + timeout,
      }
      window.postMessage(nookTypedArgs0_2, location.origin)
    },
  )
}

const prototype = navigator.credentials
const nativeCreate = prototype.create
const nativeGet = prototype.get

const nookTypedArgs0_3: Parameters<typeof Object.defineProperty>[2] = {
  configurable: true,
  writable: true,
  // eslint-disable-next-line max-params -- CredentialsContainer owns this browser override signature.
  value(this: CredentialsContainer, options: CredentialCreationOptions) {
    const nookTypedArgs0_0: Parameters<typeof extensionCeremony>[0] = {
      ceremony: WebsitePasskeyCeremony.Create,
      options,
      fallback: () => nativeCreate.call(this, options),
    }
    return extensionCeremony(nookTypedArgs0_0)
  },
}
Object.defineProperty(prototype, 'create', nookTypedArgs0_3)

const nookTypedArgs0_4: Parameters<typeof Object.defineProperty>[2] = {
  configurable: true,
  writable: true,
  // eslint-disable-next-line max-params -- CredentialsContainer owns this browser override signature.
  value(this: CredentialsContainer, options: CredentialRequestOptions) {
    const nookTypedArgs0_1: Parameters<typeof extensionCeremony>[0] = {
      ceremony: WebsitePasskeyCeremony.Get,
      options,
      fallback: () => nativeGet.call(this, options),
    }
    return extensionCeremony(nookTypedArgs0_1)
  },
}
Object.defineProperty(prototype, 'get', nookTypedArgs0_4)
