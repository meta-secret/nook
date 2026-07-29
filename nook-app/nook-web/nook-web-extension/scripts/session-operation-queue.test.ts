import { describe, expect, test } from 'bun:test'
import {
  SessionOperationPriority,
  SessionOperationQueue,
} from '../src/lib/session-operation-queue'

enum ReleaseGateKind {
  Waiting = 'waiting',
  Releasable = 'releasable',
}

type ReleaseGate =
  | { kind: ReleaseGateKind.Waiting }
  | { kind: ReleaseGateKind.Releasable; release: () => void }
enum PasswordResidencyKind {
  Resident = 'resident',
  Cleared = 'cleared',
}

type PasswordResidency =
  | { kind: PasswordResidencyKind.Resident; password: string }
  | { kind: PasswordResidencyKind.Cleared }
enum SecretResidencyKind {
  Resident = 'resident',
  Cleared = 'cleared',
}

type SecretResidency =
  | { kind: SecretResidencyKind.Resident; secret: string }
  | { kind: SecretResidencyKind.Cleared }

function deferred() {
  let gate: ReleaseGate = { kind: ReleaseGateKind.Waiting }
  const promise = new Promise<void>((resolve) => {
    gate = { kind: ReleaseGateKind.Releasable, release: resolve }
  })
  return {
    promise,
    release: () => {
      if (gate.kind === ReleaseGateKind.Releasable) gate.release()
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
      { priority: SessionOperationPriority.Interactive },
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
      kind: PasswordResidencyKind.Resident,
      password: 'temporary-password',
    }
    const queued = queue.enqueue(
      async () => {
        throw new Error(
          `Unexpected password use: ${
            passwordResidency.kind === PasswordResidencyKind.Resident
              ? passwordResidency.password
              : 'cleared'
          }`,
        )
      },
      {
        priority: SessionOperationPriority.Interactive,
        expiresAt: Date.now() + 10,
        onExpire: () => {
          passwordResidency = { kind: PasswordResidencyKind.Cleared }
        },
      },
    )

    await expect(queued).rejects.toThrow('EXTENSION_SESSION_REQUEST_EXPIRED')
    expect(passwordResidency.kind).toBe(PasswordResidencyKind.Cleared)
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
      kind: SecretResidencyKind.Resident,
      secret: 'temporary-secret',
    }
    const queued = queue.enqueue(async () => {}, {
      onExpire: () => {
        secretResidency = { kind: SecretResidencyKind.Cleared }
      },
    })

    queue.close(new Error('session expired'))

    await expect(queued).rejects.toThrow('session expired')
    expect(secretResidency.kind).toBe(SecretResidencyKind.Cleared)
    await expect(queue.enqueue(async () => {})).rejects.toThrow(
      'session expired',
    )
    blocker.release()
    await first
  })
})
