import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  quiesceOtherTabsForLocalRecovery,
  requireLocalDataRecoverySupport,
} from '$lib/runtime/browser-data'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('local data recovery support', () => {
  test('rejects missing Web Locks before contacting peer tabs', async () => {
    const broadcastChannel = vi.fn()
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('BroadcastChannel', broadcastChannel)

    expect(() => requireLocalDataRecoverySupport()).toThrow(
      'Safe cross-tab local data deletion is unavailable',
    )
    await expect(quiesceOtherTabsForLocalRecovery()).rejects.toThrow(
      'Safe cross-tab local data deletion is unavailable',
    )
    expect(broadcastChannel).not.toHaveBeenCalled()
  })

  test('reloads ready peers when another peer fails to quiesce', async () => {
    vi.useFakeTimers()
    const messages: Array<{ readonly type: string }> = []

    class RecoveryChannel {
      onmessage?: (event: MessageEvent) => void

      postMessage(message: {
        readonly type: string
        readonly requestId?: string
        readonly senderId: string
      }): void {
        messages.push(message)
        if (message.type !== 'request' || !message.requestId) return
        queueMicrotask(() => {
          for (const responderId of ['ready-peer', 'failed-peer']) {
            this.onmessage?.({
              data: {
                type: 'seen',
                requestId: message.requestId,
                senderId: message.senderId,
                responderId,
              },
            } as MessageEvent)
          }
          this.onmessage?.({
            data: {
              type: 'ready',
              requestId: message.requestId,
              senderId: message.senderId,
              responderId: 'ready-peer',
              readiness: { kind: 'ready' },
            },
          } as MessageEvent)
          this.onmessage?.({
            data: {
              type: 'ready',
              requestId: message.requestId,
              senderId: message.senderId,
              responderId: 'failed-peer',
              readiness: { kind: 'failed', error: 'peer failed' },
            },
          } as MessageEvent)
        })
      }

      close(): void {}
    }

    vi.stubGlobal('navigator', { locks: {} })
    vi.stubGlobal('BroadcastChannel', RecoveryChannel)

    const rejection = expect(
      quiesceOtherTabsForLocalRecovery(),
    ).rejects.toThrow('peer failed')
    await vi.runAllTimersAsync()
    await rejection
    expect(messages.some((message) => message.type === 'reload')).toBe(true)
  })
})
