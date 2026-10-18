import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

/** What the bridge sent: its ceremony and the site's userVerification, or `absent`. */
type BridgeRequest = {
  ceremony: unknown
  userVerification: unknown
}

beforeAll(async () => {
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { create: vi.fn(), get: vi.fn() },
  })
  await import('../../../../nook-web-extension/src/content/webauthn-page')
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Starts a ceremony, returns what the bridge sent to the extension, then aborts it. */
async function bridgeRequest(
  start: (signal: AbortSignal) => Promise<unknown>,
): Promise<BridgeRequest> {
  const postMessage = vi.spyOn(window, 'postMessage')
  const controller = new AbortController()
  const ceremony = start(controller.signal).catch((): string => 'aborted')
  const sent: unknown = postMessage.mock.calls[0]?.[0]
  controller.abort()
  await ceremony
  postMessage.mockRestore()
  if (!sent || typeof sent !== 'object' || !('request' in sent)) {
    throw new Error('The bridge sent no request.')
  }
  const request = sent.request
  return {
    ceremony: 'ceremony' in sent ? sent.ceremony : 'absent',
    userVerification:
      request && typeof request === 'object' && 'userVerification' in request
        ? request.userVerification
        : 'absent',
  }
}

const challenge = new Uint8Array(32).fill(7)

describe('page WebAuthn bridge', () => {
  test("passes the site's sign-in user verification request to Nook", async () => {
    const preferred = await bridgeRequest((signal) =>
      navigator.credentials.get({
        signal,
        publicKey: {
          challenge,
          rpId: 'example.com',
          userVerification: 'preferred',
        },
      }),
    )
    expect(preferred.ceremony).toBe('get')
    expect(preferred.userVerification).toBe('preferred')

    const unspecified = await bridgeRequest((signal) =>
      navigator.credentials.get({
        signal,
        publicKey: { challenge, rpId: 'example.com' },
      }),
    )
    expect(unspecified.userVerification).toBe('absent')
  })

  test("passes the site's registration user verification request to Nook", async () => {
    const required = await bridgeRequest((signal) =>
      navigator.credentials.create({
        signal,
        publicKey: {
          challenge,
          rp: { id: 'example.com', name: 'Example' },
          user: {
            id: new Uint8Array(8).fill(1),
            name: 'alice@example.com',
            displayName: 'Alice',
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { userVerification: 'required' },
        },
      }),
    )
    expect(required.ceremony).toBe('create')
    expect(required.userVerification).toBe('required')
  })
})
