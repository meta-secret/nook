import { VaultState } from '$lib/vault.svelte'
import { SvelteDate } from 'svelte/reactivity'
import {
  readLocalVaultBlob,
  resolveVaultSyncConflictKeepLocal,
  resolveVaultSyncConflictKeepRemote,
  writeLocalVaultBlob,
  writeRemoteVaultBlob,
  type PendingSyncConflict,
} from '$lib/vault-sync'

export function startVaultSync(state: VaultState) {
  state.stopVaultSync()
  const needsRemoteUpdates =
    state.isAuthenticated || state.joinEnrollmentPrompt !== 'none'
  if (!needsRemoteUpdates) {
    return
  }
  if (state.isAuthenticated) {
    void state.syncFromStorage()
  }
  state.syncTimer = setInterval(() => {
    if (
      state.isVerifying ||
      state.isSaving ||
      state.isSyncing ||
      state.isPasswordBusy
    ) {
      return
    }
    if (!state.isAuthenticated && state.joinEnrollmentPrompt === 'none') {
      return
    }
    // Local-only vaults with no sync provider and no pending join have
    // nothing remote to reconcile — skip the tick entirely rather than
    // re-reading local IndexedDB into itself every interval.
    if (
      state.isAuthenticated &&
      state.syncProviders.length === 0 &&
      state.joinEnrollmentPrompt === 'none'
    ) {
      return
    }
    void state.syncFromStorage()
  }, VaultState.syncIntervalMs())
}

export function stopVaultSync(state: VaultState) {
  if (state.syncTimer !== null) {
    clearInterval(state.syncTimer)
    state.syncTimer = null
  }
}

export async function syncFromStorage(
  state: VaultState,
  options?: { force?: boolean },
) {
  if (!state.manager) return
  if (state.syncBlocked) return
  if (!options?.force && state.isVerifying) return
  if (!options?.force && state.isSaving) return
  if (!options?.force && state.isPasswordBusy) return
  if (!options?.force && state.isSyncing) return

  if (!state.isAuthenticated && state.syncProviders.length > 0) {
    state.isSyncing = true
    try {
      const [mode, pat, repo] = state.providerWasmArgs(state.syncProviders[0]!)
      const raw = await state.enqueueStorage(() =>
        state.manager!.sync_vault_from_storage(mode, pat, repo),
      )
      state.applyVaultSyncResult(raw)
      state.refreshSecretsFromSession()
      state.lastSyncedAt = new SvelteDate()
    } catch {
      // Background sync should not interrupt the UI.
    } finally {
      state.isSyncing = false
    }
    return
  }

  if (!state.hasRemoteCredentials()) return

  if (
    state.isAuthenticated &&
    state.localVaultPresent &&
    state.syncProviders.length > 0
  ) {
    await state.syncFromSyncProviders({ quiet: true, force: options?.force })
    return
  }

  await state.ensureOAuthTokensFresh()

  state.isSyncing = true
  try {
    const raw = await state.enqueueStorage(() =>
      state.manager!.sync_vault_from_storage(...state.wasmStorageArgs()),
    )
    state.applyVaultSyncResult(raw)
    state.refreshSecretsFromSession()
    state.lastSyncedAt = new SvelteDate()
  } catch {
    // Background sync should not interrupt the UI.
  } finally {
    state.isSyncing = false
  }
}

export async function manualSync(state: VaultState) {
  if (!state.manager) return
  if (state.syncBlocked) return
  if (state.isSyncing) return
  state.isSyncing = true
  try {
    await state.initDeviceIdentity()
    if (state.syncProviders.length === 0) {
      if (state.hasRemoteCredentials()) {
        await state.syncFromStorage({ force: true })
      } else {
        state.pendingJoins = []
        state.vaultMembers = []
      }
      return
    }
    for (const provider of state.syncProviders) {
      await state.syncProviderById(provider.id)
    }
    if (state.isAuthenticated) {
      await state.hydrateMultiDeviceState()
    } else {
      state.pendingJoins = []
      state.vaultMembers = []
    }
  } catch {
    // Manual refresh should not interrupt the UI.
  } finally {
    state.isSyncing = false
  }
}

export async function fanOutSyncToProviders(
  state: VaultState,
  options?: { quiet?: boolean },
): Promise<void> {
  if (!state.manager || !state.isAuthenticated) return
  if (state.syncBlocked) return
  if (state.syncProviders.length === 0) return

  const run = state.fanOutSyncChain.then(() =>
    state.runFanOutSyncToProviders(options),
  )
  state.fanOutSyncChain = run.catch(() => undefined)
  return run
}

export async function refreshReplacementConflicts(
  state: VaultState,
): Promise<void> {
  if (!state.manager?.eventLogMode()) {
    state.replacementConflicts = []
    return
  }
  const conflicts = await state.manager.listProjectionConflicts()
  state.replacementConflicts = conflicts.map((conflict) => ({
    oldSecretId: conflict.oldSecretId,
    candidatesJson: conflict.candidatesJson,
  }))
}

export function stageSyncConflict(
  state: VaultState,
  conflict: PendingSyncConflict,
) {
  state.pendingSyncConflict = conflict
  state.errorMsg = ''
}

export async function resolveSyncConflictKeepLocal(
  state: VaultState,
): Promise<void> {
  const conflict = state.pendingSyncConflict
  if (!conflict || state.isVerifying) return

  state.isVerifying = true
  state.errorMsg = ''
  try {
    const remoteYaml = resolveVaultSyncConflictKeepLocal(
      conflict.localYaml,
      conflict.remoteYaml,
      conflict.remoteRevision,
    )
    const revision = await writeRemoteVaultBlob(
      conflict.mode,
      conflict.pat,
      conflict.repo,
      remoteYaml,
      conflict.remoteRevision,
    )
    const providerId = await state.ensureProviderSavedAfterConflict(conflict)
    await state.updateProviderSyncMetadata(
      providerId,
      conflict.localYaml,
      revision,
    )
    state.clearPendingSyncConflict()
    state.finishStagedProviderConnectAfterConflict(conflict)
    state.showSuccess(
      state.t('auth_storage.sync_conflict_resolved_local', {
        provider: conflict.providerLabel,
      }),
    )
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : state.t('auth_storage.sync_failed')
  } finally {
    state.isVerifying = false
  }
}

export async function resolveSyncConflictKeepRemote(
  state: VaultState,
): Promise<void> {
  const conflict = state.pendingSyncConflict
  if (!conflict || state.isVerifying) return

  state.isVerifying = true
  state.errorMsg = ''
  try {
    const localYaml = resolveVaultSyncConflictKeepRemote(
      conflict.localYaml,
      conflict.remoteYaml,
      conflict.remoteRevision,
    )
    await writeLocalVaultBlob(localYaml)
    if (state.isAuthenticated) {
      await state.reloadSessionFromLocal()
    }
    const providerId = await state.ensureProviderSavedAfterConflict(conflict)
    await state.updateProviderSyncMetadata(
      providerId,
      conflict.remoteYaml,
      conflict.remoteRevision,
    )
    state.clearPendingSyncConflict()
    state.finishStagedProviderConnectAfterConflict(conflict)
    state.showSuccess(
      state.t('auth_storage.sync_conflict_resolved_remote', {
        provider: conflict.providerLabel,
      }),
    )
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : state.t('auth_storage.sync_failed')
  } finally {
    state.isVerifying = false
  }
}

export async function confirmRecoverRemoteVault(
  state: VaultState,
): Promise<void> {
  if (!state.manager) return
  state.errorMsg = ''
  state.isVerifying = true
  try {
    state.manager.prepareConnectFromLocalCache()
    state.pendingConnectRecovery = 'from_cache'
    state.remoteVaultRecoveryPrompt = 'none'
    if (state.loginSetupType) {
      await state.loadDb()
      return
    }
    await state.refreshPasswordEntriesList()
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : 'Could not load the local vault copy.'
  } finally {
    state.isVerifying = false
  }
}

export async function confirmCreateFreshRemoteVault(
  state: VaultState,
): Promise<void> {
  if (!state.manager) return
  state.errorMsg = ''
  state.pendingConnectRecovery = 'fresh'
  state.remoteVaultRecoveryPrompt = 'none'
  if (state.loginSetupType) {
    state.isVerifying = true
    try {
      await state.loadDb()
    } catch (e: unknown) {
      state.errorMsg =
        e instanceof Error ? e.message : 'Could not create a new vault file.'
    } finally {
      state.isVerifying = false
    }
    return
  }
}

export function clearRemoteVaultRecovery(state: VaultState) {
  state.remoteVaultRecoveryPrompt = 'none'
  state.pendingConnectRecovery = 'none'
  try {
    state.manager?.clearConnectRecovery()
  } catch {
    // Engine not ready yet.
  }
}

export async function syncProviderById(
  state: VaultState,
  providerId: string,
  options?: { quiet?: boolean },
): Promise<void> {
  if (!state.manager) return
  if (state.syncBlocked) return
  const provider = state.providers.find((p) => p.id === providerId)
  if (!provider || provider.type === 'local') return
  if (state.syncingProviderId && state.syncingProviderId !== providerId) return

  state.syncingProviderId = providerId
  if (!options?.quiet) {
    state.errorMsg = ''
  }
  try {
    const [mode, pat, repo] = state.providerWasmArgs(provider)
    // `sync_vault_from_storage` checks the IDB event-log flag; the in-memory
    // `eventLogMode()` bit can be false after reload until connect finishes.
    const raw = await state.enqueueStorage(() =>
      state.raceStorageTimeout(
        state.manager!.sync_vault_from_storage(mode, pat, repo),
        'Vault sync',
      ),
    )
    state.applyVaultSyncResult(raw)
    state.refreshSecretsFromSession()
    await state.refreshReplacementConflicts()
    await state.updateProviderSyncMetadata(
      providerId,
      await readLocalVaultBlob(),
      null,
    )
    return
  } catch (e: unknown) {
    if (!options?.quiet) {
      state.errorMsg =
        e instanceof Error ? e.message : 'Sync failed for state provider.'
    }
  } finally {
    if (state.isAuthenticated) {
      await state.hydrateMultiDeviceState()
    }
    if (state.syncingProviderId === providerId) {
      state.syncingProviderId = null
    }
  }
}
