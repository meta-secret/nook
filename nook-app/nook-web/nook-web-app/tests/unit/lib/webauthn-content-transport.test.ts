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
  document.querySelector('aside[aria-label="passkeyPromptLabel"]')?.remove()
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
        i18n: { getMessage: (key: string) => key },
        runtime: {
          getURL: (path: string) => path,
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
    await vi.waitFor(() =>
      expect(
        document.querySelector('aside[aria-label="passkeyPromptLabel"]'),
      ).toBeTruthy(),
    )
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
      document.querySelector('aside[aria-label="passkeyPromptLabel"]'),
    ).toBeFalsy()
  })

  test('tells the page the user declined when the prompt is closed', async () => {
    Object.assign(globalThis, {
      chrome: {
        i18n: { getMessage: (key: string) => key },
        runtime: {
          getURL: (path: string) => path,
          sendMessage: (
            _message: WebsitePasskeyOptionsMessage,
            callback: (response: WebsitePasskeyOptionsResponse) => void,
          ) => {
            callback({
              ok: true,
              status: WebsitePasskeyOptionsStatus.Ready,
              options: [{ vaultStoreId: 'vault', vaultName: 'Private vault' }],
            })
          },
        },
      },
    })
    const postMessage = vi.spyOn(window, 'postMessage')

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: {
          source: 'nook-passkey-page-v1',
          type: 'request',
          requestId: 'request-00000003',
          ceremony: WebsitePasskeyCeremony.Create,
          request: {
            relyingParty: { id: 'example.test', name: 'Example' },
            user: { name: 'alice@example.com', displayName: 'Alice' },
          },
          expiresAt: Date.now() + 10_000,
        },
      }),
    )
    await vi.waitFor(() =>
      expect(
        document.querySelector('aside[aria-label="passkeyPromptLabel"]'),
      ).toBeTruthy(),
    )
    document
      .querySelector('aside[aria-label="passkeyPromptLabel"]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )

    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: 'nook-passkey-extension-v1',
          requestId: 'request-00000003',
          action: PageResponseAction.Error,
          reason: 'NotAllowedError',
        },
        location.origin,
      ),
    )
    expect(
      document.querySelector('aside[aria-label="passkeyPromptLabel"]'),
    ).toBeFalsy()
  })

  test('a site Nook has no passkey for gets the card, not the browser', async () => {
    Object.assign(globalThis, {
      chrome: {
        i18n: { getMessage: (key: string) => key },
        runtime: {
          getURL: (path: string) => path,
          sendMessage: (
            _message: WebsitePasskeyOptionsMessage,
            callback: (response: WebsitePasskeyOptionsResponse) => void,
          ) => {
            callback({
              ok: true,
              status: WebsitePasskeyOptionsStatus.Ready,
              options: [],
            })
          },
        },
      },
    })
    const postMessage = vi.spyOn(window, 'postMessage')

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: {
          source: 'nook-passkey-page-v1',
          type: 'request',
          requestId: 'request-00000004',
          ceremony: WebsitePasskeyCeremony.Get,
          request: { rpId: 'example.test' },
          expiresAt: Date.now() + 10_000,
        },
      }),
    )

    await vi.waitFor(() =>
      expect(
        document.querySelector('aside[aria-label="passkeyPromptLabel"]'),
      ).toBeTruthy(),
    )
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: PageResponseAction.Fallback }),
      location.origin,
    )
  })
})
