import { VaultState } from '$lib/vault.svelte'
import { SvelteDate } from 'svelte/reactivity'
import { createLogger } from '$lib/log'
import {
  fetchRemoteVaultBlob,
  readLocalVaultBlob,
  resolveVaultSyncConflictKeepLocal,
  resolveVaultSyncConflictKeepRemote,
  writeLocalVaultBlob,
  writeRemoteVaultBlob,
  type PendingSyncConflict,
} from '$lib/vault-sync'
import { importVaultAsNewLocalCopy } from '$lib/local-vault'
import * as localLoginActions from '$lib/vault/local-login'

const log = createLogger('vault-sync')

function syncError(context: string, error: unknown) {
  log.warn(`${context} failed`, {
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  })
}

export function startVaultSync(state: VaultState) {
  state.stopVaultSync()
  const needsRemoteUpdates =
    state.isAuthenticated ||
    state.joinEnrollmentPrompt !== 'none' ||
    state.awaitingJoinApproval
  if (!needsRemoteUpdates) {
    log.debug('vault sync timer skipped (no remote updates needed)')
    return
  }
  log.info('vault sync timer started', {
    authenticated: state.isAuthenticated,
    providers: state.syncProviders.length,
    intervalMs: VaultState.syncIntervalMs(),
  })
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
    if (
      !state.isAuthenticated &&
      state.joinEnrollmentPrompt === 'none' &&
      !state.awaitingJoinApproval
    ) {
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
    log.debug('vault sync timer stopped')
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
      await state.refreshSecretsFromSession()
      state.lastSyncedAt = new SvelteDate()
    } catch (error) {
      syncError('background sync (unauthenticated)', error)
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
    await state.refreshSecretsFromSession()
    state.lastSyncedAt = new SvelteDate()
  } catch (error) {
    syncError('background sync', error)
  } finally {
    state.isSyncing = false
  }
}

export async function manualSync(state: VaultState) {
  if (!state.manager) return
  if (state.syncBlocked) return
  if (state.isSyncing) return
  log.info('manual sync started', { providers: state.syncProviders.length })
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
  } catch (error) {
    syncError('manual sync', error)
  } finally {
    state.isSyncing = false
    log.debug('manual sync finished')
  }
}

export async function fanOutSyncToProviders(
  state: VaultState,
  options?: { quiet?: boolean },
): Promise<void> {
  if (!state.manager || !state.isAuthenticated) return
  if (state.syncBlocked) return
  if (state.syncProviders.length === 0) return

  log.debug('fan-out sync queued', { providers: state.syncProviders.length })
  const run = state.fanOutSyncChain.then(() =>
    state.runFanOutSyncToProviders(options),
  )
  state.fanOutSyncChain = run.catch(() => undefined)
  return run
}

export async function refreshReplacementConflicts(
  state: VaultState,
): Promise<void> {
  if (!state.manager) {
    state.replacementConflicts = []
    return
  }
  // These borrow the wasm manager (`&mut self`); route them through the storage
  // chain so they never alias an in-flight foreground op (e.g. a delete), which
  // would trigger a wasm-bindgen recursive-borrow hang/panic.
  const conflicts = await state.enqueueStorage(() => {
    if (!state.manager!.eventLogMode()) {
      return [] as Awaited<
        ReturnType<typeof state.manager.listProjectionConflicts>
      >
    }
    return state.manager!.listProjectionConflicts()
  })
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
  log.warn('sync conflict staged', {
    provider: conflict.providerLabel,
    kind: conflict.kind,
  })
}

/** Finish connect/sync that was paused when the conflict dialog opened. */
async function resumeConnectAfterSyncConflict(
  state: VaultState,
  providerId: string,
): Promise<void> {
  if (state.isAuthenticated) {
    if (providerId !== '__pending_provider__') {
      await state.syncProviderById(providerId, { quiet: true })
    }
    await state.hydrateMultiDeviceState()
    return
  }
  if (!state.manager) return
  if (!state.stagedRemoteStorageArgs() && state.syncProviders.length === 0) {
    return
  }
  await state.loadDb()
}

export async function resolveSyncConflictImportRemote(
  state: VaultState,
): Promise<void> {
  const conflict = state.pendingSyncConflict
  if (
    !conflict ||
    conflict.kind !== 'store_id' ||
    !conflict.remoteStoreId ||
    state.isVerifying
  ) {
    return
  }

  state.isVerifying = true
  state.errorMsg = ''
  let providerId: string | null
  try {
    const importedStoreId = await importVaultAsNewLocalCopy(
      conflict.remoteYaml,
      conflict.providerLabel,
    )
    state.activeVaultStoreId = importedStoreId
    state.selectedLoginVaultStoreId = importedStoreId
    if (state.manager) {
      await state.enqueueStorage(() => state.manager!.resetVaultSession())
    }
    state.localVaultPresent = true
    await localLoginActions.refreshLocalVaultCatalog(state)
    providerId = await state.ensureProviderSavedAfterConflict(conflict)
    await state.updateProviderSyncMetadata(
      providerId,
      conflict.remoteYaml,
      conflict.remoteRevision,
    )
    state.clearPendingSyncConflict()
    state.finishStagedProviderConnectAfterConflict(conflict)
    await state.syncActiveVaultStoreIdToAuth()
    state.showSuccess(
      state.t('auth_storage.sync_conflict_imported_vault', {
        provider: conflict.providerLabel,
      }),
    )
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : state.t('auth_storage.sync_failed')
    providerId = null
  } finally {
    state.isVerifying = false
  }
  if (providerId) {
    await resumeConnectAfterSyncConflict(state, providerId)
  }
}

export async function resolveSyncConflictKeepLocal(
  state: VaultState,
): Promise<void> {
  const conflict = state.pendingSyncConflict
  if (!conflict || state.isVerifying) return

  state.isVerifying = true
  state.errorMsg = ''
  log.info('sync conflict resolved (keep local)', {
    provider: conflict.providerLabel,
    kind: conflict.kind,
  })
  let providerId: string | null
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
    providerId = await state.ensureProviderSavedAfterConflict(conflict)
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
    providerId = null
  } finally {
    state.isVerifying = false
  }
  if (providerId) {
    await resumeConnectAfterSyncConflict(state, providerId)
  }
}

export async function resolveSyncConflictKeepRemote(
  state: VaultState,
): Promise<void> {
  const conflict = state.pendingSyncConflict
  if (!conflict || state.isVerifying) return

  state.isVerifying = true
  state.errorMsg = ''
  log.info('sync conflict resolved (keep remote)', {
    provider: conflict.providerLabel,
    kind: conflict.kind,
  })
  let providerId: string | null
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
    providerId = await state.ensureProviderSavedAfterConflict(conflict)
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
    providerId = null
  } finally {
    state.isVerifying = false
  }
  if (providerId) {
    await resumeConnectAfterSyncConflict(state, providerId)
  }
}

export async function confirmRecoverRemoteVault(
  state: VaultState,
): Promise<void> {
  if (!state.manager) return
  state.errorMsg = ''
  state.isVerifying = true
  try {
    await state.enqueueStorage(() =>
      state.manager!.prepareConnectFromLocalCache(),
    )
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
  // A foreground password op (verify/enroll/rotate) borrows the wasm manager;
  // a per-provider sync's `&mut self` future would alias that borrow.
  if (state.isPasswordBusy) return
  // A foreground secret edit (add/delete) writes the event log to IndexedDB via
  // the serialized storage chain; this per-provider sync's out-of-chain IDB
  // reads (fetch/read local/update metadata) would otherwise race that write
  // and deadlock the IndexedDB transaction.
  if (state.isSaving) return
  const provider = state.providers.find((p) => p.id === providerId)
  if (!provider || provider.type === 'local') return
  if (state.syncingProviderId && state.syncingProviderId !== providerId) return

  state.syncingProviderId = providerId
  if (!options?.quiet) {
    state.errorMsg = ''
  }
  log.debug('provider sync started', {
    providerId,
    type: provider.type,
    label: provider.label,
    quiet: options?.quiet ?? false,
  })
  try {
    const [mode, pat, repo] = state.providerWasmArgs(provider)
    if (state.isAuthenticated && state.localVaultPresent) {
      const remote = await fetchRemoteVaultBlob(mode, pat, repo)
      if (remote.missing || !remote.content.trim()) {
        await state.enqueueStorage(() =>
          state.manager!.pushRemoteVaultYamlSnapshotForProvider(
            mode,
            pat,
            repo,
          ),
        )
        const localYaml = await readLocalVaultBlob()
        if (localYaml.trim()) {
          await state.updateProviderSyncMetadata(
            providerId,
            localYaml,
            remote.revision,
          )
        }
        if (!options?.quiet) {
          state.showSuccess(state.t('auth_storage.sync_pushed'))
        }
        return
      }
    }
    // `sync_vault_from_storage` checks the IDB event-log flag; the in-memory
    // `eventLogMode()` bit can be false after reload until connect finishes.
    const raw = await state.enqueueStorage(() =>
      state.raceStorageTimeout(
        state.manager!.sync_vault_from_storage(mode, pat, repo),
        'Vault sync',
      ),
    )
    state.applyVaultSyncResult(raw)
    await state.refreshSecretsFromSession()
    await state.refreshReplacementConflicts()
    await state.updateProviderSyncMetadata(
      providerId,
      await readLocalVaultBlob(),
      null,
    )
    log.debug('provider sync finished', { providerId, type: provider.type })
    return
  } catch (e: unknown) {
    syncError(`provider sync (${provider.label})`, e)
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
