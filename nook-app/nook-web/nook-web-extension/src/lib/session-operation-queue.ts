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

type QueueEntry = {
  sequence: number
  priority: number
  operation: () => Promise<void>
  reject: (reason: Error) => void
  expiresAt?: number
  onExpire?: () => void
  expiryTimer?: ReturnType<typeof setTimeout>
  settled: boolean
}

export type EnqueueSessionOperationArgs<T> = {
  operation: () => Promise<T>
  options: SessionOperationOptions
}

const priorityOrder: Record<SessionOperationPriority, number> = {
  [SessionOperationPriority.Expiry]: 0,
  [SessionOperationPriority.Interactive]: 1,
  [SessionOperationPriority.Normal]: 2,
  [SessionOperationPriority.Probe]: 3,
}

const expiredError = () => new Error('EXTENSION_SESSION_REQUEST_EXPIRED')

enum QueueStateKind {
  Open = 'open',
  Closed = 'closed',
}

type QueueState =
  | { kind: QueueStateKind.Open }
  | { kind: QueueStateKind.Closed; error: Error }

export class SessionOperationQueue {
  private entries: QueueEntry[] = []
  private sequence = 0
  private running = false
  private state: QueueState = { kind: QueueStateKind.Open }

  close(error = new Error('Extension session queue closed.')): void {
    if (this.state.kind === QueueStateKind.Closed) return
    this.state = { kind: QueueStateKind.Closed, error }
    const pending = this.entries
    this.entries = []
    for (const entry of pending) {
      if (entry.settled) continue
      entry.settled = true
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer)
      entry.onExpire?.()
      entry.reject(error)
    }
  }

  enqueue<T>(args: EnqueueSessionOperationArgs<T>): Promise<T> {
    const { operation, options } = args
    // Promise owns this callback's resolve and reject signature.
    // eslint-disable-next-line max-params
    return new Promise<T>((resolve, reject) => {
      if (this.state.kind === QueueStateKind.Closed) {
        if (options.cleanup.kind === SessionOperationCleanupKind.OnExpire) {
          options.cleanup.run()
        }
        reject(this.state.error)
        return
      }
      const expiryFields =
        options.expiry.kind === SessionOperationExpiryKind.Deadline
          ? { expiresAt: options.expiry.expiresAt }
          : {}
      const cleanupFields =
        options.cleanup.kind === SessionOperationCleanupKind.OnExpire
          ? { onExpire: options.cleanup.run }
          : {}
      const entry: QueueEntry = {
        sequence: this.sequence++,
        priority: priorityOrder[options.priority],
        operation: async () => {
          const result = await operation()
          resolve(result)
        },
        reject,
        ...expiryFields,
        ...cleanupFields,
        settled: false,
      }
      if (typeof entry.expiresAt === 'number') {
        const remaining = entry.expiresAt - Date.now()
        if (remaining <= 0) {
          entry.settled = true
          entry.onExpire?.()
          reject(expiredError())
          return
        }
        entry.expiryTimer = setTimeout(() => {
          if (entry.settled) return
          entry.settled = true
          this.entries = this.entries.filter((candidate) => candidate !== entry)
          entry.onExpire?.()
          reject(expiredError())
        }, remaining)
      }
      this.entries.push(entry)
      // Array.sort owns this comparator signature.
      // eslint-disable-next-line max-params
      const compareEntries = (left: QueueEntry, right: QueueEntry) =>
        left.priority - right.priority || left.sequence - right.sequence
      this.entries.sort(compareEntries)
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      let entry = this.entries.shift()
      while (entry) {
        if (!entry.settled) {
          if (
            typeof entry.expiresAt === 'number' &&
            entry.expiresAt <= Date.now()
          ) {
            entry.settled = true
            if (entry.expiryTimer) clearTimeout(entry.expiryTimer)
            entry.onExpire?.()
            entry.reject(expiredError())
          } else {
            if (entry.expiryTimer) clearTimeout(entry.expiryTimer)
            try {
              await entry.operation()
              entry.settled = true
            } catch (error) {
              entry.settled = true
              entry.reject(
                error instanceof Error
                  ? error
                  : new Error('Extension session operation failed.'),
              )
            }
          }
        }
        entry = this.entries.shift()
      }
    } finally {
      this.running = false
      if (this.entries.length > 0) void this.drain()
    }
  }
}
