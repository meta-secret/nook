import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SESSION_OPERATION_OPTIONS,
  SessionOperationCleanupKind,
  SessionOperationExpiryKind,
  SessionOperationPriority,
  SessionOperationQueue,
  SessionOperationFailureKind,
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

class SessionOperationGate {
  private gate: ReleaseGate = { kind: ReleaseGateKind.Waiting }
  readonly promise = new Promise<void>((resolve) => {
    this.gate = { kind: ReleaseGateKind.Releasable, release: resolve }
  })

  release(): void {
    if (this.gate.kind === ReleaseGateKind.Releasable) this.gate.release()
  }
}

describe('SessionOperationQueue', () => {
  test('serializes work and prioritizes interactive operations', async () => {
    const queue = new SessionOperationQueue()
    const blocker = new SessionOperationGate()
    const order: string[] = []
    const first = queue.enqueue({
      operation: async () => {
        order.push('first')
        await blocker.promise
      },
      options: DEFAULT_SESSION_OPERATION_OPTIONS,
    })
    const normal = queue.enqueue({
      operation: async () => {
        order.push('normal')
      },
      options: DEFAULT_SESSION_OPERATION_OPTIONS,
    })
    const interactive = queue.enqueue({
      operation: async () => {
        order.push('interactive')
      },
      options: {
        priority: SessionOperationPriority.Interactive,
        expiry: { kind: SessionOperationExpiryKind.None },
        cleanup: { kind: SessionOperationCleanupKind.None },
      },
    })

    blocker.release()
    await Promise.all([first, normal, interactive])

    expect(order).toEqual(['first', 'interactive', 'normal'])
  })

  test('expires queued work and clears its sensitive input', async () => {
    const queue = new SessionOperationQueue()
    const blocker = new SessionOperationGate()
    const first = queue.enqueue({
      operation: () => blocker.promise,
      options: DEFAULT_SESSION_OPERATION_OPTIONS,
    })
    let passwordResidency: PasswordResidency = {
      kind: PasswordResidencyKind.Resident,
      password: 'temporary-password',
    }
    const queued = queue.enqueue({
      operation: async () => {
        throw new Error(
          `Unexpected password use: ${
            passwordResidency.kind === PasswordResidencyKind.Resident
              ? passwordResidency.password
              : 'cleared'
          }`,
        )
      },
      options: {
        priority: SessionOperationPriority.Interactive,
        expiry: {
          kind: SessionOperationExpiryKind.Deadline,
          expiresAt: Date.now() + 10,
        },
        cleanup: {
          kind: SessionOperationCleanupKind.OnExpire,
          run: () => {
            passwordResidency = { kind: PasswordResidencyKind.Cleared }
          },
        },
      },
    })

    await expect(queued).rejects.toThrow('EXTENSION_SESSION_REQUEST_EXPIRED')
    expect(passwordResidency.kind).toBe(PasswordResidencyKind.Cleared)
    blocker.release()
    await first
  })

  test('continues after an operation fails', async () => {
    const queue = new SessionOperationQueue()
    const failed = queue.enqueue({
      operation: async () => {
        throw new Error('expected failure')
      },
      options: DEFAULT_SESSION_OPERATION_OPTIONS,
    })
    await expect(failed).rejects.toThrow('expected failure')
    expect(
      await queue.enqueue({
        operation: async () => 'ok',
        options: DEFAULT_SESSION_OPERATION_OPTIONS,
      }),
    ).toBe('ok')
  })

  test('closes terminally and clears queued sensitive input', async () => {
    const queue = new SessionOperationQueue()
    const blocker = new SessionOperationGate()
    const first = queue.enqueue({
      operation: () => blocker.promise,
      options: DEFAULT_SESSION_OPERATION_OPTIONS,
    })
    let secretResidency: SecretResidency = {
      kind: SecretResidencyKind.Resident,
      secret: 'temporary-secret',
    }
    const queued = queue.enqueue({
      operation: async () => {},
      options: {
        priority: SessionOperationPriority.Normal,
        expiry: { kind: SessionOperationExpiryKind.None },
        cleanup: {
          kind: SessionOperationCleanupKind.OnExpire,
          run: () => {
            secretResidency = { kind: SecretResidencyKind.Cleared }
          },
        },
      },
    })

    queue.close(new Error('session expired'))

    await expect(queued).rejects.toThrow('session expired')
    expect(secretResidency.kind).toBe(SecretResidencyKind.Cleared)
    await expect(
      queue.enqueue({
        operation: async () => {},
        options: DEFAULT_SESSION_OPERATION_OPTIONS,
      }),
    ).rejects.toThrow('session expired')
    blocker.release()
    await first
  })
  test('rejects an already expired request before dispatch and releases its input once', async () => {
    const queue = new SessionOperationQueue()
    let dispatched = 0
    let released = 0
    const request = queue.enqueue({
      operation: async () => {
        dispatched += 1
      },
      options: {
        priority: SessionOperationPriority.Normal,
        expiry: {
          kind: SessionOperationExpiryKind.Deadline,
          expiresAt: Date.now() - 1,
        },
        cleanup: {
          kind: SessionOperationCleanupKind.OnExpire,
          run: () => {
            released += 1
          },
        },
      },
    })
    await expect(request).rejects.toMatchObject({
      kind: SessionOperationFailureKind.Expired,
    })
    queue.close(new Error('closed'))
    expect(dispatched).toBe(0)
    expect(released).toBe(1)
  })

  test('closing the queue leaves cleanup of running work with that operation', async () => {
    const queue = new SessionOperationQueue()
    const gate = new SessionOperationGate()
    let released = 0
    const running = queue.enqueue({
      operation: () => gate.promise,
      options: {
        priority: SessionOperationPriority.Normal,
        expiry: { kind: SessionOperationExpiryKind.None },
        cleanup: {
          kind: SessionOperationCleanupKind.OnExpire,
          run: () => {
            released += 1
          },
        },
      },
    })
    queue.close(new Error('closed'))
    expect(released).toBe(0)
    gate.release()
    await running
  })
})
