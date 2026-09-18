import { describe, expect, test, vi } from 'vitest'
import { Effect } from 'effect'
import { extensionConnectionBrowser } from '$lib/extension/connect'
import {
  BeginExtensionPairingMessage as BeginExtensionPairingMessageGuard,
  ExtensionIdentityHandoffRequestMessage as ExtensionIdentityHandoffRequestMessageSchema,
} from '../../../../nook-web-shared/src/extension/runtime-messages'
import './extension-connect-test-support'

describe('extension-owned pairing start', () => {
  test('requires the complete extension device request', () => {
    expect(
      Effect.runSync(
        Effect.either(
          BeginExtensionPairingMessageGuard.decode({
            type: 'nook:begin-extension-pairing',
            payload: {
              deviceId: 'device-1',
              devicePublicKey: 'age1device',
              deviceSigningPublicKey: 'signing-key',
              deviceLabel: 'Nook Extension',
            },
          }),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          BeginExtensionPairingMessageGuard.decode({
            type: 'nook:begin-extension-pairing',
            payload: {
              deviceId: 'device-1',
              devicePublicKey: '',
              deviceSigningPublicKey: 'signing-key',
              deviceLabel: 'Nook Extension',
            },
          }),
        ),
      )._tag,
    ).toBe('Left')
  })

  test('requires complete nonce-bound identity handoff requests', () => {
    const message = {
      type: 'nook:extension-identity-handoff-request',
      payload: {
        recipientPublicKey: 'age1recipient',
        nonce: 'nonce-1',
        expectedDeviceId: 'device-1',
        expectedDevicePublicKey: 'age1device',
        expectedDeviceSigningPublicKey: 'signing-key',
      },
    }
    expect(
      Effect.runSync(
        Effect.either(
          ExtensionIdentityHandoffRequestMessageSchema.decode(message),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          ExtensionIdentityHandoffRequestMessageSchema.decode({
            ...message,
            payload: { ...message.payload, nonce: '' },
          }),
        ),
      )._tag,
    ).toBe('Left')
  })
})

describe('paired extension unlock request', () => {
  test('accepts only the response bound to its request and vault', async () => {
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-1',
    )
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: (
          extensionId: string,
          message: {
            payload: { requestId: string; vaultStoreId: string }
          },
          callback: (response: unknown) => void,
        ) => {
          expect(extensionId).toBe('extension-1')
          callback({
            ok: true,
            requestId: message.payload.requestId,
            vaultStoreId: message.payload.vaultStoreId,
          })
        },
      },
    })

    await expect(
      extensionConnectionBrowser.requestPairedExtensionUnlock(
        'store_abcdefghijk',
      ),
    ).resolves.toBe(true)
  })

  test('stops waiting when extension messaging does not answer', async () => {
    vi.useFakeTimers()
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-1',
    )
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: () => {},
      },
    })

    const result =
      extensionConnectionBrowser.requestPairedExtensionUnlock(
        'store_abcdefghijk',
      )
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(result).resolves.toBe(false)
  })
})
