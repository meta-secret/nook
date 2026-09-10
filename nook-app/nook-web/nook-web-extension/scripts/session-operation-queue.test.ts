import { describe, expect, test } from 'bun:test'
import { err, ok } from 'neverthrow'
import {
  DEFAULT_SESSION_OPERATION_OPTIONS,
  SessionOperationCleanupKind,
  SessionOperationExpiryKind,
  SessionOperationPriority,
  SessionOperationQueue,
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../src/lib/session-operation-queue'

class SessionOperationGate {
  private resolve: () => void = () => {}
  readonly promise = new Promise<void>((resolve) => {
    this.resolve = resolve
  })
  release(): void {
    this.resolve()
  }
  async operation() {
    await this.promise
    return ok(undefined)
  }
}
class QueueFixture {
  readonly queue = new SessionOperationQueue()
  readonly gate = new SessionOperationGate()
  readonly first = this.queue.enqueue({
    operation: () => this.gate.operation(),
    options: DEFAULT_SESSION_OPERATION_OPTIONS,
  })
  password = 'queued-sensitive-password'
  released = 0
  dispatched = 0
  enqueue(expiresAt: number) {
    return this.queue.enqueue({
      operation: async () => {
        this.dispatched += 1
        return ok(undefined)
      },
      options: {
        priority: SessionOperationPriority.Interactive,
        expiry: { kind: SessionOperationExpiryKind.Deadline, expiresAt },
        cleanup: {
          kind: SessionOperationCleanupKind.OnExpire,
          run: () => {
            this.password = ''
            this.released += 1
          },
        },
      },
    })
  }
  async finish() {
    this.gate.release()
    await this.first
  }
}

describe('SessionOperationQueue results', () => {
  test('serializes work and prioritizes interactive operations', async () => {
    const fixture = new QueueFixture()
    const order: string[] = []
    const normal = fixture.queue.enqueue({
      operation: async () => {
        order.push('normal')
        return ok(undefined)
      },
      options: DEFAULT_SESSION_OPERATION_OPTIONS,
    })
    const interactive = fixture.queue.enqueue({
      operation: async () => {
        order.push('interactive')
        return ok(undefined)
      },
      options: {
        ...DEFAULT_SESSION_OPERATION_OPTIONS,
        priority: SessionOperationPriority.Interactive,
      },
    })
    await fixture.finish()
    expect((await normal).isOk()).toBe(true)
    expect((await interactive).isOk()).toBe(true)
    expect(order).toEqual(['interactive', 'normal'])
  })
  test('expires queued work and releases sensitive input exactly once', async () => {
    const fixture = new QueueFixture()
    expect(await fixture.enqueue(Date.now() + 10)).toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Expired)),
    )
    expect(fixture.released).toBe(1)
    expect(fixture.password).toBe('')
    expect(fixture.dispatched).toBe(0)
    await fixture.finish()
    expect(fixture.released).toBe(1)
  })
  test('continues after an explicit operation failure', async () => {
    const queue = new SessionOperationQueue()
    const failure = new SessionOperationFailure(
      SessionOperationFailureKind.Failed,
    )
    expect(
      await queue.enqueue({
        operation: async () => err(failure),
        options: DEFAULT_SESSION_OPERATION_OPTIONS,
      }),
    ).toEqual(err(failure))
    expect(
      await queue.enqueue({
        operation: async () => ok('next'),
        options: DEFAULT_SESSION_OPERATION_OPTIONS,
      }),
    ).toEqual(ok('next'))
  })
  test('closing clears queued input and rejects subsequent enqueue', async () => {
    const fixture = new QueueFixture()
    const queued = fixture.enqueue(Date.now() + 60000)
    const failure = new SessionOperationFailure(
      SessionOperationFailureKind.Closed,
    )
    fixture.queue.close(failure)
    expect(await queued).toEqual(err(failure))
    expect(await fixture.enqueue(Date.now() + 60000)).toEqual(err(failure))
    expect(fixture.released).toBe(2)
    expect(fixture.password).toBe('')
    expect(fixture.dispatched).toBe(0)
    await fixture.finish()
  })
  test('already elapsed deadlines never dispatch and release once', async () => {
    const fixture = new QueueFixture()
    expect(await fixture.enqueue(Date.now() - 1)).toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Expired)),
    )
    fixture.queue.close(
      new SessionOperationFailure(SessionOperationFailureKind.Closed),
    )
    expect(fixture.released).toBe(1)
    expect(fixture.password).toBe('')
    expect(fixture.dispatched).toBe(0)
    await fixture.finish()
  })
  test('running operation retains cleanup ownership when queue closes', async () => {
    const gate = new SessionOperationGate()
    const queue = new SessionOperationQueue()
    let released = 0
    const running = queue.enqueue({
      operation: () => gate.operation(),
      options: {
        ...DEFAULT_SESSION_OPERATION_OPTIONS,
        cleanup: {
          kind: SessionOperationCleanupKind.OnExpire,
          run: () => {
            released += 1
          },
        },
      },
    })
    queue.close(new SessionOperationFailure(SessionOperationFailureKind.Closed))
    expect(released).toBe(0)
    gate.release()
    expect((await running).isOk()).toBe(true)
  })
})
