import { describe, expect, mock, test } from 'bun:test'
import { type ExtensionReadySetupState } from '../src/background/pairing-grants'
import { Effect } from 'effect'
import {
  ExtensionPairingSetupResponseKind,
  ExtensionPairingStateQueryMessage,
  ExtensionPairingStateQueryMessageType,
  ExtensionPairingStateLoader,
  ExtensionSetupLoadKind,
  extensionPairingStateQueryResponse,
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
  test('answers each connection Rust reads with its own setup tag', () => {
    expect(
      extensionPairingStateQueryResponse({ kind: 'not-connected' }),
    ).toEqual({
      ok: true,
      setupState: ExtensionPairingSetupResponseKind.NotConnected,
    })
    expect(
      extensionPairingStateQueryResponse({ kind: 'keyring-without-vault' }),
    ).toEqual({
      ok: true,
      setupState: ExtensionPairingSetupResponseKind.KeyringWithoutVault,
    })
    expect(
      extensionPairingStateQueryResponse({ kind: 'ready', setup: readySetup }),
    ).toEqual({
      ok: true,
      setupState: ExtensionPairingSetupResponseKind.Ready,
      setup: readySetup,
    })
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

  test('tells a joined keyring with no vault apart from no connection', async () => {
    const sendMessage = mock(
      (
        _message: ExtensionPairingStateQueryMessage,
        respond: (response: unknown) => void,
      ) =>
        respond({
          ok: true,
          setupState: ExtensionPairingSetupResponseKind.KeyringWithoutVault,
        }),
    )
    Object.assign(globalThis, {
      chrome: { runtime: { sendMessage, lastError: false } },
    })
    const loader = new ExtensionPairingStateLoader({ browser: globalThis })

    expect(await loader.loadExtensionSetupState()).toEqual({
      kind: ExtensionSetupLoadKind.KeyringWithoutVault,
    })
  })

  test('keeps extra response fields unavailable for every setup tag', async () => {
    const responses: unknown[] = [
      {
        ok: true,
        setupState: ExtensionPairingSetupResponseKind.NotConnected,
        extra: true,
      },
      {
        ok: true,
        setupState: ExtensionPairingSetupResponseKind.KeyringWithoutVault,
        extra: true,
      },
      {
        ok: true,
        setupState: ExtensionPairingSetupResponseKind.Ready,
        setup: readySetup,
        extra: true,
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
