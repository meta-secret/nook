/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Chrome test doubles provide the minimal tab contract exercised by this suite. */
import { err, ok } from 'neverthrow'
import { describe, expect, test } from 'bun:test'
import {
  ExtensionSessionMessageDispatcher,
  ExtensionSessionMessageType,
  decodeProviders,
  githubProvider,
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  vaultImportRequest,
  type StorageProvider,
} from './session-message-dispatch-test-support'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../src/lib/session-operation-queue'

describe('ExtensionSessionMessageDispatcher lifecycle cancellation', () => {
  test('cancels a running import when the session generation changes', async () => {
    let finishDecode: (providers: StorageProvider[]) => void = () => {
      throw new Error('provider decoder was not initialized')
    }
    const decodedProviders = new Promise<StorageProvider[]>((resolve) => {
      finishDecode = resolve
    })
    const stagedProviders = [githubProvider('github_pat_expired_staged_secret')]
    const handledTypes: string[] = []
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders: () => decodedProviders,
      handleMessage: async (message) => {
        const type =
          message && typeof message === 'object' && 'type' in message
            ? String(message.type)
            : ''
        handledTypes.push(type)
        return ok({ ok: true })
      },
    })

    const importResponse = dispatcher.enqueue(
      vaultImportRequest([githubProvider('caller-secret')]),
    )
    await Promise.resolve()
    dispatcher.replaceOperations(
      new SessionOperationFailure(SessionOperationFailureKind.Closed),
    )
    finishDecode(stagedProviders)

    expect(await importResponse).toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Expired)),
    )
    expect(handledTypes).toEqual([])
    expect(stagedProviders[0]?.githubPat).toEqual({ state: 'missing' })
  })

  test('a session activated mid-operation starts the next message only after that operation ends', async () => {
    // Unlock and passkey setup activate the session from inside their own
    // operation, then still use the vault manager. A message that arrives
    // meanwhile (the side panel re-reading status) must wait: two operations
    // on one manager make wasm-bindgen throw and leave the queue hung.
    const activated = Promise.withResolvers<void>()
    const finishActivation = Promise.withResolvers<void>()
    const events: string[] = []
    const dispatcher: ExtensionSessionMessageDispatcher<unknown> =
      new ExtensionSessionMessageDispatcher({
        decodeProviders,
        handleMessage: async (message) => {
          events.push(`start ${message.type}`)
          if (
            message.type === ExtensionSessionMessageType.MigrateAuthProviders
          ) {
            dispatcher.resetOperations()
            activated.resolve()
            await finishActivation.promise
          }
          events.push(`end ${message.type}`)
          return ok({ ok: true })
        },
      })

    const activating = dispatcher.enqueue({
      type: ExtensionSessionMessageType.MigrateAuthProviders,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    })
    await activated.promise
    const status = dispatcher.enqueue({
      type: ExtensionSessionMessageType.Status,
      payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events).toEqual([
      `start ${ExtensionSessionMessageType.MigrateAuthProviders}`,
    ])

    finishActivation.resolve()
    await activating
    await status
    expect(events).toEqual([
      `start ${ExtensionSessionMessageType.MigrateAuthProviders}`,
      `end ${ExtensionSessionMessageType.MigrateAuthProviders}`,
      `start ${ExtensionSessionMessageType.Status}`,
      `end ${ExtensionSessionMessageType.Status}`,
    ])
  })

  test('rejects foreign and malformed runtime messages without hanging', async () => {
    type RuntimeListener = Parameters<
      typeof chrome.runtime.onMessage.addListener
    >[0]
    const registered = Promise.withResolvers<RuntimeListener>()
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          id: 'nook-extension',
          getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
          onMessage: {
            addListener: registered.resolve,
          },
        },
      },
    })
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders,
      handleMessage: async () => ok({ ok: true }),
    })
    chrome.runtime.onMessage.addListener(dispatcher.listener())
    const listener = await registered.promise
    expect(
      Boolean(
        listener(
          { type: ExtensionSessionMessageType.Status },
          { id: 'other-extension' },
          () => {},
        ),
      ),
    ).toBe(false)

    let unrelatedMessageResponded = false
    const unrelatedMessage = { type: 'nook:website-login-options' }
    const sameExtensionSender: chrome.runtime.MessageSender = {
      id: 'nook-extension',
    }
    const unrelatedResponse = () => {
      unrelatedMessageResponded = true
    }
    expect(
      Boolean(
        listener(unrelatedMessage, sameExtensionSender, unrelatedResponse),
      ),
    ).toBe(false)
    await Promise.resolve()
    expect(unrelatedMessageResponded).toBe(false)

    let lockMessageResponded = false
    const lockResponse = () => {
      lockMessageResponded = true
    }
    expect(
      Boolean(
        listener(
          { type: ExtensionSessionMessageType.Lock },
          sameExtensionSender,
          lockResponse,
        ),
      ),
    ).toBe(false)
    await Promise.resolve()
    expect(lockMessageResponded).toBe(false)

    const malformedResponse = new Promise<unknown>((resolve) => {
      const sender: chrome.runtime.MessageSender = { id: 'nook-extension' }
      const keepsResponseChannelOpen = listener(
        { type: ExtensionSessionMessageType.Status },
        sender,
        resolve,
      )
      expect(Boolean(keepsResponseChannelOpen)).toBe(true)
    })
    expect(await malformedResponse).toEqual({
      ok: false,
      error: 'Invalid extension session request.',
    })
  })

  test('responds to a status request when the session queue rejects', async () => {
    const dispatcher = new ExtensionSessionMessageDispatcher({
      decodeProviders,
      handleMessage: async () => ok({ ok: true }),
    })
    dispatcher.enqueue = () => Promise.reject(new Error('status rejected'))
    const statusResponse = Promise.withResolvers<unknown>()
    const keepsResponseChannelOpen = dispatcher.listener()(
      {
        type: ExtensionSessionMessageType.Status,
        payload: { queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE },
      },
      { id: 'nook-extension' },
      statusResponse.resolve,
    )

    expect(Boolean(keepsResponseChannelOpen)).toBe(true)
    expect(await statusResponse.promise).toEqual({
      ok: false,
      error: SessionOperationFailureKind.Failed,
    })
  })

  test('leaves content companion WASM requests for the service worker', async () => {
    const dispatcher = new ExtensionSessionMessageDispatcher({
      handleCompanionWasmMessage: async () => ok({ ok: true }),
      decodeProviders,
      handleMessage: async () => ok({ ok: true }),
    })
    let responded = false
    const handled = dispatcher.listener()(
      {
        type: 'nook:extension-session-classify-page-inputs',
        origin: 'https://accounts.google.com',
        payload: { fields: [], labels: [] },
      },
      {
        id: 'nook-extension',
        tab: { id: 7 } as chrome.tabs.Tab,
        url: 'https://accounts.google.com/v3/signin/identifier',
      },
      () => {
        responded = true
      },
    )

    expect(Boolean(handled)).toBe(false)
    await Promise.resolve()
    expect(responded).toBe(false)
  })
})
