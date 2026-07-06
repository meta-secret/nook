const DEFAULT_VAULT_IDLE_TIMEOUT_MS = 5 * 60_000
const DEFAULT_VAULT_IDLE_WARNING_MS = 30_000
const MIN_IDLE_TIMEOUT_MS = 1_000

/** User input events that reset the idle lock timer while the vault is unlocked. */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'touchstart',
  'scroll',
  'click',
] as const

export function resolveVaultIdleTimeoutMs(env: {
  DEV?: boolean
  VITE_E2E_EXPOSE_VAULT?: string
  VITE_VAULT_IDLE_TIMEOUT_MS?: string
}): number {
  const allowFastIdle = env.DEV === true || env.VITE_E2E_EXPOSE_VAULT === 'true'
  if (!allowFastIdle) {
    return DEFAULT_VAULT_IDLE_TIMEOUT_MS
  }
  const raw = env.VITE_VAULT_IDLE_TIMEOUT_MS
  const parsed = raw === undefined || raw === '' ? NaN : Number(raw)
  if (Number.isFinite(parsed) && parsed >= MIN_IDLE_TIMEOUT_MS) {
    return parsed
  }
  return DEFAULT_VAULT_IDLE_TIMEOUT_MS
}

/** Warning lead time before auto-lock; 0 disables the warning. */
export function resolveVaultIdleWarningMs(env: {
  DEV?: boolean
  VITE_E2E_EXPOSE_VAULT?: string
  VITE_VAULT_IDLE_WARNING_MS?: string
}): number {
  const allowFastIdle = env.DEV === true || env.VITE_E2E_EXPOSE_VAULT === 'true'
  if (!allowFastIdle) {
    return DEFAULT_VAULT_IDLE_WARNING_MS
  }
  const raw = env.VITE_VAULT_IDLE_WARNING_MS
  if (raw === '0') {
    return 0
  }
  const parsed = raw === undefined || raw === '' ? NaN : Number(raw)
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  return DEFAULT_VAULT_IDLE_WARNING_MS
}

export type VaultIdleSessionTracker = {
  start: () => void
  stop: () => void
  recordActivity: () => void
}

export function createVaultIdleSessionTracker(options: {
  timeoutMs: number
  warningMs: number
  onExpire: () => void
  onWarning?: () => void
}): VaultIdleSessionTracker {
  let expireTimer: ReturnType<typeof setTimeout> | undefined = undefined
  let warningTimer: ReturnType<typeof setTimeout> | undefined = undefined
  let warningShown = false
  let started = false

  const clearTimers = () => {
    if (expireTimer !== undefined) {
      clearTimeout(expireTimer)
      expireTimer = undefined
    }
    if (warningTimer !== undefined) {
      clearTimeout(warningTimer)
      warningTimer = undefined
    }
  }

  const scheduleTimers = () => {
    clearTimers()
    warningShown = false

    expireTimer = setTimeout(() => {
      expireTimer = undefined
      options.onExpire()
    }, options.timeoutMs)

    if (
      options.onWarning &&
      options.warningMs > 0 &&
      options.warningMs < options.timeoutMs
    ) {
      const warningDelay = options.timeoutMs - options.warningMs
      warningTimer = setTimeout(() => {
        warningTimer = undefined
        if (warningShown) return
        warningShown = true
        options.onWarning?.()
      }, warningDelay)
    }
  }

  const onActivity = () => {
    if (!started) return
    scheduleTimers()
  }

  const start = () => {
    if (started || typeof document === 'undefined') return
    started = true
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, onActivity, { passive: true })
    }
    scheduleTimers()
  }

  const stop = () => {
    if (!started) return
    started = false
    clearTimers()
    warningShown = false
    if (typeof document === 'undefined') return
    for (const event of ACTIVITY_EVENTS) {
      document.removeEventListener(event, onActivity)
    }
  }

  return {
    start,
    stop,
    recordActivity: onActivity,
  }
}
