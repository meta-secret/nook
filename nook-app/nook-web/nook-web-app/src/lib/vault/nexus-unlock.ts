import type { VaultState } from '$lib/vault.svelte'
import type { NookSecretRecord } from '$lib/nook'
import { createLogger } from '$lib/log'

const log = createLogger('vault-nexus')

export type NexusUnlockStatus =
  | 'not_nexus'
  | 'unlocked'
  | 'awaiting_shares'
  | 'ceremony_required'

export type NexusUnlockSessionStatus = {
  active: boolean
  collected: number
  threshold: number
  ready: boolean
}

export type NexusStoredDeliverySummary = {
  storeId: string
  sessionId: string
  policy: {
    participantCount: number
    threshold: number
  }
}

const INACTIVE_SESSION: NexusUnlockSessionStatus = {
  active: false,
  collected: 0,
  threshold: 0,
  ready: false,
}

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

function parseSessionStatus(raw: string): NexusUnlockSessionStatus {
  const status = JSON.parse(raw) as Partial<NexusUnlockSessionStatus>
  if (!status.active) return { ...INACTIVE_SESSION }
  return {
    active: true,
    collected: Number(status.collected ?? 0),
    threshold: Number(status.threshold ?? 0),
    ready: Boolean(status.ready),
  }
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
    state.nexusCeremonyPrompt = true
    state.nexusUnlockStatus = 'ceremony_required'
    return 'ceremony_required'
  } else if (status === 'not_nexus') {
    state.nexusCeremonyPrompt = false
  }
  return state.nexusUnlockStatus
}

/** Hydrate encrypted Nexus metadata without attempting to bypass quorum. */
export async function ensureNexusCeremonyHydrated(
  state: VaultState,
): Promise<void> {
  if (!state.manager || state.isAuthenticated || state.isVerifying) return
  await state.initDeviceIdentity()
  try {
    await state.syncFromStorage({ force: true })
  } catch {
    // A locked Nexus sync may fail closed until its local share is selected.
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
    }
  }
}

export async function startNexusUnlock(state: VaultState): Promise<void> {
  if (!state.manager || state.isVerifying) return
  state.errorMsg = ''
  await ensureNexusCeremonyHydrated(state)
  const rawStatus = await state.enqueueStorage(() =>
    state.manager!.startNexusUnlock(),
  )
  state.nexusUnlockSession = parseSessionStatus(rawStatus)
  state.nexusUnlockRequest = await state.enqueueStorage(() =>
    state.manager!.nexusUnlockRequestJson(),
  )
}

export async function addNexusUnlockResponse(
  state: VaultState,
  response: string,
): Promise<void> {
  if (!state.manager || !response.trim()) return
  const rawStatus = await state.enqueueStorage(() =>
    state.manager!.addNexusUnlockResponse(response.trim()),
  )
  state.nexusUnlockSession = parseSessionStatus(rawStatus)
}

export async function refreshNexusUnlockSession(
  state: VaultState,
): Promise<void> {
  if (!state.manager) return
  const rawStatus = await state.enqueueStorage(() =>
    state.manager!.nexusUnlockSessionStatusJson(),
  )
  state.nexusUnlockSession = parseSessionStatus(rawStatus)
  if (state.nexusUnlockSession.active && !state.nexusUnlockRequest) {
    state.nexusUnlockRequest = await state.enqueueStorage(() =>
      state.manager!.nexusUnlockRequestJson(),
    )
  }
}

export async function listNexusStoredDeliveries(
  state: VaultState,
): Promise<NexusStoredDeliverySummary[]> {
  if (!state.manager) return []
  await state.initDeviceIdentity()
  const raw = await state.enqueueStorage(() =>
    state.manager!.listNexusGenesisShareDeliveries(),
  )
  const summaries = JSON.parse(raw) as NexusStoredDeliverySummary[]
  state.nexusStoredDeliveries = summaries
  return summaries
}

export async function createNexusUnlockResponse(
  state: VaultState,
  storeId: string,
  request: string,
): Promise<string> {
  if (!state.manager) throw new Error('Vault engine is not available.')
  if (!storeId.trim() || !request.trim()) return ''
  await state.initDeviceIdentity()
  return state.enqueueStorage(async () => {
    await state.manager!.loadNexusGenesisShareDelivery(storeId.trim())
    state.refreshVaultArchitectureFromManager()
    return state.manager!.respondToNexusUnlockRequest(request.trim())
  })
}

export async function finalizeNexusUnlock(state: VaultState): Promise<void> {
  if (!state.manager || state.isVerifying || !state.nexusUnlockSession.ready) {
    return
  }
  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.finalizeNexusUnlock(),
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    state.nexusCeremonyPrompt = false
    state.nexusUnlockRequest = ''
    state.nexusUnlockSession = { ...INACTIVE_SESSION }
    state.nexusUnlockStatus = 'unlocked'
    await state.ensureProviderSaved()
    await state.loadProviders()
    await state.refreshPasswordEntriesList()
    void state.hydrateMultiDeviceState()
    state.markVaultUnlocked()
    log.info('vault unlocked with nexus quorum', {
      mode: state.storageMode,
      secrets: rawRecords.length,
    })
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
        : state.t('architecture_modes.nexus_unlock_failed')
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
