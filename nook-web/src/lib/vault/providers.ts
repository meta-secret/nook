import type { VaultState } from '$lib/vault.svelte'
import { generateId, isoTimestamp } from '$lib/nook'
import {
  DEFAULT_DRIVE_VAULT_FILE,
  DEFAULT_GITHUB_REPO,
  findDuplicateSyncProvider,
  loadAuthProviders,
  loadAuthProvidersWithVaultMigration,
  providerDefaultLabel,
  saveAuthProviders,
  type LocalFolderConfig,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from '$lib/auth-providers'
import { removeLocalFolderHandle } from '$lib/local-folder-sync'
import { ensureLocalProviderRow } from '$lib/vault-migration'
import { createLogger } from '$lib/log'
import { vaultStoreIdForProviderSave } from '$lib/vault-store-id'

const log = createLogger('vault-providers')

export async function loadProviders(
  state: VaultState,
  options?: { migrateLegacyVault?: boolean },
) {
  const snapshot = await state.enqueueStorage(() =>
    options?.migrateLegacyVault
      ? loadAuthProvidersWithVaultMigration(state.manager!)
      : loadAuthProviders(state.manager!),
  )
  state.providers = snapshot.providers.map((p) =>
    p.label === 'GitHub sync' ? { ...p, label: 'GitHub' } : p,
  )
  if (snapshot.activeVaultStoreId) {
    state.activeVaultStoreId = snapshot.activeVaultStoreId
  }
  state.providersLoaded = true
  log.debug('providers loaded', {
    count: state.providers.length,
    localVaultPresent: state.localVaultPresent,
  })
}

export function applyActiveProviderCredentials(state: VaultState) {
  if (state.localVaultPresent) {
    state.storageMode = 'local'
    state.githubPat = ''
    state.oauthFile = null
    state.localFolder = null
    return
  }

  if (state.loginSetupType) {
    state.storageMode = state.loginSetupType
    if (state.loginSetupType !== 'github') {
      state.githubPat = ''
    }
    if (state.loginSetupType !== 'oauth-file') {
      state.oauthFile = null
    }
    if (state.loginSetupType !== 'local-folder') {
      state.localFolder = null
    }
    return
  }

  const stagingGoogle =
    state.loginSetupType === 'oauth-file' &&
    Boolean(state.oauthFile?.accessToken?.trim())

  const syncProvider = state.syncProviders[0]
  if (!syncProvider) {
    return
  }

  if (stagingGoogle && state.addProviderOpen) {
    state.storageMode = syncProvider.type
    state.githubPat = syncProvider.githubPat ?? ''
    state.githubRepo = syncProvider.githubRepo?.trim() || DEFAULT_GITHUB_REPO
    return
  }

  state.storageMode = syncProvider.type
  state.githubPat = syncProvider.githubPat ?? ''
  if (syncProvider.type === 'oauth-file') {
    state.oauthFile = syncProvider.oauthFile ?? null
    state.localFolder = null
    state.githubRepo =
      syncProvider.oauthFile?.fileName?.trim() || DEFAULT_DRIVE_VAULT_FILE
  } else if (syncProvider.type === 'local-folder') {
    state.localFolder = syncProvider.localFolder ?? null
    state.githubRepo = DEFAULT_GITHUB_REPO
    state.oauthFile = null
  } else {
    state.githubRepo = syncProvider.githubRepo?.trim() || DEFAULT_GITHUB_REPO
    state.oauthFile = null
    state.localFolder = null
  }
}

export async function persistProviders(
  state: VaultState,
  opts?: { replace?: boolean },
) {
  if (!opts?.replace && state.localVaultPresent) {
    const snapshot = await state.enqueueStorage(() =>
      loadAuthProviders(state.manager!),
    )
    const memoryIds = state.providers.map((p) => p.id)
    const extraSync = snapshot.providers.filter(
      (p) => p.type !== 'local' && !memoryIds.includes(p.id),
    )
    if (extraSync.length > 0) {
      state.providers = [...state.providers, ...extraSync]
    }
  }
  await state.enqueueStorage(() =>
    saveAuthProviders(state.manager!, {
      providers: state.providers,
      activeVaultStoreId: state.activeVaultStoreId ?? undefined,
    }),
  )
}

export function beginProviderSetup(
  state: VaultState,
  type: StorageProviderType,
  oauthPreset?: OAuthFilePreset,
) {
  if (!state.isAuthenticated) {
    state.resetVaultSessionState()
  }
  state.loginSetupType = type
  state.storageMode = type
  state.githubPat = ''
  state.githubRepo =
    type === 'oauth-file' ? DEFAULT_DRIVE_VAULT_FILE : DEFAULT_GITHUB_REPO
  if (type === 'oauth-file') {
    const preset = oauthPreset ?? 'google-drive'
    state.oauthSetupPreset = preset
    state.oauthFile = {
      preset,
      accessToken: '',
      fileName: DEFAULT_DRIVE_VAULT_FILE,
    }
  } else {
    state.oauthSetupPreset = null
    state.oauthFile = null
  }
  state.localFolder = null
  state.errorMsg = ''
  state.dismissSuccess()
  log.debug('provider setup started', { type, oauthPreset })
}

export function beginAddProvider(state: VaultState) {
  if (!state.isAuthenticated) {
    state.resetVaultSessionState()
  }
  state.addProviderOpen = true
  state.loginSetupType = null
  state.errorMsg = ''
}

export function cancelAddProvider(state: VaultState) {
  state.addProviderOpen = false
  state.loginSetupType = null
  state.applyActiveProviderCredentials()
  state.errorMsg = ''
}

export function cancelProviderSetup(state: VaultState) {
  if (state.addProviderOpen && state.loginSetupType !== null) {
    const setupType = state.loginSetupType
    state.loginSetupType = null
    state.githubPat = ''
    state.githubRepo =
      setupType === 'oauth-file'
        ? DEFAULT_DRIVE_VAULT_FILE
        : DEFAULT_GITHUB_REPO
    state.localFolder = null
    state.errorMsg = ''
    return
  }
  state.loginSetupType = null
  state.addProviderOpen = false
  state.applyActiveProviderCredentials()
  state.errorMsg = ''
}

export async function removeProvider(
  state: VaultState,
  id: string,
): Promise<void> {
  const target = state.providers.find((p) => p.id === id)
  if (!target || target.type === 'local') return

  await removeLocalFolderHandle(target)
  state.providers = state.providers.filter((p) => p.id !== id)

  if (state.providers.length === 0 && state.isAuthenticated) {
    state.clearUnlockedSession()
  }

  state.applyActiveProviderCredentials()
  await state.persistProviders({ replace: true })

  log.info('sync provider removed', { id, label: target.label })
  state.showSuccess(state.t('toasts.removed_device', { label: target.label }))
}

export async function ensureProviderSaved(state: VaultState): Promise<boolean> {
  const pat = state.githubPat.trim()
  const repo = state.githubRepo.trim() || DEFAULT_GITHUB_REPO
  const driveFile = state.githubRepo.trim() || DEFAULT_DRIVE_VAULT_FILE
  const type = state.loginSetupType ?? state.storageMode
  const isNewSetup = state.loginSetupType !== null
  const vaultStoreId = vaultStoreIdForProviderSave(state)
  const oauthPreset =
    state.oauthFile?.preset ?? state.oauthSetupPreset ?? 'google-drive'
  const oauthSnapshot: OAuthFileConfig | undefined =
    type === 'oauth-file'
      ? {
          preset: oauthPreset,
          accessToken: state.oauthFile?.accessToken ?? '',
          refreshToken: state.oauthFile?.refreshToken,
          expiresAt: state.oauthFile?.expiresAt,
          fileId: state.oauthFile?.fileId,
          accountEmail: state.oauthFile?.accountEmail,
          fileName: driveFile,
        }
      : undefined
  const localFolderSnapshot: LocalFolderConfig | undefined =
    type === 'local-folder'
      ? {
          directoryName: state.localFolder?.directoryName,
          handleId: state.localFolder?.handleId,
        }
      : undefined

  const isExplicitAdd =
    state.addProviderOpen ||
    (state.isAuthenticated && state.loginSetupType !== null)

  if (isNewSetup && type !== 'local') {
    if (type === 'local-folder' && !localFolderSnapshot?.handleId) {
      state.errorMsg = state.t('auth_storage.local_folder_choose_err')
      return false
    }
    const provider: StorageProvider = {
      id: generateId(),
      type,
      label: providerDefaultLabel(
        type,
        type === 'github'
          ? repo
          : type === 'oauth-file'
            ? driveFile
            : type === 'local-folder'
              ? localFolderSnapshot?.directoryName
            : undefined,
        oauthPreset,
      ),
      githubPat: type === 'github' ? pat : undefined,
      githubRepo: type === 'github' ? repo : undefined,
      oauthFile: oauthSnapshot,
      localFolder: localFolderSnapshot,
      storeId: vaultStoreId,
      createdAt: isoTimestamp(),
    }
    if (findDuplicateSyncProvider(state.activeVaultProviders, provider)) {
      if (isExplicitAdd) {
        state.errorMsg = state.t('auth_storage.duplicate_sync_provider')
        return false
      }
    } else {
      state.providers = [...state.providers, provider]
    }
  } else if (isNewSetup && type === 'local' && !state.localProvider) {
    const provider: StorageProvider = {
      id: generateId(),
      type: 'local',
      label: providerDefaultLabel('local'),
      storeId: vaultStoreId,
      createdAt: isoTimestamp(),
    }
    state.providers = [...state.providers, provider]
  } else if (state.localProvider) {
    state.providers = state.providers.map((provider) =>
      provider.id === state.localProvider?.id
        ? {
            ...provider,
            storeId: vaultStoreId ?? provider.storeId,
          }
        : provider,
    )
  } else {
    state.providers = ensureLocalProviderRow(
      {
        providers: state.providers,
        activeVaultStoreId: state.activeVaultStoreId ?? undefined,
      },
      vaultStoreId,
    ).providers
  }

  if (state.storageMode === 'oauth-file' && state.oauthFile?.fileId) {
    const activePreset = state.oauthFile.preset
    state.providers = state.providers.map((provider) => {
      if (
        provider.type !== 'oauth-file' ||
        !provider.oauthFile ||
        provider.oauthFile.preset !== activePreset
      ) {
        return provider
      }
      const merged: OAuthFileConfig = {
        preset: activePreset,
        accessToken:
          state.oauthFile!.accessToken || provider.oauthFile.accessToken,
        refreshToken: provider.oauthFile.refreshToken,
        expiresAt: provider.oauthFile.expiresAt ?? state.oauthFile!.expiresAt,
        fileId: state.oauthFile!.fileId,
        fileName:
          provider.oauthFile.fileName?.trim() ||
          state.oauthFile!.fileName?.trim() ||
          driveFile,
        accountEmail:
          provider.oauthFile.accountEmail ?? state.oauthFile!.accountEmail,
      }
      return { ...provider, oauthFile: merged }
    })
    state.oauthFile =
      state.providers.find(
        (p) => p.type === 'oauth-file' && p.oauthFile?.preset === activePreset,
      )?.oauthFile ?? state.oauthFile
  }

  state.loginSetupType = null
  state.addProviderOpen = false
  state.applyActiveProviderCredentials()
  await state.persistProviders()
  log.info('sync provider saved', { type, explicitAdd: isExplicitAdd })
  return true
}

export async function connectStagedProvider(state: VaultState): Promise<void> {
  if (state.loginSetupType) {
    state.storageMode = state.loginSetupType
  }
  if (state.isAuthenticated && state.loginSetupType !== 'local') {
    await state.connectAndSyncStagedProvider()
    return
  }
  await state.loadDb()
}

export async function connectAndSyncStagedProvider(
  state: VaultState,
): Promise<void> {
  if (!state.manager) return
  if (state.isVerifying) return
  state.isVerifying = true
  try {
    const reconcileOutcome = await state.reconcileStagedRemoteWithLocal()
    if (reconcileOutcome === 'conflict') {
      return
    }

    const saved = await state.ensureProviderSaved()
    if (!saved) {
      return
    }
    const provider =
      state.syncProviders[state.syncProviders.length - 1] ??
      state.providers[state.providers.length - 1]
    if (!provider || provider.type === 'local') {
      state.errorMsg = 'Choose a cloud sync provider.'
      return
    }
    await state.syncProviderById(provider.id, { quiet: true })
    state.loginSetupType = null
    state.addProviderOpen = false
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : state.t('auth_storage.sync_failed')
  } finally {
    state.isVerifying = false
  }
}
