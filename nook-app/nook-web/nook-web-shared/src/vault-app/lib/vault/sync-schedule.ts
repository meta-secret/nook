/** Only a scheduled browser interval owns cancellation. Rust still admits every tick. */
export class ActiveVaultSyncSchedule {
  private active = true;
  private readonly timer: ReturnType<typeof setInterval>;
  private constructor(request: { callback: () => void; intervalMs: number }) {
    this.timer = setInterval(() => {
      if (this.active) request.callback();
    }, request.intervalMs);
  }
  static start(request: {
    callback: () => void;
    intervalMs: number;
  }): ActiveVaultSyncSchedule {
    return new ActiveVaultSyncSchedule(request);
  }
  stop(): void {
    if (!this.active) return;
    this.active = false;
    clearInterval(this.timer);
  }
}
