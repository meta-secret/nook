import { describe, expect, mock, test } from 'bun:test'
import { type ExtensionReadySetupState } from '../src/background/pairing-grants'
import { Effect } from 'effect'
import {
  ExtensionPairingSetupResponseKind,
  ExtensionPairingStateQueryMessage,
  ExtensionPairingStateQueryMessageType,
  ExtensionPairingStateLoader,
  ExtensionSetupLoadKind,
  extensionPairingStateQueryResponseFromStorage,
} from '../src/lib/pairing-state'

const readySetup: ExtensionReadySetupState = {
  status: 'ready',
  deviceLabel: 'Nook Extension',
  pairedVaults: ['Personal'],
  selectedVaultStoreId: 'store_abcdefghijk',
  selectedVaultName: 'Personal',
  syncProviderCount: 0,
  eventCount: 1,
  eventLogHeads: ['event-1'],
  lastLocalSyncAt: '2026-09-12T00:00:00.000Z',
}

describe('extension pairing state loader', () => {
  test('encodes absent stored setup with an explicit not-connected tag', () => {
    expect(extensionPairingStateQueryResponseFromStorage({}, 'setup')).toEqual({
      ok: true,
      setupState: ExtensionPairingSetupResponseKind.NotConnected,
    })
  })

  test('encodes valid stored setup with an explicit ready tag and payload', () => {
    expect(
      extensionPairingStateQueryResponseFromStorage(
        { setup: readySetup },
        'setup',
      ),
    ).toEqual({
      ok: true,
      setupState: ExtensionPairingSetupResponseKind.Ready,
      setup: readySetup,
    })
  })

  test('rejects malformed stored setup instead of encoding it as ready', () => {
    expect(
      extensionPairingStateQueryResponseFromStorage(
        { setup: { status: 'not-ready' } },
        'setup',
      ),
    ).toEqual({ ok: false, reason: 'pairing-state-invalid' })
  })

  test('keeps the query message structural while loading setup through its transport owner', async () => {
    const sentMessages: ExtensionPairingStateQueryMessage[] = []
    const sendMessage = mock(
      (
        message: ExtensionPairingStateQueryMessage,
        respond: (response: unknown) => void,
      ) => {
        sentMessages.push(message)
        respond({
          ok: true,
          setupState: ExtensionPairingSetupResponseKind.Ready,
          setup: readySetup,
        })
      },
    )
    Object.assign(globalThis, {
      chrome: { runtime: { sendMessage, lastError: false } },
    })
    const loader = new ExtensionPairingStateLoader({ browser: globalThis })

    expect(
      await Effect.runPromise(
        ExtensionPairingStateQueryMessage.decode({
          type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery,
        }),
      ),
    ).toEqual({
      type: ExtensionPairingStateQueryMessageType.NookExtensionPairingStateQuery,
    })
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
      ) =>
        respond({
          ok: true,
          setupState: ExtensionPairingSetupResponseKind.Ready,
          setup: { status: 'not-ready' },
        }),
    )
    Object.assign(globalThis, {
      chrome: { runtime: { sendMessage, lastError: false } },
    })
    const loader = new ExtensionPairingStateLoader({ browser: globalThis })

    expect(await loader.loadExtensionSetupState()).toEqual({
      kind: ExtensionSetupLoadKind.Unavailable,
    })
  })

  test('classifies the explicit not-connected response tag', async () => {
    const sendMessage = mock(
      (
        _message: ExtensionPairingStateQueryMessage,
        respond: (response: unknown) => void,
      ) =>
        respond({
          ok: true,
          setupState: ExtensionPairingSetupResponseKind.NotConnected,
        }),
    )
    Object.assign(globalThis, {
      chrome: { runtime: { sendMessage, lastError: false } },
    })
    const loader = new ExtensionPairingStateLoader({ browser: globalThis })

    expect(await loader.loadExtensionSetupState()).toEqual({
      kind: ExtensionSetupLoadKind.NotConnected,
    })
  })

  test('keeps failed status queries unavailable', async () => {
    const sendMessage = mock(
      (
        _message: ExtensionPairingStateQueryMessage,
        respond: (response: unknown) => void,
      ) => respond({ ok: false, reason: 'pairing-state-read-failed' }),
    )
    Object.assign(globalThis, {
      chrome: { runtime: { sendMessage, lastError: false } },
    })
    const loader = new ExtensionPairingStateLoader({ browser: globalThis })

    expect(await loader.loadExtensionSetupState()).toEqual({
      kind: ExtensionSetupLoadKind.Unavailable,
    })
  })

  test('keeps runtime transport errors unavailable', async () => {
    const sendMessage = mock(
      (
        _message: ExtensionPairingStateQueryMessage,
        respond: (response: unknown) => void,
      ) =>
        respond({
          ok: true,
          setupState: ExtensionPairingSetupResponseKind.Ready,
          setup: readySetup,
        }),
    )
    Object.assign(globalThis, {
      chrome: { runtime: { sendMessage, lastError: { message: 'failed' } } },
    })
    const loader = new ExtensionPairingStateLoader({ browser: globalThis })

    expect(await loader.loadExtensionSetupState()).toEqual({
      kind: ExtensionSetupLoadKind.Unavailable,
    })
  })

  test('keeps an untagged successful response unavailable', async () => {
    const sendMessage = mock(
      (
        _message: ExtensionPairingStateQueryMessage,
        respond: (response: unknown) => void,
      ) => respond({ ok: true, setup: readySetup }),
    )
    Object.assign(globalThis, {
      chrome: { runtime: { sendMessage, lastError: false } },
    })
    const loader = new ExtensionPairingStateLoader({ browser: globalThis })

    expect(await loader.loadExtensionSetupState()).toEqual({
      kind: ExtensionSetupLoadKind.Unavailable,
    })
  })

  test('keeps unknown setup-state tags unavailable', async () => {
    const sendMessage = mock(
      (
        _message: ExtensionPairingStateQueryMessage,
        respond: (response: unknown) => void,
      ) => respond({ ok: true, setupState: 'unknown' }),
    )
    Object.assign(globalThis, {
      chrome: { runtime: { sendMessage, lastError: false } },
    })
    const loader = new ExtensionPairingStateLoader({ browser: globalThis })

    expect(await loader.loadExtensionSetupState()).toEqual({
      kind: ExtensionSetupLoadKind.Unavailable,
    })
  })

  test('keeps ready responses with missing or malformed setup unavailable', async () => {
    const responses: unknown[] = [
      {
        ok: true,
        setupState: ExtensionPairingSetupResponseKind.Ready,
      },
      {
        ok: true,
        setupState: ExtensionPairingSetupResponseKind.Ready,
        setup: { status: 'ready' },
      },
    ]

    for (const runtimeResponse of responses) {
      const sendMessage = mock(
        (
          _message: ExtensionPairingStateQueryMessage,
          respond: (response: unknown) => void,
        ) => respond(runtimeResponse),
      )
      Object.assign(globalThis, {
        chrome: { runtime: { sendMessage, lastError: false } },
      })
      const loader = new ExtensionPairingStateLoader({ browser: globalThis })

      expect(await loader.loadExtensionSetupState()).toEqual({
        kind: ExtensionSetupLoadKind.Unavailable,
      })
    }
  })
})
