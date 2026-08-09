/** User input events that reset the idle lock timer while the vault is unlocked. */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "touchstart",
  "scroll",
  "click",
] as const;

export type VaultIdleSessionTracker = {
  start: () => void;
  stop: () => void;
  recordActivity: () => void;
};

enum ScheduledTimersKind {
  NotScheduled = "not-scheduled",
  Scheduled = "scheduled",
}

type ScheduledTimers = {
  expire: ReturnType<typeof setTimeout>;
  warning:
    | { kind: ScheduledTimersKind.NotScheduled }
    | {
        kind: ScheduledTimersKind.Scheduled;
        handle: ReturnType<typeof setTimeout>;
      };
};

enum SessionStateKind {
  Stopped = "stopped",
  Tracking = "tracking",
}

type SessionState =
  | { kind: SessionStateKind.Stopped }
  | { kind: SessionStateKind.Tracking; timers: ScheduledTimers };

export function createVaultIdleSessionTracker(options: {
  timeoutMs: number;
  warningMs: number;
  onExpire: () => void;
  onWarning?: () => void;
}): VaultIdleSessionTracker {
  let state: SessionState = { kind: SessionStateKind.Stopped };

  const clearTimers = (timers: ScheduledTimers) => {
    clearTimeout(timers.expire);
    if (timers.warning.kind === ScheduledTimersKind.Scheduled) {
      clearTimeout(timers.warning.handle);
    }
  };

  const detachActivityListeners = () => {
    if (!("document" in globalThis)) return;
    for (const event of ACTIVITY_EVENTS) {
      document.removeEventListener(event, onActivity);
    }
  };

  const scheduleTimers = () => {
    if (state.kind === SessionStateKind.Tracking) {
      clearTimers(state.timers);
    }

    const expire = setTimeout(() => {
      if (state.kind !== SessionStateKind.Tracking) return;
      clearTimers(state.timers);
      state = { kind: SessionStateKind.Stopped };
      detachActivityListeners();
      options.onExpire();
    }, options.timeoutMs);

    let warning: ScheduledTimers["warning"] = {
      kind: ScheduledTimersKind.NotScheduled,
    };
    if (
      options.onWarning &&
      options.warningMs > 0 &&
      options.warningMs < options.timeoutMs
    ) {
      const warningDelay = options.timeoutMs - options.warningMs;
      warning = {
        kind: ScheduledTimersKind.Scheduled,
        handle: setTimeout(() => {
          if (state.kind !== SessionStateKind.Tracking) return;
          state = {
            kind: SessionStateKind.Tracking,
            timers: {
              ...state.timers,
              warning: { kind: ScheduledTimersKind.NotScheduled },
            },
          };
          options.onWarning?.();
        }, warningDelay),
      };
    }
    state = { kind: SessionStateKind.Tracking, timers: { expire, warning } };
  };

  const onActivity = () => {
    if (state.kind !== SessionStateKind.Tracking) return;
    scheduleTimers();
  };

  const start = () => {
    if (state.kind === SessionStateKind.Tracking || !("document" in globalThis))
      return;
    for (const event of ACTIVITY_EVENTS) {
      const addEventListenerArgs: Parameters<
        typeof document.addEventListener
      >[2] = { passive: true };
      document.addEventListener(event, onActivity, addEventListenerArgs);
    }
    scheduleTimers();
  };

  const stop = () => {
    if (state.kind === SessionStateKind.Tracking) {
      clearTimers(state.timers);
    }
    state = { kind: SessionStateKind.Stopped };
    detachActivityListeners();
  };

  return {
    start,
    stop,
    recordActivity: onActivity,
  };
}
