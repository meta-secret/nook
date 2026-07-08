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
  const result = (first: ArrayBuffer | ArrayBufferView, enabled: boolean) => ({
    id: 'nook-e2e-passkey',
    rawId: credentialId.buffer.slice(0),
    type: 'public-key',
    response: { userHandle: userHandle.buffer.slice(0) },
    getClientExtensionResults: () => ({
      prf: {
        enabled,
        results: { first: derive(first) },
      },
    }),
  })
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {
      create: async (options: {
        publicKey?: {
          user?: { id?: ArrayBuffer | ArrayBufferView }
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
        const createdUserHandle = options.publicKey?.user?.id
        if (createdUserHandle) {
          userHandle = bytesFrom(createdUserHandle)
          saveUserHandle()
        }
        const first = options.publicKey?.extensions?.prf?.eval?.first
        if (!first) throw new Error('Missing E2E PRF create input')
        return result(first, mode !== 'unsupported')
      },
      get: async (options: {
        publicKey?: {
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
        const first =
          prf?.eval?.first ??
          Object.values(prf?.evalByCredential ?? {})[0]?.first
        if (!first) throw new Error('Missing E2E PRF get input')
        return result(first, false)
      },
    },
  })
}
