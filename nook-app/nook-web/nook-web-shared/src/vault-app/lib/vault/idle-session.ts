import type { VaultState } from '$lib/vault.svelte'
import { NookStringValue, setVaultSessionLocked } from '$app-wasm'
import { createLogger } from '$lib/log'
import { createVaultIdleSessionTracker } from '$lib/vault-idle-session'
import { intoWasmStringValue } from '$lib/wasm-string-value'

const log = createLogger('vault-session')

export function ensureIdleSessionTracker(state: VaultState): void {
  if (state.hasIdleSessionTracker()) return
  const idleTimeoutConfig = import.meta.env.VITE_VAULT_IDLE_TIMEOUT_MS
  const idleWarningConfig = import.meta.env.VITE_VAULT_IDLE_WARNING_MS
  state.setIdleSessionTracker(
    createVaultIdleSessionTracker({
      timeoutMs: state.runtimeConfig.resolveVaultIdleTimeoutMs(
        typeof idleTimeoutConfig === 'string'
          ? intoWasmStringValue(idleTimeoutConfig)
          : NookStringValue.unavailable(),
      ),
      warningMs: state.runtimeConfig.resolveVaultIdleWarningMs(
        typeof idleWarningConfig === 'string'
          ? intoWasmStringValue(idleWarningConfig)
          : NookStringValue.unavailable(),
      ),
      onExpire: () => lockVaultDueToIdle(state),
      onWarning: () => showIdleLockWarning(state),
    }),
  )
}

export function showIdleLockWarning(state: VaultState): void {
  if (!state.isAuthenticated) return
  state.showSuccess(state.t('session.idle_warning'))
}

export function lockVaultDueToIdle(state: VaultState): void {
  if (!state.isAuthenticated) return
  state.sessionExpiredByIdle = true
  state.lockVault()
}

export function startIdleSessionTracking(state: VaultState) {
  if (!state.isAuthenticated) return
  state.ensureIdleSessionTracker()
  state.startIdleSessionTracker()
  log.debug('idle session tracking started')
}

export function stopIdleSessionTracking(state: VaultState) {
  state.stopIdleSessionTracker()
}

export function lockVault(state: VaultState) {
  log.info('vault locked', {
    idle: state.sessionExpiredByIdle,
    secrets: state.secrets.length,
  })
  state.helpOpen = false
  state.stopIdleSessionTracking()
  setVaultSessionLocked(true)
  state.clearUnlockedSession()
  void state.lockDeviceProtection()
}
