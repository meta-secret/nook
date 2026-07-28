import { describe, expect, test } from 'bun:test'
import { ExtensionSessionMessageDispatcher } from '../src/offscreen/session-message-dispatch'

function messageType(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return undefined
  }
  return typeof message.type === 'string' ? message.type : undefined
}

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
      messageType,
      messagePayload,
      handleMessage: async (message) => ({
        pin: messagePayload(message).pin,
      }),
    })

    const response = dispatcher.enqueue({
      type: 'nook:extension-session-create-pin',
      payload,
    })

    expect(payload.pin).toBe('')
    await expect(response).resolves.toEqual({ pin: '123456' })
  })

  test('rejects runtime messages from another extension', () => {
    let listener:
      | ((
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean)
      | undefined
    globalThis.chrome = {
      runtime: {
        id: 'nook-extension',
        getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
        onMessage: {
          addListener: (registered: typeof listener) => {
            listener = registered
          },
        },
      },
    } as typeof chrome
    const dispatcher = new ExtensionSessionMessageDispatcher({
      messageType,
      messagePayload,
      handleMessage: async () => ({ ok: true }),
    })
    dispatcher.registerRuntimeListener()

    expect(
      listener?.(
        { type: 'nook:extension-session-status' },
        { id: 'other-extension' },
        () => undefined,
      ),
    ).toBe(false)
  })
})
