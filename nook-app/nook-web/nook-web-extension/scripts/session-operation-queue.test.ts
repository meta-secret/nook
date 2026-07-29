import { describe, expect, test } from 'bun:test'
import { SessionOperationQueue } from '../src/lib/session-operation-queue'
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from '../../nook-web-shared/src/explicit-state'

function deferred() {
  let release: ValueState<() => void> = EMPTY_VALUE
  const promise = new Promise<void>((resolve) => {
    release = presentValue(resolve)
  })
  return {
    promise,
    release: () => {
      if (release.kind === 'present') release.value()
    },
  }
}

describe('SessionOperationQueue', () => {
  test('serializes work and prioritizes interactive operations', async () => {
    const queue = new SessionOperationQueue()
    const blocker = deferred()
    const order: string[] = []
    const first = queue.enqueue(async () => {
      order.push('first')
      await blocker.promise
    })
    const normal = queue.enqueue(async () => {
      order.push('normal')
    })
    const interactive = queue.enqueue(
      async () => {
        order.push('interactive')
      },
      { priority: 'interactive' },
    )

    blocker.release()
    await Promise.all([first, normal, interactive])

    expect(order).toEqual(['first', 'interactive', 'normal'])
  })

  test('expires queued work and clears its sensitive input', async () => {
    const queue = new SessionOperationQueue()
    const blocker = deferred()
    const first = queue.enqueue(() => blocker.promise)
    let password: ValueState<string> = presentValue('temporary-password')
    const queued = queue.enqueue(
      async () => {
        throw new Error(
          `Unexpected password use: ${
            password.kind === 'present' ? password.value : 'cleared'
          }`,
        )
      },
      {
        priority: 'interactive',
        expiresAt: Date.now() + 10,
        onExpire: () => {
          password = EMPTY_VALUE
        },
      },
    )

    await expect(queued).rejects.toThrow('EXTENSION_SESSION_REQUEST_EXPIRED')
    expect(password.kind).toBe('empty')
    blocker.release()
    await first
  })

  test('continues after an operation fails', async () => {
    const queue = new SessionOperationQueue()
    const failed = queue.enqueue(async () => {
      throw new Error('expected failure')
    })
    await expect(failed).rejects.toThrow('expected failure')
    expect(await queue.enqueue(async () => 'ok')).toBe('ok')
  })

  test('closes terminally and clears queued sensitive input', async () => {
    const queue = new SessionOperationQueue()
    const blocker = deferred()
    const first = queue.enqueue(() => blocker.promise)
    let pendingSecret: ValueState<string> = presentValue('temporary-secret')
    const queued = queue.enqueue(async () => {}, {
      onExpire: () => {
        pendingSecret = EMPTY_VALUE
      },
    })

    queue.close(new Error('session expired'))

    await expect(queued).rejects.toThrow('session expired')
    expect(pendingSecret.kind).toBe('empty')
    await expect(queue.enqueue(async () => {})).rejects.toThrow(
      'session expired',
    )
    blocker.release()
    await first
  })
})
