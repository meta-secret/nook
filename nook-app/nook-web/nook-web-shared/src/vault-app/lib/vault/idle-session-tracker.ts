/** Browser activity lifetime for one unlocked vault interaction. */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "touchstart",
  "scroll",
  "click",
] as const;

export enum VaultIdleWarningKind {
  Disabled = "disabled",
  Enabled = "enabled",
}

export type VaultIdleWarning =
  | { readonly kind: VaultIdleWarningKind.Disabled }
  | {
      readonly kind: VaultIdleWarningKind.Enabled;
      readonly leadMs: number;
      readonly notify: () => void;
    };

export type VaultIdleSessionTrackerConfiguration = {
  readonly timeoutMs: number;
  readonly warning: VaultIdleWarning;
  readonly onExpire: () => void;
};

enum WarningTimerKind {
  NotScheduled = "not-scheduled",
  Scheduled = "scheduled",
}

type WarningTimer =
  | { kind: WarningTimerKind.NotScheduled }
  | { kind: WarningTimerKind.Scheduled; handle: ReturnType<typeof setTimeout> };

type ScheduledTimers = {
  expire: ReturnType<typeof setTimeout>;
  warning: WarningTimer;
};

enum SessionStateKind {
  Stopped = "stopped",
  Tracking = "tracking",
}

type SessionState =
  | { kind: SessionStateKind.Stopped }
  | { kind: SessionStateKind.Tracking; timers: ScheduledTimers };

export class VaultIdleSessionTracker {
  private state: SessionState = { kind: SessionStateKind.Stopped };

  constructor(
    private readonly configuration: VaultIdleSessionTrackerConfiguration,
  ) {}

  private clearTimers(timers: ScheduledTimers): void {
    clearTimeout(timers.expire);
    if (timers.warning.kind === WarningTimerKind.Scheduled) {
      clearTimeout(timers.warning.handle);
    }
  }

  private detachActivityListeners(): void {
    if (!("document" in globalThis)) return;
    for (const event of ACTIVITY_EVENTS) {
      document.removeEventListener(event, this.onActivity);
    }
  }

  private scheduleTimers(): void {
    if (this.state.kind === SessionStateKind.Tracking)
      this.clearTimers(this.state.timers);
    const expire = setTimeout(() => expire(), this.configuration.timeoutMs);
    let warning: WarningTimer = { kind: WarningTimerKind.NotScheduled };
    const policy = this.configuration.warning;
    if (
      policy.kind === VaultIdleWarningKind.Enabled &&
      policy.leadMs > 0 &&
      policy.leadMs < this.configuration.timeoutMs
    ) {
      warning = {
        kind: WarningTimerKind.Scheduled,
        handle: setTimeout(
          () => this.warn(policy.notify),
          this.configuration.timeoutMs - policy.leadMs,
        ),
      };
    }
    this.state = {
      kind: SessionStateKind.Tracking,
      timers: { expire, warning },
    };
  }

  private expire(): void {
    if (this.state.kind !== SessionStateKind.Tracking) return;
    this.clearTimers(this.state.timers);
    this.state = { kind: SessionStateKind.Stopped };
    this.detachActivityListeners();
    this.configuration.onExpire();
  }

  private warn(notify: () => void): void {
    if (this.state.kind !== SessionStateKind.Tracking) return;
    this.state = {
      kind: SessionStateKind.Tracking,
      timers: {
        ...this.state.timers,
        warning: { kind: WarningTimerKind.NotScheduled },
      },
    };
    notify();
  }

  // The DOM requires a stable callback identity for listener removal.
  private readonly onActivity = (): void => this.recordActivity();

  recordActivity(): void {
    if (this.state.kind === SessionStateKind.Tracking) this.scheduleTimers();
  }

  start(): void {
    if (
      this.state.kind === SessionStateKind.Tracking ||
      !("document" in globalThis)
    )
      return;
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, this.onActivity, { passive: true });
    }
    this.scheduleTimers();
  }

  stop(): void {
    if (this.state.kind === SessionStateKind.Tracking)
      this.clearTimers(this.state.timers);
    this.state = { kind: SessionStateKind.Stopped };
    this.detachActivityListeners();
  }
}
