import type { VaultState } from '$lib/vault.svelte'
import type { NookSecretRecord, VaultItemType } from '$lib/nook'

export async function loadDb(state: VaultState) {
  if (state.isInitializing) {
    state.errorMsg = 'Vault engine is still loading. Try again in a moment.'
    return
  }

  if (!state.manager) {
    state.errorMsg =
      'Vault engine is not available. Refresh the page and try again.'
    return
  }

  if (state.isVerifying) {
    state.errorMsg = 'Connection already in progress.'
    return
  }

  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true
  try {
    await state.initDeviceIdentity()
    await state.ensureOAuthTokensFresh()

    if (!state.isAuthenticated && state.syncProviders.length > 0) {
      await state.syncProviderById(state.syncProviders[0]!.id, { quiet: true })
    }

    const accessStatus = await state.assessVaultConnectStatus()

    if (
      state.pendingConnectRecovery === 'none' &&
      (await state.handleRemoteVaultAssessStatus(accessStatus))
    ) {
      return
    }

    if (accessStatus === 'needs_enrollment') {
      await state.ensureProviderSaved()
      const hasPasswordFallback = await state.refreshPasswordEntriesList()
      if (hasPasswordFallback && state.passwordEntries.length > 0) {
        state.loginPasswordPrompt = true
        state.joinEnrollmentPrompt = 'none'
        return
      }
      state.joinEnrollmentPrompt = 'needs_request'
      state.startVaultSync()
      return
    }
    if (accessStatus === 'join_pending') {
      await state.ensureProviderSaved()
      const hasPasswordFallback = await state.refreshPasswordEntriesList()
      if (hasPasswordFallback && state.passwordEntries.length > 0) {
        state.loginPasswordPrompt = true
        state.joinEnrollmentPrompt = 'none'
        return
      }
      state.joinEnrollmentPrompt = 'pending'
      state.startVaultSync()
      return
    }

    if (state.stagedRemoteStorageArgs()) {
      const reconcileOutcome = await state.reconcileStagedRemoteWithLocal()
      if (reconcileOutcome === 'conflict') {
        return
      }
    }

    const rawRecords = await state.enqueueStorage(async () => {
      const connectPromise =
        state.pendingConnectRecovery === 'fresh'
          ? state.manager!.connect_fresh(...state.connectStorageArgs())
          : state.manager!.connect(...state.connectStorageArgs())
      state.pendingConnectRecovery = 'none'
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                'Connection timed out. Check your PAT, network, and try again.',
              ),
            ),
          30_000,
        )
      })
      return (await Promise.race([
        connectPromise,
        timeoutPromise,
      ])) as NookSecretRecord[]
    })
    state.secrets = rawRecords
    state.markVaultUnlocked()
    state.syncOAuthRemoteRefFromManager()
    await state.ensureProviderSaved()
    await state.loadProviders()
    await state.promoteSessionVaultToLocalIfNeeded()
    await state.refreshPasswordEntriesList()
    await state.hydrateMultiDeviceState()
    if (state.storageMode === 'local') {
      state.showSuccess(state.t('toasts.local_loaded'))
    } else if (state.storageMode === 'oauth-file') {
      state.showSuccess(state.t('toasts.google_drive_connected'))
    } else {
      state.showSuccess(state.t('toasts.github_connected'))
    }
  } catch (e: unknown) {
    state.isAuthenticated = false
    const message = e instanceof Error ? e.message : String(e)
    state.errorMsg = state.resolveErrorMessage(message)
  } finally {
    state.isVerifying = false
  }

  if (state.isAuthenticated) {
    try {
      await state.syncFromStorage({ force: true })
    } catch {
      // Post-unlock sync should not block the login gate.
    }
    state.startVaultSync()
  }
}

export async function handleAddSecret(
  state: VaultState,
  id: string,
  type: VaultItemType,
  data: string,
) {
  if (!state.manager) return
  if (state.syncBlocked) {
    state.errorMsg = state.t('auth_storage.sync_blocked_edits')
    return
  }
  state.errorMsg = ''
  state.dismissSuccess()
  state.isSaving = true
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  try {
    await state.enqueueStorage(async () => {
      const rawRecords = (await state.raceStorageTimeout(
        state.manager!.add_secret(id, type, data),
        'Add secret',
      )) as NookSecretRecord[]
      state.secrets = rawRecords
    })
    await state.refreshSecretsFromSession()
    state.showSuccess(state.t('toasts.secret_saved'))
    await state.runFanOutSyncAfterLocalSave()
    await state.refreshSecretsFromSession()
  } catch (e: unknown) {
    state.errorMsg = `Failed to save secret: ${e instanceof Error ? e.message : String(e)}`
    throw e
  } finally {
    state.isSaving = false
  }
}

export async function handleDeleteSecret(state: VaultState, id: string) {
  if (!state.manager) return
  if (state.syncBlocked) {
    state.errorMsg = state.t('auth_storage.sync_blocked_edits')
    return
  }
  state.errorMsg = ''
  state.dismissSuccess()
  state.isSaving = true
  // Drop the row immediately so the UI reflects the delete without waiting for
  // the authoritative wasm op, which can queue behind background sync work
  // (restored below if the delete fails).
  const previousSecrets = state.secrets
  state.secrets = state.secrets.filter((record) => record.id !== id)
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  try {
    await state.enqueueStorage(async () => {
      const rawRecords = (await state.manager!.delete_secret(
        id,
      )) as NookSecretRecord[]
      state.secrets = rawRecords
    })
    await state.refreshSecretsFromSession()
    state.showSuccess(state.t('toasts.secret_deleted'))
    state.scheduleFanOutSyncAfterLocalSave()
  } catch (e: unknown) {
    state.secrets = previousSecrets
    state.errorMsg = `Failed to delete secret: ${e instanceof Error ? e.message : String(e)}`
    throw e
  } finally {
    state.isSaving = false
  }
}

export async function handleReplaceSecret(
  state: VaultState,
  oldId: string,
  type: VaultItemType,
  data: string,
) {
  if (!state.manager) return
  if (state.syncBlocked) {
    state.errorMsg = state.t('auth_storage.sync_blocked_edits')
    return
  }
  state.errorMsg = ''
  state.dismissSuccess()
  state.isSaving = true
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  try {
    const newId = state.manager!.generate_secret_id()
    await state.enqueueStorage(async () => {
      const rawRecords = (await state.manager!.replace_secret(
        oldId,
        newId,
        type,
        data,
      )) as NookSecretRecord[]
      state.secrets = rawRecords
    })
    await state.refreshSecretsFromSession()
    state.showSuccess(state.t('toasts.item_updated'))
    state.scheduleFanOutSyncAfterLocalSave()
  } catch (e: unknown) {
    state.errorMsg = `Failed to update item: ${e instanceof Error ? e.message : String(e)}`
    throw e
  } finally {
    state.isSaving = false
  }
}

export function filterSecrets(
  state: VaultState,
  query: string,
): NookSecretRecord[] {
  if (!state.manager) return []
  return state.manager.filter_secrets(query)
}

export async function refreshPasswordEntriesList(
  state: VaultState,
): Promise<boolean> {
  if (!state.manager) return false
  try {
    if (!state.hasRemoteCredentials()) {
      state.passwordEntries = []
      state.loginUnlockMode = 'unknown'
      return false
    }
    await state.ensureOAuthTokensFresh()
    const raw = await state.enqueueStorage(() =>
      state.manager!.fetchVaultPasswordEntries(...state.wasmStorageArgs()),
    )
    state.passwordEntries = raw
    state.loginUnlockMode = 'keys'
    if (state.passwordEntries.length === 1 && !state.selectedPasswordEntryId) {
      state.selectedPasswordEntryId = state.passwordEntries[0]!.id
    }
    return true
  } catch {
    if (!state.isAuthenticated) {
      state.loginUnlockMode = 'unknown'
    }
    state.passwordEntries = []
    return false
  }
}

export function generatePassword(
  state: VaultState,
  length: number,
  lowercase: boolean,
  uppercase: boolean,
  numbers: boolean,
  symbols: boolean,
): string {
  if (!state.manager) {
    throw new Error('Vault engine is not available.')
  }
  return state.manager.generate_password(
    length,
    lowercase,
    uppercase,
    numbers,
    symbols,
  )
}
