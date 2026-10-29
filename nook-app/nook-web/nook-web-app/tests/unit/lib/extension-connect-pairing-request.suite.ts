import { describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { BeginExtensionPairingMessage as BeginExtensionPairingMessageGuard } from '../../../../nook-web-shared/src/extension/runtime-messages'
import './extension-connect-test-support'

describe('extension-owned pairing start', () => {
  test('requires the complete extension device request', () => {
    expect(
      Effect.runSync(
        Effect.result(
          BeginExtensionPairingMessageGuard.decode({
            type: 'nook:begin-extension-pairing',
            payload: {
              deviceId: 'device-1',
              devicePublicKey: 'age1device',
              deviceSigningPublicKey: 'signing-key',
              deviceLabel: 'Nook Extension',
              windowId: 7,
              connectId: 'connect-1',
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          BeginExtensionPairingMessageGuard.decode({
            type: 'nook:begin-extension-pairing',
            payload: {
              deviceId: 'device-1',
              devicePublicKey: '',
              deviceSigningPublicKey: 'signing-key',
              deviceLabel: 'Nook Extension',
              windowId: 7,
              connectId: 'connect-1',
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
    // The requesting page's window and connect id are part of the request.
    expect(
      Effect.runSync(
        Effect.result(
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
    ).toBe('Failure')
  })
})
