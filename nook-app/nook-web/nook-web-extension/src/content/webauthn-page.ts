export {}

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

type ExtensionResponse = {
  source: typeof RESPONSE_SOURCE
  requestId: string
  action:
    | ExtensionResponseAction.Fallback
    | ExtensionResponseAction.Result
    | ExtensionResponseAction.Error
  result?: Record<string, unknown>
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
  return (
    crypto.randomUUID?.() ??
    base64url(crypto.getRandomValues(new Uint8Array(24)))
  )
}

function serializeCreation(
  options: PublicKeyCredentialCreationOptions,
): Record<string, unknown> {
  return {
    origin: location.origin,
    challenge: base64url(options.challenge),
    relyingParty: {
      id: options.rp.id ?? location.hostname,
      name: options.rp.name,
    },
    user: {
      id: base64url(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    algorithms: options.pubKeyCredParams.map((parameter) => parameter.alg),
    excludeCredentials: (options.excludeCredentials ?? []).map(
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
): Record<string, unknown> {
  return {
    origin: location.origin,
    challenge: base64url(options.challenge),
    rpId: options.rpId ?? location.hostname,
    allowCredentials: (options.allowCredentials ?? []).map((credential) => ({
      id: base64url(credential.id),
    })),
    userVerificationRequired: options.userVerification === 'required',
  }
}

function publicCredential({
  ceremony,
  result,
}: {
  ceremony: WebsitePasskeyCeremony
  result: Record<string, unknown>
}): Credential {
  const id = result.credentialId
  if (typeof id !== 'string')
    throw new DOMException('Invalid Nook response.', 'DataError')
  const rawId = bytes(id)
  const clientDataJSON = bytes(result.clientDataJSON)
  const response: Record<
    string,
    ArrayBuffer | (() => string[]) | (() => number)
  > =
    ceremony === WebsitePasskeyCeremony.Create
      ? {
          clientDataJSON,
          attestationObject: bytes(result.attestationObject),
          getTransports: () => ['internal'],
          getPublicKeyAlgorithm: () => -7,
        }
      : {
          clientDataJSON,
          authenticatorData: bytes(result.authenticatorData),
          signature: bytes(result.signature),
          userHandle: bytes(result.userHandle),
        }
  return {
    id,
    rawId,
    type: 'public-key',
    authenticatorAttachment: 'cross-platform',
    response,
    getClientExtensionResults: () => ({}),
    toJSON: () => ({
      id,
      rawId: id,
      type: 'public-key',
      authenticatorAttachment: 'cross-platform',
      clientExtensionResults: {},
      response: Object.fromEntries(
        Object.entries(response)
          .filter(([, value]) => value instanceof ArrayBuffer)
          .map(([key, value]) => [key, base64url(value as ArrayBuffer)]),
      ),
    }),
  } as unknown as Credential
}

async function extensionCeremony({
  ceremony,
  options,
  fallback,
}: {
  ceremony: WebsitePasskeyCeremony
  options: CredentialCreationOptions | CredentialRequestOptions
  fallback: () => ReturnType<CredentialsContainer['get']>
}): ReturnType<CredentialsContainer['get']> {
  if (!('publicKey' in options) || !options.publicKey) return fallback()
  if ('mediation' in options && options.mediation === 'conditional')
    return fallback()
  const id = requestId()
  const request =
    ceremony === WebsitePasskeyCeremony.Create
      ? serializeCreation(
          options.publicKey as PublicKeyCredentialCreationOptions,
        )
      : serializeAssertion(
          options.publicKey as PublicKeyCredentialRequestOptions,
        )
  const timeout = Math.min(
    Math.max(options.publicKey.timeout ?? 60_000, 1_000),
    120_000,
  )
  const signal = options.signal

  return new Promise<Awaited<ReturnType<CredentialsContainer['get']>>>(
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
            signal?.reason ??
              new DOMException('The operation was aborted.', 'AbortError'),
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
          event.data.result
        ) {
          finish(() => {
            const credentialArgs: Parameters<typeof publicCredential>[0] = {
              ceremony,
              result: event.data.result!,
            }
            return resolve(publicCredential(credentialArgs))
          })
        } else {
          finish(() =>
            reject(
              new DOMException(
                'Nook passkey request was not completed.',
                event.data.reason ?? 'NotAllowedError',
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

const credentials = navigator.credentials
const prototype = Object.getPrototypeOf(credentials) as CredentialsContainer
const nativeCreate = prototype.create
const nativeGet = prototype.get

const nookTypedArgs0_3: Parameters<typeof Object.defineProperty>[2] = {
  configurable: true,
  writable: true,
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
