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

export function createVaultIdleSessionTracker(options: {
  timeoutMs: number;
  warningMs: number;
  onExpire: () => void;
  onWarning?: () => void;
}): VaultIdleSessionTracker {
  let expireTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let warningTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let warningShown = false;
  let started = false;

  const clearTimers = () => {
    if (expireTimer !== undefined) {
      clearTimeout(expireTimer);
      expireTimer = undefined;
    }
    if (warningTimer !== undefined) {
      clearTimeout(warningTimer);
      warningTimer = undefined;
    }
  };

  const scheduleTimers = () => {
    clearTimers();
    warningShown = false;

    expireTimer = setTimeout(() => {
      expireTimer = undefined;
      options.onExpire();
    }, options.timeoutMs);

    if (
      options.onWarning &&
      options.warningMs > 0 &&
      options.warningMs < options.timeoutMs
    ) {
      const warningDelay = options.timeoutMs - options.warningMs;
      warningTimer = setTimeout(() => {
        warningTimer = undefined;
        if (warningShown) return;
        warningShown = true;
        options.onWarning?.();
      }, warningDelay);
    }
  };

  const onActivity = () => {
    if (!started) return;
    scheduleTimers();
  };

  const start = () => {
    if (started || typeof document === "undefined") return;
    started = true;
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, onActivity, { passive: true });
    }
    scheduleTimers();
  };

  const stop = () => {
    if (!started) return;
    started = false;
    clearTimers();
    warningShown = false;
    if (typeof document === "undefined") return;
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
