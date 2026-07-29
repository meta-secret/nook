import { omittedValue } from '../../../explicit-state'
/** Provider actions that snapshot reactive Svelte state at WASM boundaries. */
import type { ProviderActionsContext } from '$lib/vault/action-contexts'
import { generateId, isoTimestamp, type VaultAccessStatus } from '$lib/nook'
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  DEFAULT_GITHUB_REPO,
  DuplicateSyncProviderKind,
  findDuplicateSyncProvider,
  LOCAL_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  providerDefaultLabel,
  saveAuthProviders,
  type AuthProvidersSnapshot,
  type LocalFolderConfig,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from '$lib/auth-providers'
import {
  activeVaultProviders,
  chooseLocalFolderBackupDirectory,
  ensureLocalProviderRow as ensureLocalProviderRowWasm,
  hasLocalVault,
  hasRemoteCredentials,
  isLocalFolderBackupSupported,
  isVaultSessionLocked,
  localProviderIdForActiveVault,
  oauthRemoteStorageRef,
  providerWasmArgs as providerWasmArgsCore,
  removeLocalFolderHandle,
  RemoteVaultAssessDecision,
  RemoteVaultRecoveryState,
  stagedProviderLabel as stagedProviderLabelCore,
  stagedRemoteStorageArgs as stagedRemoteStorageArgsCore,
  syncProvidersForActiveVault,
  updateOauthRemoteRef,
  wasmStorageArgs as wasmStorageArgsCore,
  type NookStorageConnectArgs,
} from '$app-wasm'
import { createLogger } from '$lib/log'
import { LoginSetupKind } from '$lib/vault/state/provider.svelte'
enum OAuthProviderUpdateKind {
  NotRequired = 'not-required',
  Required = 'required',
}

type OAuthProviderUpdate =
  | { kind: OAuthProviderUpdateKind.NotRequired }
  | { kind: OAuthProviderUpdateKind.Required; providerId: string }

export const VAULT_ASSESS_TIMEOUT_ERROR_NAME = 'VaultAssessTimeoutError'

const log = createLogger('vault-providers')

type VaultDiscoveryTimeout = {
  completion: Promise<never>
  cancel(): void
}

function startVaultDiscoveryTimeout(
  message: string,
  timeoutMs: number,
): VaultDiscoveryTimeout {
  const controller = new AbortController()
  const completion = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error(message)
      timeoutError.name = VAULT_ASSESS_TIMEOUT_ERROR_NAME
      reject(timeoutError)
    }, timeoutMs)
    controller.signal.addEventListener('abort', () => clearTimeout(timer), {
      once: true,
    })
  })
  return {
    completion,
    cancel: () => controller.abort(),
  }
}

function takeStorageArgsTuple(
  args: NookStorageConnectArgs,
): [string, string, string] {
  try {
    return [args.mode, args.pat, args.repo]
  } finally {
    args.free()
  }
}

function stagedProviderType(
  state: ProviderActionsContext,
): StorageProviderType {
  return state.loginSetup.kind === LoginSetupKind.Active
    ? state.loginSetup.providerType
    : state.storageMode
}

function providerSnapshot(state: ProviderActionsContext) {
  return $state.snapshot({
    providers: state.providers,
    ...(state.activeVaultStoreId
      ? { activeVaultStoreId: state.activeVaultStoreId }
      : {}),
  })
}

export function wasmStorageArgs(
  state: ProviderActionsContext,
): [string, string, string] {
  const syncProvider = syncProviders(state)[0]
  return takeStorageArgsTuple(
    wasmStorageArgsCore(
      state.localVaultPresent,
      state.isAuthenticated,
      syncProvider ? $state.snapshot(syncProvider) : omittedValue(),
      state.storageMode,
      state.githubPat,
      state.githubRepo,
      state.oauthFile?.preset,
      state.oauthFile?.accessToken,
      state.oauthFile
        ? oauthRemoteStorageRef($state.snapshot(state.oauthFile))
        : omittedValue(),
      state.oauthFile?.fileName,
    ),
  )
}

export function providerWasmArgs(
  provider: StorageProvider,
): [string, string, string] {
  return takeStorageArgsTuple(providerWasmArgsCore($state.snapshot(provider)))
}

export function connectStorageArgs(
  state: ProviderActionsContext,
): [string, string, string] {
  if (shouldUseJoinProviderForConnect(state)) {
    return providerWasmArgs(syncProviders(state)[0]!)
  }
  return wasmStorageArgs(state)
}

export function shouldUseJoinProviderForConnect(
  state: ProviderActionsContext,
): boolean {
  return state.clientPolicy.shouldUseJoinProviderForConnect(
    state.isAuthenticated,
    syncProviders(state).length,
    state.joinEnrollmentPrompt,
  )
}

export function stagedRemoteStorageArgs(
  state: ProviderActionsContext,
): [string, string, string] | void {
  const type = stagedProviderType(state)
  const args = stagedRemoteStorageArgsCore(
    type,
    state.githubPat || omittedValue(),
    state.githubRepo || omittedValue(),
    state.oauthFile ? $state.snapshot(state.oauthFile) : omittedValue(),
  )
  return args ? takeStorageArgsTuple(args) : omittedValue()
}

export function stagedProviderLabel(state: ProviderActionsContext): string {
  return stagedProviderLabelCore(
    stagedProviderType(state),
    state.githubRepo,
    state.oauthFile?.fileName,
    state.oauthFile?.preset,
    state.oauthSetupPreset,
  )
}

export function hasRemoteProviderCredentials(
  state: ProviderActionsContext,
): boolean {
  return hasRemoteCredentials(
    state.storageMode,
    state.githubPat,
    state.oauthFile?.accessToken,
    state.localFolder?.handleId,
  )
}

export function syncOAuthRemoteRefFromManager(
  state: ProviderActionsContext,
): void {
  if (
    state.storageMode !== OAUTH_FILE_PROVIDER_TYPE ||
    !state.manager ||
    !state.oauthFile
  ) {
    return
  }
  const updated = updateOauthRemoteRef(
    $state.snapshot(state.oauthFile),
    state.manager.storage_remote_ref ?? '',
  )
  if (updated) state.oauthFile = updated
}

export async function chooseLocalFolder(
  state: ProviderActionsContext,
): Promise<void> {
  refreshLocalFolderBackupSupport(state)
  if (!state.localFolderBackupSupported) {
    throw new Error(state.t('provider_setup.local_folder_unsupported_browser'))
  }
  const folder = await chooseLocalFolderBackupDirectory()
  state.localFolder = {
    directoryName: folder.directoryName,
    handleId: folder.handleId,
  }
}

export function refreshLocalFolderBackupSupport(
  state: ProviderActionsContext,
): void {
  state.localFolderBackupSupported =
    'window' in globalThis && isLocalFolderBackupSupported()
}

export function localProvider(
  state: ProviderActionsContext,
): StorageProvider | void {
  const id = localProviderIdForActiveVault(
    providerSnapshot(state),
    state.activeVaultStoreId,
  )
  return id
    ? state.providers.find((provider) => provider.id === id)
    : omittedValue()
}

export function activeProviders(
  state: ProviderActionsContext,
): StorageProvider[] {
  return activeVaultProviders(providerSnapshot(state), state.activeVaultStoreId)
    .providers
}

export function syncProviders(
  state: ProviderActionsContext,
): StorageProvider[] {
  return syncProvidersForActiveVault(
    providerSnapshot(state),
    state.activeVaultStoreId,
  ).providers
}

export function showLoginVaultPicker(state: ProviderActionsContext): boolean {
  return state.clientPolicy.shouldShowLoginVaultPicker(
    state.isAuthenticated,
    state.localVaults.length,
    state.hasSelectedLoginVaultStore,
    state.loginSetup.kind === LoginSetupKind.Active,
    state.addProviderOpen,
    isVaultSessionLocked(),
  )
}

export async function assessVaultConnectStatus(
  state: ProviderActionsContext,
  args: [string, string, string],
): Promise<VaultAccessStatus> {
  const manager = state.manager
  if (!manager) throw new Error(state.t('errors.engine_unavailable'))
  return (await state.enqueueStorage(async () => {
    const assessPromise = manager.assess_vault_connect(...args)
    const timeout = startVaultDiscoveryTimeout(
      'Connection timed out. Check your PAT, network, and try again.',
      30_000,
    )
    try {
      return await Promise.race([assessPromise, timeout.completion])
    } finally {
      timeout.cancel()
    }
  })) as VaultAccessStatus
}

export async function handleRemoteVaultAssessStatus(
  state: ProviderActionsContext,
  accessStatus: VaultAccessStatus,
): Promise<boolean> {
  const decision = state.clientPolicy.remoteVaultAssessDecision(
    accessStatus,
    state.loginRequiresExistingVault,
    state.loginSetup.kind === LoginSetupKind.Active,
  )
  switch (decision) {
    case RemoteVaultAssessDecision.PromptRecoveryFromCache:
      state.remoteVaultRecoveryState = RemoteVaultRecoveryState.PromptWithCache
      await state.refreshPasswordEntriesList()
      return true
    case RemoteVaultAssessDecision.RejectMissingExistingVault:
      state.remoteVaultRecoveryState = RemoteVaultRecoveryState.None
      state.errorMsg = state.t('auth_storage.existing_vault_not_found')
      return true
    case RemoteVaultAssessDecision.PromptMissingRemote:
      state.remoteVaultRecoveryState =
        RemoteVaultRecoveryState.PromptMissingOnly
      return true
    default:
      return false
  }
}

/** Store id for persisting a sync provider row before or after wasm connect. */
async function vaultStoreIdForProviderSave(
  state: ProviderActionsContext,
): Promise<string | void> {
  const fromManager = state.manager
    ? (await state.enqueueStorage(() => state.manager!.vaultStoreId)).trim()
    : ''
  if (fromManager) {
    return fromManager
  }
  return (
    state.activeVaultStoreId?.trim() ||
    state.selectedLoginVaultStoreId?.trim() ||
    omittedValue()
  )
}

function resetICloudSignInState(state: ProviderActionsContext) {
  state.icloudOAuthPreparing = false
  state.icloudOAuthReady = false
  state.icloudOAuthBusy = false
}

export async function loadProviders(
  state: ProviderActionsContext,
  options?: { ensureLocalRow?: boolean },
) {
  const snapshot = await state.enqueueStorage(() =>
    options?.ensureLocalRow
      ? state.manager!.loadAuthProvidersWithLocalRow()
      : state.manager!.loadAuthProviders(),
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

export async function promoteSessionVaultToLocalIfNeeded(
  state: ProviderActionsContext,
): Promise<void> {
  const snapshot = await state.manager!.ensureLocalAuthProviderSnapshot({
    providers: state.providers,
  })
  if (snapshot.providers.length !== state.providers.length) {
    state.providers = snapshot.providers
    await state.enqueueStorage(() =>
      saveAuthProviders(state.manager!, snapshot),
    )
  }
  state.localVaultPresent = await hasLocalVault()
  if (state.localVaultPresent) {
    state.storageMode = LOCAL_PROVIDER_TYPE
    state.githubPat = ''
    state.clearOauthFile()
    state.clearLocalFolder()
  }
}

export function applyActiveProviderCredentials(state: ProviderActionsContext) {
  if (state.localVaultPresent) {
    state.storageMode = 'local'
    state.githubPat = ''
    state.clearOauthFile()
    state.clearLocalFolder()
    return
  }

  if (state.loginSetup.kind === LoginSetupKind.Active) {
    const setupType = state.loginSetup.providerType
    state.storageMode = setupType
    if (setupType !== 'github') {
      state.githubPat = ''
    }
    if (setupType !== 'oauth-file') {
      state.clearOauthFile()
    }
    if (setupType !== 'local-folder') {
      state.clearLocalFolder()
    }
    return
  }

  const syncProvider = state.syncProviders[0]
  if (!syncProvider) {
    return
  }

  state.storageMode = syncProvider.type
  state.githubPat = syncProvider.githubPat ?? ''
  if (syncProvider.type === 'oauth-file') {
    state.oauthFile = syncProvider.oauthFile
    state.clearLocalFolder()
    state.githubRepo =
      syncProvider.oauthFile?.fileName?.trim() || DEFAULT_DRIVE_BACKUP_NAME
  } else if (syncProvider.type === 'local-folder') {
    state.localFolder = syncProvider.localFolder
    state.githubRepo = DEFAULT_GITHUB_REPO
    state.clearOauthFile()
  } else {
    state.githubRepo = syncProvider.githubRepo?.trim() || DEFAULT_GITHUB_REPO
    state.clearOauthFile()
    state.clearLocalFolder()
  }
}

export async function persistProviders(
  state: ProviderActionsContext,
  opts?: { replace?: boolean },
) {
  if (!opts?.replace && state.localVaultPresent) {
    const snapshot = await state.enqueueStorage(() =>
      state.manager!.loadAuthProviders(),
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
      activeVaultStoreId: state.activeVaultStoreId,
    }),
  )
}

export function beginProviderSetup(
  state: ProviderActionsContext,
  type: StorageProviderType,
  oauthPreset?: OAuthFilePreset,
) {
  if (!state.isAuthenticated) {
    state.resetVaultSessionState()
  }
  state.activateLoginSetup(type)
  state.storageMode = type
  state.githubPat = ''
  state.githubRepo =
    type === 'oauth-file' ? DEFAULT_DRIVE_BACKUP_NAME : DEFAULT_GITHUB_REPO
  if (type === 'oauth-file') {
    const preset = oauthPreset ?? 'google-drive'
    if (preset === 'icloud') {
      resetICloudSignInState(state)
    }
    state.oauthSetupPreset = preset
    state.oauthFile = {
      preset,
      accessToken: '',
      fileName: DEFAULT_DRIVE_BACKUP_NAME,
      driveMode: 'private',
      iCloudMode: 'private',
    }
  } else {
    state.clearOauthSetupPreset()
    state.clearOauthFile()
  }
  state.clearLocalFolder()
  state.clearExistingVaultRecoverySummary()
  state.errorMsg = ''
  state.dismissSuccess()
  log.debug('provider setup started', { type, oauthPreset })
}

export function beginAddProvider(state: ProviderActionsContext) {
  if (!state.isAuthenticated) {
    state.resetVaultSessionState()
  }
  state.addProviderOpen = true
  state.clearLoginSetup()
  state.errorMsg = ''
}

export function cancelAddProvider(state: ProviderActionsContext) {
  resetICloudSignInState(state)
  state.addProviderOpen = false
  state.clearLoginSetup()
  state.clearExistingVaultRecoverySummary()
  state.applyActiveProviderCredentials()
  state.errorMsg = ''
}

export function cancelProviderSetup(state: ProviderActionsContext) {
  resetICloudSignInState(state)
  if (
    state.addProviderOpen &&
    state.loginSetup.kind === LoginSetupKind.Active
  ) {
    const setupType = state.loginSetup.providerType
    state.clearLoginSetup()
    state.githubPat = ''
    state.githubRepo =
      setupType === 'oauth-file'
        ? DEFAULT_DRIVE_BACKUP_NAME
        : DEFAULT_GITHUB_REPO
    state.clearLocalFolder()
    state.clearExistingVaultRecoverySummary()
    state.errorMsg = ''
    return
  }
  state.clearLoginSetup()
  state.clearExistingVaultRecoverySummary()
  state.addProviderOpen = false
  state.applyActiveProviderCredentials()
  state.errorMsg = ''
}

export async function removeProvider(
  state: ProviderActionsContext,
  id: string,
): Promise<void> {
  const target = state.providers.find((p) => p.id === id)
  if (!target || target.type === 'local') return

  await removeLocalFolderHandle(target.localFolder?.handleId)
  state.providers = state.providers.filter((p) => p.id !== id)

  if (state.providers.length === 0 && state.isAuthenticated) {
    state.clearUnlockedSession()
  }

  state.applyActiveProviderCredentials()
  await state.persistProviders({ replace: true })

  log.info('sync provider removed', { id, label: target.label })
  state.showSuccess(state.t('toasts.removed_device', { label: target.label }))
}

export async function ensureProviderSaved(
  state: ProviderActionsContext,
): Promise<boolean> {
  const pat = state.githubPat.trim()
  const repo = state.githubRepo.trim() || DEFAULT_GITHUB_REPO
  const sharedGoogleDrive =
    state.oauthFile?.preset === 'google-drive' &&
    (state.oauthFile.driveMode === 'shared' ||
      Boolean(state.oauthFile.folderId?.trim()))
  const driveFile = sharedGoogleDrive
    ? state.oauthFile?.fileName?.trim() || DEFAULT_DRIVE_BACKUP_NAME
    : state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME
  const type = stagedProviderType(state)
  const isNewSetup = state.loginSetup.kind === LoginSetupKind.Active
  let oauthProviderToUpdate: OAuthProviderUpdate = {
    kind: OAuthProviderUpdateKind.NotRequired,
  }
  const vaultStoreId = await vaultStoreIdForProviderSave(state)
  const oauthPreset =
    state.oauthFile?.preset ?? state.oauthSetupPreset ?? 'google-drive'
  const oauthSnapshot: OAuthFileConfig | void =
    type === 'oauth-file'
      ? {
          preset: oauthPreset,
          accessToken: state.oauthFile?.accessToken ?? '',
          refreshToken: state.oauthFile?.refreshToken,
          expiresAt: state.oauthFile?.expiresAt,
          fileId: state.oauthFile?.fileId,
          folderId: state.oauthFile?.folderId,
          driveMode: state.oauthFile?.driveMode ?? 'private',
          iCloudMode: state.oauthFile?.iCloudMode ?? 'private',
          iCloudShareTarget: state.oauthFile?.iCloudShareTarget,
          accountEmail: state.oauthFile?.accountEmail,
          fileName: driveFile,
        }
      : omittedValue()
  const localFolderSnapshot: LocalFolderConfig | void =
    type === 'local-folder'
      ? {
          directoryName: state.localFolder?.directoryName,
          handleId: state.localFolder?.handleId,
        }
      : omittedValue()

  const isExplicitAdd =
    state.addProviderOpen ||
    (state.isAuthenticated && state.loginSetup.kind === LoginSetupKind.Active)

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
              : omittedValue(),
        oauthPreset,
      ),
      githubPat: type === 'github' ? pat : omittedValue(),
      githubRepo: type === 'github' ? repo : omittedValue(),
      oauthFile: oauthSnapshot,
      localFolder: localFolderSnapshot,
      storeId: vaultStoreId,
      createdAt: isoTimestamp(),
    }
    const duplicateProvider = findDuplicateSyncProvider(
      state.activeVaultProviders,
      provider,
    )
    if (duplicateProvider.kind === DuplicateSyncProviderKind.Duplicate) {
      if (isExplicitAdd) {
        state.errorMsg = state.t('auth_storage.duplicate_sync_provider')
        return false
      }
    } else {
      state.providers = [...state.providers, provider]
      if (provider.type === 'oauth-file') {
        oauthProviderToUpdate = {
          kind: OAuthProviderUpdateKind.Required,
          providerId: provider.id,
        }
      }
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
    const snapshot = ensureLocalProviderRowWasm(
      {
        providers: state.providers,
        activeVaultStoreId: state.activeVaultStoreId,
      } as AuthProvidersSnapshot,
      vaultStoreId,
    )
    state.providers = snapshot.providers
  }

  if (state.storageMode === 'oauth-file' && state.oauthFile?.fileId) {
    const activePreset = state.oauthFile.preset
    if (oauthProviderToUpdate.kind === OAuthProviderUpdateKind.NotRequired) {
      const duplicate = findDuplicateSyncProvider(state.syncProviders, {
        id: 'oauth-provider-update-target',
        type: 'oauth-file',
        label: '',
        oauthFile: state.oauthFile,
        createdAt: '',
      })
      if (duplicate.kind === DuplicateSyncProviderKind.Duplicate) {
        oauthProviderToUpdate = {
          kind: OAuthProviderUpdateKind.Required,
          providerId: duplicate.provider.id,
        }
      }
    }
    const oauthProviderToUpdateId =
      oauthProviderToUpdate.kind === OAuthProviderUpdateKind.Required
        ? oauthProviderToUpdate.providerId
        : omittedValue()
    state.providers = state.providers.map((provider) => {
      if (
        provider.type !== 'oauth-file' ||
        !provider.oauthFile ||
        provider.id !== oauthProviderToUpdateId
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
        folderId: state.oauthFile!.folderId ?? provider.oauthFile.folderId,
        driveMode: state.oauthFile!.driveMode ?? provider.oauthFile.driveMode,
        iCloudMode:
          state.oauthFile!.iCloudMode ?? provider.oauthFile.iCloudMode,
        iCloudShareTarget:
          state.oauthFile!.iCloudShareTarget ??
          provider.oauthFile.iCloudShareTarget,
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
        (provider) => provider.id === oauthProviderToUpdateId,
      )?.oauthFile ?? state.oauthFile
  }

  state.clearLoginSetup()
  state.loginRequiresExistingVault = false
  state.addProviderOpen = false
  state.applyActiveProviderCredentials()
  await state.persistProviders()
  log.info('sync provider saved', { type, explicitAdd: isExplicitAdd })
  return true
}

export async function connectStagedProvider(
  state: ProviderActionsContext,
): Promise<void> {
  if (state.loginSetup.kind === LoginSetupKind.Active) {
    state.storageMode = state.loginSetup.providerType
  }
  if (
    state.isAuthenticated &&
    (state.loginSetup.kind !== LoginSetupKind.Active ||
      state.loginSetup.providerType !== 'local')
  ) {
    await state.connectAndSyncStagedProvider()
    return
  }
  await state.loadDb()
}

export async function discoverStagedVaultStoreId(
  state: ProviderActionsContext,
): Promise<string> {
  if (!state.manager || state.loginSetup.kind !== LoginSetupKind.Active) {
    return ''
  }
  const setupType = state.loginSetup.providerType
  if (state.isVerifying) {
    throw new Error(state.t('auth_storage.sync_failed'))
  }
  state.isVerifying = true
  try {
    const discovery = (async () => {
      if (setupType === 'local-folder') {
        const handleId = state.localFolder?.handleId?.trim() ?? ''
        if (!handleId) return ''
        return await state.enqueueStorage(async () => {
          state.manager!.resetVaultSession()
          await state.manager!.syncLocalFolderProvider(handleId)
          return state.manager!.vaultStoreId.trim()
        })
      }
      const [storageMode, accessToken, remoteRef] =
        state.stagedRemoteStorageArgs() ?? state.wasmStorageArgs()
      return (
        await state.enqueueStorage(() =>
          state.manager!.discoverRemoteVaultStoreId(
            storageMode,
            accessToken,
            remoteRef,
          ),
        )
      ).trim()
    })()
    const timeout = startVaultDiscoveryTimeout(
      state.t('auth_storage.sync_failed'),
      30_000,
    )
    try {
      const storeId = await Promise.race([discovery, timeout.completion])
      if (storeId && state.manager) {
        try {
          state.existingVaultRecoverySummary = await state.enqueueStorage(() =>
            state.manager!.vaultRecoveryOptions(),
          )
        } catch (error) {
          state.clearExistingVaultRecoverySummary()
          log.warn('vault recovery summary unavailable', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return storeId
    } finally {
      timeout.cancel()
    }
  } finally {
    state.isVerifying = false
  }
}

export async function connectAndSyncStagedProvider(
  state: ProviderActionsContext,
): Promise<void> {
  if (!state.manager) return
  if (state.isVerifying) return
  state.isVerifying = true
  const stagedRemoteArgs = state.stagedRemoteStorageArgs()
  try {
    if (stagedRemoteArgs) {
      const accessStatus =
        await state.assessVaultConnectStatus(stagedRemoteArgs)
      if (await state.handleRemoteVaultAssessStatus(accessStatus)) return
    }

    const saved = await state.ensureProviderSaved()
    if (!saved) {
      return
    }
    const provider =
      state.syncProviders[state.syncProviders.length - 1] ??
      state.providers[state.providers.length - 1]
    if (!provider || provider.type === 'local') {
      state.errorMsg = state.t('errors.cloud_sync_provider_required')
      return
    }
    // Push the authenticated local event set first. The WASM boundary guards
    // store identity before writing, so an empty provider is seeded while a
    // different-vault provider still fails closed during the sync below.
    await state.flushRemoteEventOutboxNow(provider)
    await state.syncProviderById(provider.id, {
      quiet: true,
      propagateError: true,
    })
    state.clearLoginSetup()
    state.addProviderOpen = false
  } catch (e: unknown) {
    const assessTimedOut =
      e instanceof Error && e.name === VAULT_ASSESS_TIMEOUT_ERROR_NAME
    const stagedConflict =
      !assessTimedOut && stagedRemoteArgs
        ? await state.stageStagedProviderSyncIssue(stagedRemoteArgs)
        : false
    if (!stagedConflict) {
      state.errorMsg = state.localFolderMultipleVaultsIssue
        ? state.t('auth_storage.local_folder_multiple_vaults_short')
        : e instanceof Error
          ? e.message
          : state.t('auth_storage.sync_failed')
    }
  } finally {
    state.isVerifying = false
  }
}
