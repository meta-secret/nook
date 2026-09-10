enum VaultSyncIntervalPhase {
  Scheduled = 'scheduled',
  Stopped = 'stopped',
}

type VaultSyncInterval =
  | {
      readonly kind: VaultSyncIntervalPhase.Scheduled
      readonly timer: ReturnType<typeof setInterval>
    }
  | { readonly kind: VaultSyncIntervalPhase.Stopped }

type VaultSyncScheduleRequest = {
  readonly callback: () => void
  readonly intervalMs: number
}

/** Only a scheduled browser interval owns cancellation. Rust still admits every tick. */
export class ActiveVaultSyncSchedule {
  private interval: VaultSyncInterval

  constructor(request: VaultSyncScheduleRequest) {
    this.interval = {
      kind: VaultSyncIntervalPhase.Scheduled,
      timer: setInterval(() => {
        if (this.interval.kind === VaultSyncIntervalPhase.Scheduled)
          request.callback()
      }, request.intervalMs),
    }
  }

  stop(): void {
    const interval = this.interval
    this.interval = { kind: VaultSyncIntervalPhase.Stopped }
    if (interval.kind === VaultSyncIntervalPhase.Scheduled)
      clearInterval(interval.timer)
  }
}
