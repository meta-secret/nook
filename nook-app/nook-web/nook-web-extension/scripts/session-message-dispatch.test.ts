import { describe, expect, test } from 'bun:test'
import {
  ExtensionSessionMessageType,
  ExtensionSessionMessageDispatcher,
} from '../src/offscreen/session-message-dispatch'

function messagePayload(message: unknown): Record<string, unknown> {
  if (!message || typeof message !== 'object' || !('payload' in message)) {
    return {}
  }
  const payload = message.payload
  return payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : {}
}

describe('ExtensionSessionMessageDispatcher', () => {
  test('stages sensitive fields and clears the caller-owned payload', async () => {
    const payload: Record<string, unknown> = { pin: '123456' }
    const dispatcher = new ExtensionSessionMessageDispatcher({
      messagePayload,
      handleMessage: async (message) => ({
        pin: messagePayload(message).pin,
      }),
    })

    const response = dispatcher.enqueue({
      type: ExtensionSessionMessageType.CreatePin,
      payload,
    })

    expect(payload.pin).toBe('')
    await expect(response).resolves.toEqual({ pin: '123456' })
  })

  test('rejects non-serialized providers before dispatching a vault import', async () => {
    const providers = [
      {
        githubPat: 'github_pat_rejected_secret',
        metadata: new Date(),
      },
    ]
    const payload: Record<string, unknown> = {
      providers,
    }
    let handled = false
    const dispatcher = new ExtensionSessionMessageDispatcher({
      messagePayload,
      handleMessage: async () => {
        handled = true
        return { ok: true }
      },
    })

    const response = await dispatcher.enqueue({
      type: ExtensionSessionMessageType.ImportVault,
      payload,
    })

    expect(response).toEqual({
      ok: false,
      error: 'invalid-provider-payload',
    })
    expect(handled).toBe(false)
    expect(payload.providers).toEqual([])
    expect(providers[0]).not.toHaveProperty('githubPat')
  })

  test('rejects runtime messages from another extension', () => {
    type RuntimeListener = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean
    enum ListenerRegistrationKind {
      NotRegistered = 'not-registered',
      Registered = 'registered',
    }

    type ListenerRegistration =
      | { kind: ListenerRegistrationKind.NotRegistered }
      | { kind: ListenerRegistrationKind.Registered; listener: RuntimeListener }
    let registration: ListenerRegistration = {
      kind: ListenerRegistrationKind.NotRegistered,
    }
    globalThis.chrome = {
      runtime: {
        id: 'nook-extension',
        getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
        onMessage: {
          addListener: (registered: RuntimeListener) => {
            registration = {
              kind: ListenerRegistrationKind.Registered,
              listener: registered,
            }
          },
        },
      },
    } as typeof chrome
    const dispatcher = new ExtensionSessionMessageDispatcher({
      messagePayload,
      handleMessage: async () => ({ ok: true }),
    })
    dispatcher.registerRuntimeListener()

    if (registration.kind === ListenerRegistrationKind.NotRegistered) {
      throw new Error('runtime listener was not registered')
    }
    expect(
      registration.listener(
        { type: ExtensionSessionMessageType.Status },
        { id: 'other-extension' },
        () => {},
      ),
    ).toBe(false)
  })
})
