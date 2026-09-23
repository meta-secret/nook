import { afterEach, describe, expect, test, vi } from 'vitest'
import { err, ok, type Result } from 'neverthrow'
import {
  BrowserDataCleanupFailure,
  browserDataLifecycle,
  type LocalDataStorageOperation,
} from '$lib/runtime/browser-data'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { browserLogRuntime } from '$lib/runtime/log'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

function messageEvent(event: MessageEventInit): MessageEvent {
  return new MessageEvent('message', event)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('local data recovery support', () => {
  test('keeps a localStorage generation mismatch as a reload alert', async () => {
    const getItem = vi.fn(() => 'current-generation')
    const operation = vi.fn(() => ok('completed'))
    vi.stubGlobal('localStorage', { getItem })
    vi.stubGlobal('navigator', {})
    const storageOperation: LocalDataStorageOperation<string> = {
      generation: 'captured-generation',
      operation,
    }

    const result =
      await browserDataLifecycle.runWithLocalDataStorageLock(storageOperation)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.kind).toBe(VaultStorageFailureKind.GenerationChanged)
      expect(result.error.translationKey).toBe(
        I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab,
      )
    }
    expect(getItem).toHaveBeenCalledOnce()
    expect(operation).not.toHaveBeenCalled()
  })

  test('keeps unavailable marker reads as a reload alert', async () => {
    const getItem = vi.fn(() => {
      throw new Error('local storage unavailable')
    })
    vi.stubGlobal('localStorage', { getItem })
    vi.stubGlobal('navigator', {})
    const storageOperation: LocalDataStorageOperation<string> = {
      generation: 'captured-generation',
      operation: () => ok('completed'),
    }

    const result =
      await browserDataLifecycle.runWithLocalDataStorageLock(storageOperation)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.kind).toBe(
        VaultStorageFailureKind.GenerationUnavailable,
      )
      expect(result.error.translationKey).toBe(
        I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab,
      )
    }
  })

  test('keeps active deletion as a reload alert', async () => {
    const state = VaultStateTestFixture.create()
    state.localDataDeletionStarted = true
    const operation = vi.fn(() => ok('completed'))

    const result = await state.enqueueStorage(operation)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.kind).toBe(VaultStorageFailureKind.DeletionActive)
      expect(result.error.translationKey).toBe(
        I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab,
      )
    }
    expect(operation).not.toHaveBeenCalled()
  })

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
            this.onmessage?.(
              messageEvent({
                data: {
                  type: 'seen',
                  requestId: message.requestId,
                  senderId: message.senderId,
                  responderId,
                },
              }),
            )
          }
          this.onmessage?.(
            messageEvent({
              data: {
                type: 'ready',
                requestId: message.requestId,
                senderId: message.senderId,
                responderId: 'ready-peer',
                readiness: { kind: 'ready' },
              },
            }),
          )
          this.onmessage?.(
            messageEvent({
              data: {
                type: 'ready',
                requestId: message.requestId,
                senderId: message.senderId,
                responderId: 'failed-peer',
                readiness: { kind: 'failed', error: 'peer failed' },
              },
            }),
          )
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
          this.onmessage?.(
            messageEvent({
              data: {
                type: 'seen',
                requestId: message.requestId,
                senderId: message.senderId,
                responderId: 'failed-peer',
              },
            }),
          )
          this.onmessage?.(
            messageEvent({
              data: {
                type: 'ready',
                requestId: message.requestId,
                senderId: message.senderId,
                responderId: 'failed-peer',
                readiness: { kind: 'failed', error: 'peer failed' },
              },
            }),
          )
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

  test('reports a rejected peer cleanup as failed readiness', async () => {
    const messages: Array<{ readonly readiness?: { readonly kind: string } }> =
      []
    class RecoveryChannel {
      static instance: RecoveryChannel
      onmessage?: (event: MessageEvent) => void
      constructor() {
        RecoveryChannel.instance = this
      }
      postMessage(message: { readonly readiness?: { readonly kind: string } }) {
        messages.push(message)
      }
      close(): void {}
    }
    vi.stubGlobal('BroadcastChannel', RecoveryChannel)

    const subscription =
      browserDataLifecycle.subscribeToLocalBrowserDataDeletion(() =>
        Promise.reject(new Error('peer cleanup rejected')),
      )
    expect(subscription.isOk()).toBe(true)
    RecoveryChannel.instance.onmessage?.(
      messageEvent({
        data: {
          type: 'request',
          requestId: 'request-1',
          senderId: 'other-tab',
        },
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(
      messages.some((message) => message.readiness?.kind === 'failed'),
    ).toBe(true)
    if (subscription.isOk()) subscription.value()
  })

  test('preserves database and browser cleanup failures together', async () => {
    vi.spyOn(browserLogRuntime, 'suspendWasmLogging').mockResolvedValue()
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          ...request: [
            string,
            LockOptions,
            () => Promise<Result<void, VaultStorageFailure>>,
          ]
        ) => request[2](),
      },
    })
    class RecoveryChannel {
      onmessage?: (event: MessageEvent) => void
      postMessage(): void {}
      close(): void {}
    }
    vi.stubGlobal('BroadcastChannel', RecoveryChannel)
    vi.stubGlobal('caches', {
      keys: () => Promise.reject(new Error('cache cleanup failed')),
    })

    const databaseFailure = new VaultStorageFailure(
      VaultStorageFailureKind.OperationFailed,
    )
    const outcome = await browserDataLifecycle.deleteLocalBrowserData(
      async () => err(databaseFailure),
    )

    expect(outcome.isErr()).toBe(true)
    if (outcome.isErr()) {
      expect(outcome.error).toBeInstanceOf(BrowserDataCleanupFailure)
      if (outcome.error instanceof BrowserDataCleanupFailure) {
        expect(outcome.error.failures).toHaveLength(2)
      }
    }
  })
})
