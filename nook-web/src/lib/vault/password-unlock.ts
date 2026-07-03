import { VaultState } from '$lib/vault.svelte'
import { isoTimestamp, type NookSecretRecord } from '$lib/nook'
import { createLogger } from '$lib/log'
import {
  decryptEnrollmentPayload,
  encryptEnrollmentPayload,
  type EnrollmentIssueInput,
  type EnrollmentProvider,
} from '$lib/enrollment-code'
import {
  attemptReconcileVaultSyncBlobs,
  fetchRemoteVaultBlob,
  readLocalVaultBlob,
  writeLocalVaultBlob,
} from '$lib/vault-sync'

const log = createLogger('vault-password')

type E2ePasswordManager = {
  addVaultPasswordForE2e?: (label: string, password: string) => Promise<void>
  updateVaultPasswordEntryForE2e?: (
    entryId: string,
    password: string,
  ) => Promise<void>
}

export async function addVaultPassword(
  state: VaultState,
  label: string,
  password: string,
): Promise<void> {
  if (!state.manager) {
    state.passwordError = 'Vault engine is not available.'
    return
  }
  if (!state.isAuthenticated) {
    state.passwordError = 'Unlock the vault before adding a password.'
    return
  }
  const hadPasswords = state.passwordEntries.length > 0
  state.passwordError = ''
  state.isPasswordBusy = true
  try {
    const manager = state.manager!
    await state.enqueueStorage(() => {
      const trimmedLabel = label.trim()
      const e2eManager = manager as typeof manager & E2ePasswordManager
      if (
        import.meta.env.VITE_E2E_EXPOSE_VAULT === 'true' &&
        e2eManager.addVaultPasswordForE2e
      ) {
        return e2eManager.addVaultPasswordForE2e(trimmedLabel, password)
      }
      return manager.addVaultPassword(trimmedLabel, password)
    })
    await state.refreshPasswordEntriesList()
    log.info('vault password added', { hadPasswords, label: label.trim() })
    state.showSuccess(
      hadPasswords
        ? state.t('toasts.password_added_rotate')
        : state.t('toasts.password_set'),
    )
    await state.hydrateMultiDeviceState()
    await state.runFanOutSyncAfterLocalSave()
  } catch (e: unknown) {
    state.passwordError =
      e instanceof Error ? e.message : 'Failed to add vault password.'
    throw e
  } finally {
    state.isPasswordBusy = false
  }
}

export async function updateVaultPasswordEntry(
  state: VaultState,
  entryId: string,
  password: string,
): Promise<void> {
  if (!state.manager) {
    state.passwordError = 'Vault engine is not available.'
    return
  }
  state.passwordError = ''
  state.isPasswordBusy = true
  try {
    const manager = state.manager!
    await state.enqueueStorage(() => {
      const e2eManager = manager as typeof manager & E2ePasswordManager
      if (
        import.meta.env.VITE_E2E_EXPOSE_VAULT === 'true' &&
        e2eManager.updateVaultPasswordEntryForE2e
      ) {
        return e2eManager.updateVaultPasswordEntryForE2e(entryId, password)
      }
      return manager.updateVaultPasswordEntry(entryId, password)
    })
    await state.refreshPasswordEntriesList()
    state.showSuccess(state.t('toasts.password_updated'))
    await state.runFanOutSyncAfterLocalSave()
  } catch (e: unknown) {
    state.passwordError =
      e instanceof Error ? e.message : 'Failed to update vault password.'
    throw e
  } finally {
    state.isPasswordBusy = false
  }
}

export async function removeVaultPasswordEntry(
  state: VaultState,
  entryId: string,
): Promise<void> {
  if (!state.manager) return
  state.passwordError = ''
  state.isPasswordBusy = true
  try {
    await state.enqueueStorage(() =>
      state.manager!.removeVaultPasswordEntry(entryId),
    )
    await state.refreshPasswordEntriesList()
    if (state.activeEnrollmentEntryId === entryId) {
      state.enrollmentCode = ''
      state.activeEnrollmentEntryId = null
    }
    state.showSuccess(state.t('toasts.password_removed'))
    await state.runFanOutSyncAfterLocalSave()
  } catch (e: unknown) {
    state.passwordError =
      e instanceof Error ? e.message : 'Failed to remove vault password.'
    throw e
  } finally {
    state.isPasswordBusy = false
  }
}

export async function setVaultPassword(
  state: VaultState,
  password: string,
): Promise<void> {
  await state.addVaultPassword('Vault password', password)
}

export async function removeVaultPassword(state: VaultState): Promise<void> {
  const entry = state.passwordEntries[0]
  if (!entry) return
  await state.removeVaultPasswordEntry(entry.id)
}

export async function unlockWithPassword(
  state: VaultState,
  entryId: string,
  password: string,
): Promise<void> {
  if (!state.manager) {
    state.errorMsg = 'Vault engine is not available.'
    return
  }
  if (state.isVerifying) return
  if (!state.hasRemoteCredentials()) {
    state.errorMsg =
      state.storageMode === 'oauth-file'
        ? state.t('errors.google_sign_in_required')
        : 'Configure GitHub credentials before unlocking.'
    return
  }
  await state.ensureOAuthTokensFresh()
  if (!entryId.trim()) {
    state.errorMsg = 'Choose a vault password to unlock.'
    return
  }
  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true
  try {
    await state.initDeviceIdentity()
    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.connectWithPassword(
        ...state.wasmStorageArgs(),
        entryId,
        password,
      ),
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    state.markVaultUnlocked()
    log.info('vault unlocked with password', {
      mode: state.storageMode,
      secrets: rawRecords.length,
      entryId,
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
    state.errorMsg =
      e instanceof Error ? e.message : 'Failed to unlock with password.'
  } finally {
    state.isVerifying = false
  }
}

export function clearEnrollmentCode(state: VaultState) {
  state.enrollmentCode = ''
  state.activeEnrollmentEntryId = null
}

export async function connectWithEnrollmentCode(
  state: VaultState,
  code: string,
  password = '',
): Promise<void> {
  if (!state.manager) {
    state.errorMsg = 'Vault engine is not available.'
    return
  }
  state.errorMsg = ''
  state.dismissSuccess()
  state.isVerifying = true
  try {
    const payload = await decryptEnrollmentPayload(code, password)
    const entryId = payload.entry_id.trim()
    const unlockPassword = password.trim()
    if (!entryId) {
      throw new Error('Enrollment code is missing a vault password entry id.')
    }
    if (!unlockPassword) {
      throw new Error('Enter the vault password for state onboarding QR.')
    }

    if (payload.provider.type === 'github') {
      state.storageMode = 'github'
      state.githubPat = payload.provider.pat
      state.githubRepo = payload.provider.repo
      state.loginSetupType = 'github'
    } else {
      state.storageMode = 'local'
      state.loginSetupType = 'local'
    }

    await state.initDeviceIdentity()

    if (payload.provider.type === 'github') {
      const remote = await fetchRemoteVaultBlob(
        'github',
        payload.provider.pat,
        payload.provider.repo,
      )
      if (!remote.content.trim()) {
        throw new Error(
          'This sync provider has no vault copy yet. Save secrets on the issuing device first.',
        )
      }
      const localYaml = await readLocalVaultBlob()
      const attempt = attemptReconcileVaultSyncBlobs(
        localYaml,
        remote.content,
        remote.revision,
      )
      if (attempt.status === 'store_id_mismatch') {
        throw new Error(
          state.t('auth_storage.sync_store_id_mismatch', {
            provider: 'GitHub',
          }),
        )
      }
      const reconcile = attempt.result
      if (reconcile.action === 'conflict') {
        throw new Error(
          'Local and sync-provider vaults conflict. Resolve on the issuing device first.',
        )
      }
      if (!localYaml.trim() || reconcile.action === 'adopt_remote') {
        await writeLocalVaultBlob(reconcile.localYaml)
      }
      state.localVaultPresent = true
    }

    const rawRecords = (await state.enqueueStorage(() =>
      state.manager!.connectWithPassword(
        'local',
        '',
        '',
        entryId,
        unlockPassword,
      ),
    )) as NookSecretRecord[]
    state.secrets = rawRecords
    state.markVaultUnlocked()
    await state.ensureProviderSaved()
    await state.loadProviders()
    await state.refreshPasswordEntriesList()
    void state.hydrateMultiDeviceState()
    state.joinEnrollmentPrompt = 'none'
    state.loginEnrollmentCode = ''
    state.prefillEnrollmentCode = ''
    state.enrollmentFromUrlPending = false
    state.showSuccess(state.t('toasts.device_enrolled'))
    state.startIdleSessionTracking()
    state.startVaultSync()
  } catch (e: unknown) {
    state.isAuthenticated = false
    state.errorMsg =
      e instanceof Error
        ? e.message
        : 'Failed to enroll with the provided code.'
  } finally {
    state.isVerifying = false
  }
}

export async function issueEnrollmentCode(
  state: VaultState,
  entryId: string,
  password: string,
  providerId = state.syncProviders[0]?.id ?? '',
): Promise<string> {
  if (!state.manager) {
    throw new Error('Vault engine is not available.')
  }
  // Password verification borrows the wasm manager synchronously (`&self`).
  // `isPasswordBusy` makes the periodic sync tick skip, but we still have to
  // wait for any *already in-flight* `&mut self` storage future to release its
  // borrow before verify runs, or wasm-bindgen's borrow detector trips.
  state.isPasswordBusy = true
  try {
    // Wait for the queued wasm op to settle. We deliberately do NOT
    // `resetStorageChain()` on timeout: abandoning an in-flight `&mut self`
    // future leaves its IndexedDB transaction dangling, which surfaces later as
    // "database is not open" and poisons subsequent borrows. Surface a
    // retriable error instead.
    try {
      await state.raceStorageTimeout(
        state.storageChain as Promise<void>,
        'Vault storage',
      )
    } catch {
      throw new Error('Vault storage is busy. Try again.')
    }
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The target entry is already loaded in memory after `addVaultPassword`.
    // Only hit storage when it is genuinely missing — a redundant refresh can
    // otherwise queue behind (or race) background sync work and stall
    // enrollment on the shared storage chain.
    if (!state.passwordEntries.some((entry) => entry.id === entryId)) {
      const refreshed = await state.refreshPasswordEntriesList()
      if (!refreshed || state.passwordEntries.length === 0) {
        throw new Error(
          'Add a backup vault password first; enrollment codes wrap that password.',
        )
      }
      if (!state.passwordEntries.some((entry) => entry.id === entryId)) {
        throw new Error(
          'Password entry not found. Wait for sync to finish and try again.',
        )
      }
    }
    // `verifyVaultPassword` returns false on a wrong password but can also
    // throw if the underlying age decryptor rejects — treat both as "wrong
    // password" so the UI message stays predictable.
    let verified: boolean
    try {
      verified = await state.enqueueStorage(async () => {
        await Promise.resolve()
        return state.manager!.verifyVaultPassword(entryId, password)
      })
    } catch {
      verified = false
    }
    if (!verified) {
      throw new Error('Password does not match the vault.')
    }
    const selectedProvider = state.providers.find((p) => p.id === providerId)
    if (!selectedProvider) {
      throw new Error('Choose a sync provider.')
    }
    if (selectedProvider.type === 'local') {
      throw new Error(
        'Choose a cloud sync provider — local vault is already on state device.',
      )
    }
    const provider: EnrollmentProvider =
      selectedProvider.type === 'github'
        ? {
            type: 'github',
            pat: selectedProvider.githubPat?.trim() ?? '',
            repo: selectedProvider.githubRepo?.trim() ?? '',
          }
        : { type: 'local' }
    if (provider.type === 'github' && (!provider.pat || !provider.repo)) {
      throw new Error(
        'GitHub sync provider is missing credentials. Reconnect in Settings and try again.',
      )
    }
    const payload: EnrollmentIssueInput = {
      provider,
      entry_id: entryId,
      issued_at: isoTimestamp(),
    }
    const selectedPassword = state.passwordEntries.find((e) => e.id === entryId)
    const code = await encryptEnrollmentPayload(
      payload,
      password,
      selectedPassword?.label ?? '',
    )
    state.enrollmentCode = code
    state.activeEnrollmentEntryId = entryId
    return code
  } finally {
    state.isPasswordBusy = false
  }
}
