import { describe, expect, test } from 'bun:test'
import { SessionOperationQueue } from '../src/lib/session-operation-queue'

type ReleaseGate =
  | { kind: 'waiting' }
  | { kind: 'releasable'; release: () => void }
type PasswordResidency =
  | { kind: 'resident'; password: string }
  | { kind: 'cleared' }
type SecretResidency =
  | { kind: 'resident'; secret: string }
  | { kind: 'cleared' }

function deferred() {
  let gate: ReleaseGate = { kind: 'waiting' }
  const promise = new Promise<void>((resolve) => {
    gate = { kind: 'releasable', release: resolve }
  })
  return {
    promise,
    release: () => {
      if (gate.kind === 'releasable') gate.release()
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
    let passwordResidency: PasswordResidency = {
      kind: 'resident',
      password: 'temporary-password',
    }
    const queued = queue.enqueue(
      async () => {
        throw new Error(
          `Unexpected password use: ${
            passwordResidency.kind === 'resident'
              ? passwordResidency.password
              : 'cleared'
          }`,
        )
      },
      {
        priority: 'interactive',
        expiresAt: Date.now() + 10,
        onExpire: () => {
          passwordResidency = { kind: 'cleared' }
        },
      },
    )

    await expect(queued).rejects.toThrow('EXTENSION_SESSION_REQUEST_EXPIRED')
    expect(passwordResidency.kind).toBe('cleared')
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
    let secretResidency: SecretResidency = {
      kind: 'resident',
      secret: 'temporary-secret',
    }
    const queued = queue.enqueue(async () => {}, {
      onExpire: () => {
        secretResidency = { kind: 'cleared' }
      },
    })

    queue.close(new Error('session expired'))

    await expect(queued).rejects.toThrow('session expired')
    expect(secretResidency.kind).toBe('cleared')
    await expect(queue.enqueue(async () => {})).rejects.toThrow(
      'session expired',
    )
    blocker.release()
    await first
  })
})
