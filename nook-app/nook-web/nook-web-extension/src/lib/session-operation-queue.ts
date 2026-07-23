export type SessionOperationPriority =
  | 'expiry'
  | 'interactive'
  | 'normal'
  | 'probe'

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
  expiry: 0,
  interactive: 1,
  normal: 2,
  probe: 3,
}

const expiredError = () =>
  new Error('Extension session request expired before execution.')

export class SessionOperationQueue {
  private entries: QueueEntry<unknown>[] = []
  private sequence = 0
  private running = false

  enqueue<T>(
    operation: () => Promise<T>,
    options: QueueOptions = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = {
        sequence: this.sequence++,
        priority: priorityOrder[options.priority ?? 'normal'],
        operation,
        resolve,
        reject,
        expiresAt: options.expiresAt,
        onExpire: options.onExpire,
        settled: false,
      }
      if (entry.expiresAt !== undefined) {
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
          if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
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
