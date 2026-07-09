import type { VaultState } from '$lib/vault.svelte'
import type { NookSecretRecord } from '$lib/nook'
import { createLogger } from '$lib/log'

const log = createLogger('vault-nexus')

export type NexusUnlockStatus =
  | 'not_nexus'
  | 'unlocked'
  | 'awaiting_shares'
  | 'ceremony_required'

const CEREMONY_REQUIRED_MARKERS = [
  'opened-share ceremony',
  'NexusCeremonyRequired',
  'nexus vault unlock requires an opened-share ceremony',
]

const PASSWORD_FORBIDDEN_MARKERS = [
  'Password unlock is forbidden for nexus',
  'NexusPasswordUnlockForbidden',
]

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err ?? '')
}

export function isNexusCeremonyRequiredError(err: unknown): boolean {
  const message = errorMessage(err)
  return CEREMONY_REQUIRED_MARKERS.some((marker) =>
    message.toLowerCase().includes(marker.toLowerCase()),
  )
}

export function isNexusPasswordUnlockForbiddenError(err: unknown): boolean {
  const message = errorMessage(err)
  return PASSWORD_FORBIDDEN_MARKERS.some((marker) =>
    message.toLowerCase().includes(marker.toLowerCase()),
  )
}

export function isNexusVault(state: VaultState): boolean {
  if (state.vaultArchitecture.vault_type === 'nexus') return true
  if (!state.manager) return false
  try {
    return state.manager.nexusUnlockStatus() !== 'not_nexus'
  } catch {
    return false
  }
}

export async function getNexusUnlockStatus(
  state: VaultState,
): Promise<NexusUnlockStatus> {
  if (!state.manager) return 'not_nexus'
  try {
    const status = await state.enqueueStorage(() =>
      state.manager!.nexusUnlockStatus(),
    )
    switch (status) {
      case 'unlocked':
      case 'awaiting_shares':
      case 'ceremony_required':
      case 'not_nexus':
        return status
      default:
        return 'not_nexus'
    }
  } catch {
    return 'not_nexus'
  }
}

export async function refreshNexusUnlockStatus(
  state: VaultState,
): Promise<NexusUnlockStatus> {
  let status = await getNexusUnlockStatus(state)
  if (
    !state.isAuthenticated &&
    status === 'not_nexus' &&
    state.vaultArchitecture.vault_type === 'nexus'
  ) {
    await ensureNexusCeremonyHydrated(state)
    status = await getNexusUnlockStatus(state)
  }
  state.nexusUnlockStatus = status
  if (status === 'ceremony_required' || status === 'awaiting_shares') {
    state.nexusCeremonyPrompt = true
    state.loginPasswordPrompt = false
  } else if (status === 'unlocked') {
    state.nexusCeremonyPrompt = false
  } else if (
    status === 'not_nexus' &&
    state.vaultArchitecture.vault_type === 'nexus'
  ) {
    // Manager session was reset after lock; keep ceremony UI until hydrate.
    state.nexusCeremonyPrompt = true
    state.nexusUnlockStatus = 'ceremony_required'
    return 'ceremony_required'
  } else if (status === 'not_nexus') {
    state.nexusCeremonyPrompt = false
  }
  return state.nexusUnlockStatus
}

/**
 * Run a connect attempt so WASM can load encrypted share meta without keys.
 * Ceremony-required is the expected outcome after lock/reload.
 */
export async function ensureNexusCeremonyHydrated(
  state: VaultState,
): Promise<void> {
  if (!state.manager || state.isAuthenticated || state.isVerifying) return
  try {
    await state.initDeviceIdentity()
    // Pull remote events + materialize share meta without vault keys.
    await state.syncFromStorage({ force: true })
  } catch {
    // Sync may fail closed for nexus without keys; openLocalNexusShare retries.
  }
  const status = await getNexusUnlockStatus(state)
  if (status === 'ceremony_required' || status === 'awaiting_shares') {
    state.refreshVaultArchitectureFromManager()
    state.nexusCeremonyPrompt = true
    state.loginPasswordPrompt = false
    return
  }
  try {
    await state.enqueueStorage(async () => {
      const connectArgs = state.connectStorageArgs()
      await state.manager!.connect(...connectArgs)
    })
  } catch (e: unknown) {
    if (isNexusCeremonyRequiredError(e)) {
      state.refreshVaultArchitectureFromManager()
      state.nexusCeremonyPrompt = true
      state.loginPasswordPrompt = false
      return
    }
    // Ignore other connect failures here; openLocalNexusShare will surface them.
  }
}

export async function openLocalNexusShare(state: VaultState): Promise<string> {
  if (!state.manager) {
    throw new Error('Vault engine is not available.')
  }
  await ensureNexusCeremonyHydrated(state)
  // Opened shares contain share bytes — treat like a recovery code: do not log.
  const opened = await state.enqueueStorage(() =>
    state.manager!.openLocalNexusShare(),
  )
  state.nexusLocalShareContribution = opened
  return opened
}

export async function unlockWithNexusShares(
  state: VaultState,
  contributions: string[],
): Promise<void> {
  if (!state.manager) {
    state.errorMsg = 'Vault engine is not available.'
    return
  }
  if (state.isVerifying) return

  const opened = contributions
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (opened.length < 2) {
    state.errorMsg = state.t('architecture_modes.nexus_ceremony_need_peers')
    return
  }

  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true
  try {
    await state.initDeviceIdentity()
    const openedSharesJson = JSON.stringify(opened.map((raw) => JSON.parse(raw)))
    const connectArgs = state.connectStorageArgs()
    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.connectWithNexusShares(
        ...connectArgs,
        openedSharesJson,
      ),
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    state.markVaultUnlocked()
    state.nexusCeremonyPrompt = false
    state.nexusLocalShareContribution = ''
    state.nexusPeerShareContributions = ''
    state.nexusUnlockStatus = 'unlocked'
    log.info('vault unlocked with nexus shares', {
      mode: state.storageMode,
      secrets: rawRecords.length,
      contributions: opened.length,
    })
    await state.ensureProviderSaved()
    await state.loadProviders()
    await state.refreshPasswordEntriesList()
    void state.hydrateMultiDeviceState()
    state.joinEnrollmentPrompt = 'none'
    state.loginPasswordPrompt = false
    state.showSuccess(state.t('toasts.vault_unlocked'))
    state.startIdleSessionTracking()
    state.startVaultSync()
  } catch (e: unknown) {
    state.isAuthenticated = false
    if (isNexusCeremonyRequiredError(e)) {
      state.nexusCeremonyPrompt = true
      await refreshNexusUnlockStatus(state)
    }
    state.errorMsg =
      e instanceof Error
        ? state.resolveErrorMessage(e.message)
        : 'Failed to unlock with nexus shares.'
  } finally {
    state.isVerifying = false
  }
}

export async function surfaceNexusCeremonyIfNeeded(
  state: VaultState,
  err: unknown,
): Promise<boolean> {
  if (!isNexusCeremonyRequiredError(err) && !isNexusVault(state)) {
    return false
  }
  state.refreshVaultArchitectureFromManager()
  const status = await refreshNexusUnlockStatus(state)
  if (status === 'ceremony_required' || status === 'awaiting_shares') {
    state.nexusCeremonyPrompt = true
    state.loginPasswordPrompt = false
    state.errorMsg = ''
    return true
  }
  return isNexusCeremonyRequiredError(err)
}
