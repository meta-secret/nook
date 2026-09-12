import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest'
import {
  WebsitePasskeyCeremony,
  WebsitePasskeyOptionsMessageType,
  WebsitePasskeyOptionsStatus,
} from '../../../../nook-web-extension/src/lib/webauthn-message-types'
import type {
  WebsitePasskeyOptionsMessage,
  WebsitePasskeyOptionsResponse,
} from '../../../../nook-web-extension/src/lib/webauthn-messages'
import { PageResponseAction } from '../../../../nook-web-extension/src/content/webauthn-options-response'

beforeAll(async () => {
  await import('../../../../nook-web-extension/src/content/webauthn-content')
})

afterEach(() => {
  document.body.replaceChildren()
  document.querySelector('aside[aria-label="Nook passkey"]')?.remove()
  Reflect.deleteProperty(globalThis, 'chrome')
  vi.restoreAllMocks()
})

afterAll(() => {
  Reflect.deleteProperty(globalThis, '__nookAuthenticationDirectSubmitBridgeV1')
})

describe('WebAuthn content transport', () => {
  test('delivers a live page request through the extension runtime before prompting', async () => {
    const delivered: WebsitePasskeyOptionsMessage[] = []
    Object.assign(globalThis, {
      chrome: {
        i18n: { getMessage: () => '' },
        runtime: {
          sendMessage: (
            message: WebsitePasskeyOptionsMessage,
            callback: (response: WebsitePasskeyOptionsResponse) => void,
          ) => {
            delivered.push(message)
            callback({
              ok: true,
              status: WebsitePasskeyOptionsStatus.Ready,
              options: [
                {
                  vaultStoreId: 'vault',
                  vaultName: 'Private vault',
                },
              ],
            })
          },
        },
      },
    })
    const expiresAt = Date.now() + 10_000

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: {
          source: 'nook-passkey-page-v1',
          type: 'request',
          requestId: 'request-00000001',
          ceremony: WebsitePasskeyCeremony.Create,
          request: { relyingParty: { name: 'Example' } },
          expiresAt,
        },
      }),
    )

    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    expect(delivered[0]).toEqual({
      type: WebsitePasskeyOptionsMessageType.NookWebsitePasskeyOptions,
      payload: {
        requestId: 'request-00000001',
        ceremony: WebsitePasskeyCeremony.Create,
        requestJson: JSON.stringify({ relyingParty: { name: 'Example' } }),
        expiresAt,
      },
    })
    expect(
      document.querySelector('aside[aria-label="Nook passkey"]'),
    ).toBeTruthy()
  })

  test('falls back without prompting when runtime delivery is rejected', async () => {
    const delivered: WebsitePasskeyOptionsMessage[] = []
    Object.assign(globalThis, {
      chrome: {
        i18n: { getMessage: () => '' },
        runtime: {
          lastError: { message: 'runtime delivery unavailable' },
          sendMessage: (
            message: WebsitePasskeyOptionsMessage,
            callback: (response: WebsitePasskeyOptionsResponse) => void,
          ) => {
            delivered.push(message)
            callback({ ok: false, reason: 'delivery-failed' })
          },
        },
      },
    })
    const postMessage = vi.spyOn(window, 'postMessage')
    const expiresAt = Date.now() + 10_000

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: {
          source: 'nook-passkey-page-v1',
          type: 'request',
          requestId: 'request-00000002',
          ceremony: WebsitePasskeyCeremony.Get,
          request: { rpId: 'example.test' },
          expiresAt,
        },
      }),
    )

    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: 'nook-passkey-extension-v1',
          requestId: 'request-00000002',
          action: PageResponseAction.Fallback,
        },
        location.origin,
      ),
    )
    expect(
      document.querySelector('aside[aria-label="Nook passkey"]'),
    ).toBeFalsy()
  })
})
