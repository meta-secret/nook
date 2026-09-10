import { afterEach, describe, expect, test, vi } from 'vitest'
import { browserDataLifecycle } from '$lib/runtime/browser-data'
import { VaultStorageFailureKind } from '$lib/runtime/storage-failure'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('local data recovery support', () => {
  test('rejects missing Web Locks before contacting peer tabs', async () => {
    const broadcastChannel = vi.fn()
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('BroadcastChannel', broadcastChannel)

    const support = browserDataLifecycle.requireLocalDataRecoverySupport()
    expect(support.isErr() ? support.error.kind : support.value).toBe(
      VaultStorageFailureKind.LockUnavailable,
    )
    const quiescence =
      await browserDataLifecycle.quiesceOtherTabsForLocalRecovery()
    expect(quiescence.isErr() ? quiescence.error.kind : quiescence.value).toBe(
      VaultStorageFailureKind.LockUnavailable,
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

    const pending = browserDataLifecycle.quiesceOtherTabsForLocalRecovery()
    await vi.runAllTimersAsync()
    const rejection = await pending
    expect(rejection.isErr() ? rejection.error.kind : rejection.value).toBe(
      VaultStorageFailureKind.PeerFailed,
    )
    expect(messages.some((message) => message.type === 'reload')).toBe(true)
  })

  test('preserves a peer failure when the compensating reload also fails', async () => {
    vi.useFakeTimers()
    let channelCount = 0

    class RecoveryChannel {
      onmessage?: (event: MessageEvent) => void

      constructor() {
        channelCount += 1
        if (channelCount > 1) throw new Error('reload channel failed')
      }

      postMessage(message: {
        readonly type: string
        readonly requestId?: string
        readonly senderId: string
      }): void {
        if (message.type !== 'request' || !message.requestId) return
        queueMicrotask(() => {
          this.onmessage?.({
            data: {
              type: 'seen',
              requestId: message.requestId,
              senderId: message.senderId,
              responderId: 'failed-peer',
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

    const pending = browserDataLifecycle.quiesceOtherTabsForLocalRecovery()
    await vi.runAllTimersAsync()
    const rejection = await pending

    expect(rejection.isErr() ? rejection.error.kind : rejection.value).toBe(
      VaultStorageFailureKind.PeerFailed,
    )
  })
})
