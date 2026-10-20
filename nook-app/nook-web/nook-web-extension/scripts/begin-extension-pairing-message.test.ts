import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  BeginExtensionPairingMessage,
  BeginExtensionPairingMessageType,
} from '../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'

type PairingPayloadFields = {
  readonly [field: string]: BrowserRuntimeMessageValue
}

class PairingMessages {
  static readonly device: PairingPayloadFields = {
    deviceId: 'device-1',
    devicePublicKey: 'public-1',
    deviceSigningPublicKey: 'signing-1',
    deviceLabel: 'Nook Extension',
    connectId: 'connect-1',
  }

  static message(payload: PairingPayloadFields): BrowserRuntimeMessageValue {
    return {
      type: BeginExtensionPairingMessageType.NookBeginExtensionPairing,
      payload,
    }
  }

  static decode(payload: PairingPayloadFields) {
    return Effect.runSync(
      Effect.result(
        BeginExtensionPairingMessage.decode(PairingMessages.message(payload)),
      ),
    )
  }
}

describe('begin-pairing message', () => {
  test('carries the requesting window as a non-negative integer', () => {
    for (const windowId of [0, 7]) {
      const decoded = PairingMessages.decode({
        ...PairingMessages.device,
        windowId,
      })
      expect(decoded._tag).toBe('Success')
      switch (decoded._tag) {
        case 'Success':
          expect(decoded.success.payload.windowId).toBe(windowId)
          break
        case 'Failure':
          break
      }
    }
  })

  test('carries the connect id that names the page port', () => {
    const decoded = PairingMessages.decode({
      ...PairingMessages.device,
      windowId: 7,
    })
    switch (decoded._tag) {
      case 'Success':
        expect(decoded.success.payload.connectId).toBe('connect-1')
        return
      case 'Failure':
        throw new Error('the begin-pairing message did not decode')
    }
  })

  test('rejects a missing or empty connect id', () => {
    const withoutId: PairingPayloadFields = {
      deviceId: 'device-1',
      devicePublicKey: 'public-1',
      deviceSigningPublicKey: 'signing-1',
      deviceLabel: 'Nook Extension',
      windowId: 7,
    }
    const rejected: PairingPayloadFields[] = [
      withoutId,
      { ...PairingMessages.device, windowId: 7, connectId: '' },
    ]
    for (const payload of rejected) {
      expect(PairingMessages.decode(payload)._tag).toBe('Failure')
    }
  })

  test('rejects a missing, negative or fractional window, and the old start choice', () => {
    const rejected: PairingPayloadFields[] = [
      PairingMessages.device,
      { ...PairingMessages.device, windowId: -1 },
      { ...PairingMessages.device, windowId: 1.5 },
      { ...PairingMessages.device, windowId: '7' },
      {
        ...PairingMessages.device,
        start: { kind: 'create', vaultName: 'Home' },
      },
    ]
    for (const payload of rejected) {
      expect(PairingMessages.decode(payload)._tag).toBe('Failure')
    }
  })
})
