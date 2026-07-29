import {
  EMPTY_VALUE,
  omittedValue,
  presentValue,
  type ValueState,
} from '../../nook-web-shared/src/explicit-state'
import { describe, expect, test } from 'bun:test'
import { ExtensionSessionMessageDispatcher } from '../src/offscreen/session-message-dispatch'

function messageType(message: unknown): string | void {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return
  }
  return typeof message.type === 'string' ? message.type : omittedValue()
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
    type RuntimeListener = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean
    let listenerState: ValueState<RuntimeListener> = EMPTY_VALUE
    globalThis.chrome = {
      runtime: {
        id: 'nook-extension',
        getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
        onMessage: {
          addListener: (registered: RuntimeListener) => {
            listenerState = presentValue(registered)
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

    if (listenerState.kind === 'empty') {
      throw new Error('runtime listener was not registered')
    }
    expect(
      listenerState.value(
        { type: 'nook:extension-session-status' },
        { id: 'other-extension' },
        () => {},
      ),
    ).toBe(false)
  })
})
