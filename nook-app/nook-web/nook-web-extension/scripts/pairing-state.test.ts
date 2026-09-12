import { describe, expect, mock, test } from 'bun:test'
import type { ExtensionReadySetupState } from '../src/background/pairing-grants'
import {
  ExtensionPairingStateQueryMessage,
  ExtensionPairingStateQueryMessageType,
  ExtensionPairingStateLoader,
  ExtensionSetupLoadKind,
} from '../src/lib/pairing-state'

const readySetup: ExtensionReadySetupState = {
  status: 'ready',
  deviceLabel: 'Nook Extension',
  pairedVaults: ['Personal'],
  selectedVaultStoreId: 'vault-1',
  selectedVaultName: 'Personal',
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-1'],
  lastLocalSyncAt: '2026-09-12T00:00:00.000Z',
}

const pairingPolicy = Promise.resolve({
  isExtensionReadySetupState: (
    value: unknown,
  ): value is ExtensionReadySetupState => value === readySetup,
})

describe('extension pairing state loader', () => {
  test('keeps the query message structural while loading setup through its transport owner', async () => {
    const sentMessages: ExtensionPairingStateQueryMessage[] = []
    const sendMessage = mock(
      (
        message: ExtensionPairingStateQueryMessage,
        respond: (response: unknown) => void,
      ) => {
        sentMessages.push(message)
        respond({ ok: true, setup: readySetup })
      },
    )
    Object.assign(globalThis, {
      chrome: { runtime: { sendMessage, lastError: false } },
    })
    const loader = new ExtensionPairingStateLoader({
      browser: globalThis,
      pairingPolicy,
    })

    expect(
      ExtensionPairingStateQueryMessage.is({
        type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery,
      }),
    ).toBe(true)
    expect('loadExtensionSetupState' in ExtensionPairingStateQueryMessage).toBe(
      false,
    )
    expect(await loader.loadExtensionSetupState()).toEqual({
      kind: ExtensionSetupLoadKind.Ready,
      setup: readySetup,
    })
    expect(sentMessages).toEqual([
      {
        type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery,
      },
    ])
  })

  test('projects malformed runtime responses to unavailable setup', async () => {
    const sendMessage = mock(
      (
        _message: ExtensionPairingStateQueryMessage,
        respond: (response: unknown) => void,
      ) => respond({ ok: true, setup: { status: 'not-ready' } }),
    )
    Object.assign(globalThis, {
      chrome: { runtime: { sendMessage, lastError: false } },
    })
    const loader = new ExtensionPairingStateLoader({
      browser: globalThis,
      pairingPolicy,
    })

    expect(await loader.loadExtensionSetupState()).toEqual({
      kind: ExtensionSetupLoadKind.Unavailable,
    })
  })
})
