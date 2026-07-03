import type { VaultState } from '$lib/vault.svelte'
import { setVaultSessionLocked } from '$lib/vault-session'
import { createLogger } from '$lib/log'

const log = createLogger('vault-session')

export function startIdleSessionTracking(state: VaultState) {
  if (!state.isAuthenticated) return
  state.ensureIdleSessionTracker()
  state.idleSessionTracker!.start()
  log.debug('idle session tracking started')
}

export function stopIdleSessionTracking(state: VaultState) {
  state.idleSessionTracker?.stop()
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
}
