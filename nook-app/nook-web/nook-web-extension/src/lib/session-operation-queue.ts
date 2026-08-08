export enum SessionOperationPriority {
  Expiry = 'expiry',
  Interactive = 'interactive',
  Normal = 'normal',
  Probe = 'probe',
}

type QueueOptions = {
  priority?: SessionOperationPriority
  expiresAt?: number
  onExpire?: () => void
}

type QueueEntry<T> = {
  sequence: number
  priority: number
  operation: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
  expiresAt?: number
  onExpire?: () => void
  expiryTimer?: ReturnType<typeof setTimeout>
  settled: boolean
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
  { kind: QueueStateKind.Open } | { kind: QueueStateKind.Closed; error: Error }

export class SessionOperationQueue {
  private entries: QueueEntry<unknown>[] = []
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

  enqueue<T>(
    operation: () => Promise<T>,
    options: QueueOptions = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.state.kind === QueueStateKind.Closed) {
        options.onExpire?.()
        reject(this.state.error)
        return
      }
      const entry: QueueEntry<T> = {
        sequence: this.sequence++,
        priority:
          priorityOrder[options.priority ?? SessionOperationPriority.Normal],
        operation,
        resolve,
        reject,
        expiresAt: options.expiresAt,
        onExpire: options.onExpire,
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
      this.entries.push(entry as QueueEntry<unknown>)
      this.entries.sort(
        (left, right) =>
          left.priority - right.priority || left.sequence - right.sequence,
      )
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
              const result = await entry.operation()
              entry.settled = true
              entry.resolve(result)
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
