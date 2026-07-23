import { describe, expect, test } from 'bun:test'
import { SessionOperationQueue } from '../src/lib/session-operation-queue'

function deferred() {
  let release: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release?.() }
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
    let password: string | undefined = 'temporary-password'
    const queued = queue.enqueue(
      async () => {
        throw new Error(`Unexpected password use: ${password}`)
      },
      {
        priority: 'interactive',
        expiresAt: Date.now() + 10,
        onExpire: () => {
          password = undefined
        },
      },
    )

    await expect(queued).rejects.toThrow(
      'Extension session request expired before execution.',
    )
    expect(password).toBeUndefined()
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
})
