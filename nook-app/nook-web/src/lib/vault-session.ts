const VAULT_SESSION_LOCKED_KEY = 'nook_vault_session_locked'

/** True after the user explicitly locked the vault until they unlock again. */
export function isVaultSessionLocked(): boolean {
  try {
    return sessionStorage.getItem(VAULT_SESSION_LOCKED_KEY) === '1'
  } catch {
    return false
  }
}

export function setVaultSessionLocked(locked: boolean): void {
  try {
    if (locked) {
      sessionStorage.setItem(VAULT_SESSION_LOCKED_KEY, '1')
    } else {
      sessionStorage.removeItem(VAULT_SESSION_LOCKED_KEY)
    }
  } catch {
    // sessionStorage unavailable (private mode, etc.)
  }
}
