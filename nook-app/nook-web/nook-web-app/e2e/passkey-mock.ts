/** Deterministic WebAuthn PRF mock used by browser-flow tests. */
export function installMockPasskeyRuntime() {
  const credentialId = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
  const saved = window.name.startsWith('nook-e2e-passkey:')
    ? window.name.slice('nook-e2e-passkey:'.length)
    : undefined
  let userHandle = saved
    ? Uint8Array.from(JSON.parse(saved) as number[])
    : Uint8Array.from({ length: 32 }, (_, index) => 0xf0 - index)
  const saveUserHandle = () => {
    window.name = `nook-e2e-passkey:${JSON.stringify(Array.from(userHandle))}`
  }
  const derive = (source: ArrayBuffer | ArrayBufferView) => {
    const bytes =
      source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    return Uint8Array.from(bytes, (byte) => byte ^ 0xa5).buffer
  }
  const bytesFrom = (source: ArrayBuffer | ArrayBufferView) =>
    source instanceof ArrayBuffer
      ? Uint8Array.from(new Uint8Array(source))
      : Uint8Array.from(
          new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
        )
  const result = (first: ArrayBuffer | ArrayBufferView, enabled: boolean) => {
    const prfOutput = derive(first)
    Object.assign(window, {
      __nookE2eLastPrfOutput: btoa(
        String.fromCharCode(...new Uint8Array(prfOutput)),
      ),
    })
    return {
      id: 'nook-e2e-passkey',
      rawId: credentialId.buffer.slice(0),
      type: 'public-key',
      response: { userHandle: userHandle.buffer.slice(0) },
      getClientExtensionResults: () => ({
        prf: {
          enabled,
          results: { first: prfOutput },
        },
      }),
    }
  }
  const publicKeyCredential = {
    [Symbol.hasInstance]: (candidate: unknown) =>
      !!candidate &&
      typeof candidate === 'object' &&
      'type' in candidate &&
      candidate.type === 'public-key',
    signalCurrentUserDetails: async (details: {
      displayName?: string
      name?: string
      rpId?: string
      userId?: ArrayBuffer | ArrayBufferView
    }) => {
      localStorage.setItem(
        'nook_e2e_passkey_label',
        details.displayName ?? details.name ?? '',
      )
      localStorage.setItem('nook_e2e_passkey_signal_rp_id', details.rpId ?? '')
      if (details.userId) {
        localStorage.setItem(
          'nook_e2e_passkey_signal_user_id',
          JSON.stringify(Array.from(bytesFrom(details.userId))),
        )
      }
    },
  }
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    get: () =>
      localStorage.getItem('nook_e2e_passkey_mode') === 'unavailable'
        ? undefined
        : publicKeyCredential,
  })
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {
      create: async (options: {
        publicKey?: {
          challenge?: ArrayBuffer | ArrayBufferView
          user?: {
            displayName?: string
            id?: ArrayBuffer | ArrayBufferView
            name?: string
          }
          extensions?: {
            prf?: { eval?: { first?: ArrayBuffer | ArrayBufferView } }
          }
        }
      }) => {
        const mode = localStorage.getItem('nook_e2e_passkey_mode')
        if (mode === 'cancel') {
          throw new DOMException(
            'The operation was cancelled.',
            'NotAllowedError',
          )
        }
        if (mode === 'not-supported-error') {
          throw new DOMException(
            'The requested public-key algorithm is not supported.',
            'NotSupportedError',
          )
        }
        if (mode === 'security-error') {
          throw new DOMException('This is an invalid domain.', 'SecurityError')
        }
        const createdUserHandle = options.publicKey?.user?.id
        if (!(options.publicKey?.challenge instanceof Uint8Array)) {
          throw new TypeError('WebAuthn creation challenge must be binary')
        }
        if (!(createdUserHandle instanceof Uint8Array)) {
          throw new TypeError('WebAuthn creation user id must be binary')
        }
        if (createdUserHandle) {
          userHandle = bytesFrom(createdUserHandle)
          saveUserHandle()
        }
        localStorage.setItem(
          'nook_e2e_passkey_label',
          options.publicKey?.user?.displayName ??
            options.publicKey?.user?.name ??
            '',
        )
        const first = options.publicKey?.extensions?.prf?.eval?.first
        if (!(first instanceof Uint8Array)) {
          throw new TypeError('WebAuthn creation PRF input must be binary')
        }
        if (!first) throw new Error('Missing E2E PRF create input')
        return result(first, mode !== 'unsupported')
      },
      get: async (options: {
        publicKey?: {
          challenge?: ArrayBuffer | ArrayBufferView
          extensions?: {
            prf?: {
              eval?: { first?: ArrayBuffer | ArrayBufferView }
              evalByCredential?: Record<
                string,
                { first?: ArrayBuffer | ArrayBufferView }
              >
            }
          }
        }
      }) => {
        if (localStorage.getItem('nook_e2e_passkey_mode') === 'cancel') {
          throw new DOMException(
            'The operation was cancelled.',
            'NotAllowedError',
          )
        }
        const prf = options.publicKey?.extensions?.prf
        if (!(options.publicKey?.challenge instanceof Uint8Array)) {
          throw new TypeError('WebAuthn request challenge must be binary')
        }
        const first =
          prf?.eval?.first ??
          Object.values(prf?.evalByCredential ?? {})[0]?.first
        if (!(first instanceof Uint8Array)) {
          throw new TypeError('WebAuthn request PRF input must be binary')
        }
        if (!first) throw new Error('Missing E2E PRF get input')
        return result(first, false)
      },
    },
  })
}
