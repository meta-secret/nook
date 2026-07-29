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

type ScheduledTimers = {
  expire: ReturnType<typeof setTimeout>;
  warning:
    | { kind: "not-scheduled" }
    | {
        kind: "scheduled";
        handle: ReturnType<typeof setTimeout>;
      };
};

type SessionState =
  | { kind: "stopped" }
  | { kind: "tracking"; timers: ScheduledTimers };

export function createVaultIdleSessionTracker(options: {
  timeoutMs: number;
  warningMs: number;
  onExpire: () => void;
  onWarning?: () => void;
}): VaultIdleSessionTracker {
  let state: SessionState = { kind: "stopped" };

  const clearTimers = (timers: ScheduledTimers) => {
    clearTimeout(timers.expire);
    if (timers.warning.kind === "scheduled") {
      clearTimeout(timers.warning.handle);
    }
  };

  const scheduleTimers = () => {
    if (state.kind === "tracking") {
      clearTimers(state.timers);
    }

    const expire = setTimeout(() => {
      state = { kind: "stopped" };
      options.onExpire();
    }, options.timeoutMs);

    let warning: ScheduledTimers["warning"] = { kind: "not-scheduled" };
    if (
      options.onWarning &&
      options.warningMs > 0 &&
      options.warningMs < options.timeoutMs
    ) {
      const warningDelay = options.timeoutMs - options.warningMs;
      warning = {
        kind: "scheduled",
        handle: setTimeout(() => {
          if (state.kind !== "tracking") return;
          state = {
            kind: "tracking",
            timers: {
              ...state.timers,
              warning: { kind: "not-scheduled" },
            },
          };
          options.onWarning?.();
        }, warningDelay),
      };
    }
    state = { kind: "tracking", timers: { expire, warning } };
  };

  const onActivity = () => {
    if (state.kind !== "tracking") return;
    scheduleTimers();
  };

  const start = () => {
    if (state.kind === "tracking" || !("document" in globalThis)) return;
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, onActivity, { passive: true });
    }
    scheduleTimers();
  };

  const stop = () => {
    if (state.kind === "stopped") return;
    clearTimers(state.timers);
    state = { kind: "stopped" };
    if (!("document" in globalThis)) return;
    for (const event of ACTIVITY_EVENTS) {
      document.removeEventListener(event, onActivity);
    }
  };

  return {
    start,
    stop,
    recordActivity: onActivity,
  };
}
