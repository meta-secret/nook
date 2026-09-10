import { err, type Result } from 'neverthrow'
export enum SessionOperationPriority {
  Expiry = 'expiry',
  Interactive = 'interactive',
  Normal = 'normal',
  Probe = 'probe',
}

export enum SessionOperationExpiryKind {
  None = 'none',
  Deadline = 'deadline',
}

export type SessionOperationExpiry =
  | { kind: SessionOperationExpiryKind.None }
  | { kind: SessionOperationExpiryKind.Deadline; expiresAt: number }

export enum SessionOperationCleanupKind {
  None = 'none',
  OnExpire = 'on-expire',
}

export type SessionOperationCleanup =
  | { kind: SessionOperationCleanupKind.None }
  | { kind: SessionOperationCleanupKind.OnExpire; run: () => void }

export type SessionOperationOptions = {
  priority: SessionOperationPriority
  expiry: SessionOperationExpiry
  cleanup: SessionOperationCleanup
}

export const DEFAULT_SESSION_OPERATION_OPTIONS: SessionOperationOptions = {
  priority: SessionOperationPriority.Normal,
  expiry: { kind: SessionOperationExpiryKind.None },
  cleanup: { kind: SessionOperationCleanupKind.None },
}

export type EnqueueSessionOperationArgs<T> = {
  operation: () => Promise<Result<T, SessionOperationFailure>>
  options: SessionOperationOptions
}

const priorityOrder: Record<SessionOperationPriority, number> = {
  [SessionOperationPriority.Expiry]: 0,
  [SessionOperationPriority.Interactive]: 1,
  [SessionOperationPriority.Normal]: 2,
  [SessionOperationPriority.Probe]: 3,
}

export enum SessionOperationFailureKind {
  Expired = 'EXTENSION_SESSION_REQUEST_EXPIRED',
  Failed = 'EXTENSION_SESSION_OPERATION_FAILED',
  InvalidRequest = 'EXTENSION_SESSION_INVALID_REQUEST',
  Locked = 'EXTENSION_SESSION_LOCKED',
  Verification = 'EXTENSION_SESSION_VERIFICATION_FAILED',
  Consumed = 'EXTENSION_SESSION_CONSUMED',
  Closed = 'EXTENSION_SESSION_CLOSED',
}

export class SessionOperationFailure {
  constructor(readonly kind: SessionOperationFailureKind) {}
  get message(): string {
    return this.kind
  }
}

enum PendingTimerKind {
  Unscheduled = 'unscheduled',
  Scheduled = 'scheduled',
}

type PendingTimer =
  | { kind: PendingTimerKind.Unscheduled }
  | { kind: PendingTimerKind.Scheduled; handle: ReturnType<typeof setTimeout> }

enum OperationStateKind {
  Queued = 'queued',
  Running = 'running',
  Settled = 'settled',
}

type OperationState =
  | { kind: OperationStateKind.Queued; timer: PendingTimer }
  | { kind: OperationStateKind.Running }
  | { kind: OperationStateKind.Settled }

interface QueuedOperation {
  readonly sequence: number
  readonly priority: SessionOperationPriority
  scheduleExpiry(): void
  run(): Promise<void>
  cancel(error: SessionOperationFailure): void
}

type QueuedSessionOperationConfiguration<T> = {
  readonly sequence: number
  readonly request: EnqueueSessionOperationArgs<T>
  // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
  readonly resolve: (value: Result<T, SessionOperationFailure>) => void
  readonly remove: (entry: QueuedOperation) => void
}

/** Owns the deadline and cleanup only while the operation is waiting to run. */
class QueuedSessionOperation<T> implements QueuedOperation {
  private state: OperationState = {
    kind: OperationStateKind.Queued,
    timer: { kind: PendingTimerKind.Unscheduled },
  }

  constructor(
    private readonly configuration: QueuedSessionOperationConfiguration<T>,
  ) {}

  get sequence(): number {
    return this.configuration.sequence
  }
  get priority(): SessionOperationPriority {
    return this.configuration.request.options.priority
  }

  scheduleExpiry(): void {
    if (this.state.kind !== OperationStateKind.Queued) return
    const expiry = this.configuration.request.options.expiry
    if (expiry.kind === SessionOperationExpiryKind.None) return
    const remaining = expiry.expiresAt - Date.now()
    if (remaining <= 0) {
      this.cancel(
        new SessionOperationFailure(SessionOperationFailureKind.Expired),
      )
      return
    }
    this.state = {
      kind: OperationStateKind.Queued,
      timer: {
        kind: PendingTimerKind.Scheduled,
        handle: setTimeout(
          () =>
            this.cancel(
              new SessionOperationFailure(SessionOperationFailureKind.Expired),
            ),
          remaining,
        ),
      },
    }
  }

  private clearTimer(timer: PendingTimer): void {
    if (timer.kind === PendingTimerKind.Scheduled) clearTimeout(timer.handle)
  }

  cancel(error: SessionOperationFailure): void {
    if (this.state.kind !== OperationStateKind.Queued) return
    this.clearTimer(this.state.timer)
    this.state = { kind: OperationStateKind.Settled }
    this.configuration.remove(this)
    const cleanup = this.configuration.request.options.cleanup
    try {
      if (cleanup.kind === SessionOperationCleanupKind.OnExpire) cleanup.run()
    } finally {
      this.configuration.resolve(err(error))
    }
  }

  async run(): Promise<void> {
    if (this.state.kind !== OperationStateKind.Queued) return
    const expiry = this.configuration.request.options.expiry
    if (
      expiry.kind === SessionOperationExpiryKind.Deadline &&
      expiry.expiresAt <= Date.now()
    ) {
      this.cancel(
        new SessionOperationFailure(SessionOperationFailureKind.Expired),
      )
      return
    }
    this.clearTimer(this.state.timer)
    this.state = { kind: OperationStateKind.Running }
    const running = new RunningSessionOperation(this.configuration)
    await running.complete()
    this.state = { kind: OperationStateKind.Settled }
  }
}

/** Running work has no queued deadline or cancellation operation. */
class RunningSessionOperation<T> {
  private state = OperationStateKind.Running
  constructor(
    private readonly configuration: QueuedSessionOperationConfiguration<T>,
  ) {}
  async complete(): Promise<void> {
    if (this.state !== OperationStateKind.Running) return
    this.state = OperationStateKind.Settled
    this.configuration.resolve(await this.configuration.request.operation())
  }
}

/** Closed queues expose their terminal reason, never enqueue or drain. */
export class ClosedSessionOperationQueue {
  constructor(readonly error: SessionOperationFailure) {}
}

enum QueueStateKind {
  Open = 'open',
  Closed = 'closed',
}

type QueueState =
  | { kind: QueueStateKind.Open }
  | { kind: QueueStateKind.Closed; error: SessionOperationFailure }

enum QueueDrainKind {
  Idle = 'idle',
  Running = 'running',
}

export class SessionOperationQueue {
  private entries: QueuedOperation[] = []
  private sequence = 0
  private drainState = QueueDrainKind.Idle
  private state: QueueState = { kind: QueueStateKind.Open }

  close(error: SessionOperationFailure): ClosedSessionOperationQueue {
    if (this.state.kind === QueueStateKind.Closed)
      return new ClosedSessionOperationQueue(this.state.error)
    this.state = { kind: QueueStateKind.Closed, error }
    const pending = this.entries
    this.entries = []
    for (const entry of pending) entry.cancel(error)
    return new ClosedSessionOperationQueue(error)
  }

  enqueue<T>(
    request: EnqueueSessionOperationArgs<T>,
  ): Promise<Result<T, SessionOperationFailure>> {
    return new Promise<Result<T, SessionOperationFailure>>((resolve) => {
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      const entry = new QueuedSessionOperation({
        sequence: this.sequence++,
        request,
        resolve,
        remove: (expired) => this.remove(expired),
      })
      if (this.state.kind === QueueStateKind.Closed) {
        entry.cancel(this.state.error)
        return
      }
      this.entries.push(entry)
      entry.scheduleExpiry()
      this.entries.sort(
        // eslint-disable-next-line max-params -- Array.sort owns the comparator signature.
        (left, right) =>
          priorityOrder[left.priority] - priorityOrder[right.priority] ||
          left.sequence - right.sequence,
      )
      void this.drain()
    })
  }

  private remove(entry: QueuedOperation): void {
    this.entries = this.entries.filter((candidate) => candidate !== entry)
  }

  private async drain(): Promise<void> {
    if (this.drainState === QueueDrainKind.Running) return
    this.drainState = QueueDrainKind.Running
    try {
      for (
        let entry = this.entries.shift();
        entry;
        entry = this.entries.shift()
      ) {
        await entry.run()
      }
    } finally {
      this.drainState = QueueDrainKind.Idle
      if (this.entries.length > 0) void this.drain()
    }
  }
}
