import type { VaultState } from '$lib/vault.svelte'
import { setVaultSessionLocked } from '$lib/vault-session'

export function startIdleSessionTracking(state: VaultState) {
  if (!state.isAuthenticated) return
  state.ensureIdleSessionTracker()
  state.idleSessionTracker!.start()
}

export function stopIdleSessionTracking(state: VaultState) {
  state.idleSessionTracker?.stop()
}

export function lockVault(state: VaultState) {
  state.helpOpen = false
  state.stopIdleSessionTracking()
  setVaultSessionLocked(true)
  state.clearUnlockedSession()
}
