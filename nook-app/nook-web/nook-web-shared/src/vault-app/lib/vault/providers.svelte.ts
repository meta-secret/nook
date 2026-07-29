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
  stagedConfiguredOauthProviderLabel,
  stagedGithubProviderLabel,
  stagedLocalProviderLabel,
  stagedRemoteStorageArgs as stagedRemoteStorageArgsCore,
  stagedUnconfiguredOauthProviderLabel,
  syncProvidersForActiveVault,
  updateOauthRemoteRef,
  wasmStorageArgs as wasmStorageArgsCore,
  type NookStorageConnectArgs,
} from '$app-wasm'
import { LocalFolderHealthKind } from '$lib/vault/state/sync.svelte'
import { createLogger } from '$lib/log'
import {
  ActiveVaultKind,
  LocalFolderDraftKind,
  LocalProviderLookupKind,
  LoginVaultSelectionKind,
  LoginSetupKind,
  OAuthFileDraftKind,
  OAuthSetupPresetKind,
  StagedRemoteStorageKind,
  type LocalProviderLookup,
  type StagedRemoteStorage,
} from '$lib/vault/state/provider.svelte'
enum OAuthProviderUpdateKind {
  NotRequired = 'not-required',
  Required = 'required',
}

type OAuthProviderUpdate =
  | { kind: OAuthProviderUpdateKind.NotRequired }
  | { kind: OAuthProviderUpdateKind.Required; providerId: string }

enum ProviderSaveStoreIdKind {
  Unavailable = 'unavailable',
  Available = 'available',
}

type ProviderSaveStoreId =
  | { kind: ProviderSaveStoreIdKind.Unavailable }
  | { kind: ProviderSaveStoreIdKind.Available; storeId: string }

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
    ...(state.activeVault.kind === ActiveVaultKind.Open
      ? { activeVaultStoreId: state.activeVault.storeId }
      : {}),
  })
}

export function wasmStorageArgs(
  state: ProviderActionsContext,
): [string, string, string] {
  const syncProvider = syncProviders(state)[0]
  const oauthFileDraft = state.oauthFileDraft
  const boundary = {
    ...(syncProvider ? { syncProvider: $state.snapshot(syncProvider) } : {}),
    ...(oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? {
          oauthRemoteRef: oauthRemoteStorageRef(
            $state.snapshot(oauthFileDraft.config),
          ),
          oauthPreset: oauthFileDraft.config.preset,
          oauthAccessToken: oauthFileDraft.config.accessToken,
          oauthFileName: oauthFileDraft.config.fileName,
        }
      : {}),
  }
  return takeStorageArgsTuple(
    wasmStorageArgsCore(
      state.localVaultPresent,
      state.isAuthenticated,
      boundary.syncProvider,
      state.storageMode,
      state.githubPat,
      state.githubRepo,
      boundary.oauthPreset,
      boundary.oauthAccessToken,
      boundary.oauthRemoteRef,
      boundary.oauthFileName,
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
): StagedRemoteStorage {
  const type = stagedProviderType(state)
  const boundary = {
    ...(state.githubPat ? { githubPat: state.githubPat } : {}),
    ...(state.githubRepo ? { githubRepo: state.githubRepo } : {}),
    ...(state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? { oauthFile: $state.snapshot(state.oauthFileDraft.config) }
      : {}),
  }
  const args = stagedRemoteStorageArgsCore(
    type,
    boundary.githubPat,
    boundary.githubRepo,
    boundary.oauthFile,
  )
  return args
    ? {
        kind: StagedRemoteStorageKind.Available,
        args: takeStorageArgsTuple(args),
      }
    : { kind: StagedRemoteStorageKind.Unavailable }
}

export function stagedProviderLabel(state: ProviderActionsContext): string {
  const providerType = stagedProviderType(state)
  if (providerType === 'github') {
    return stagedGithubProviderLabel(state.githubRepo)
  }
  if (providerType === 'oauth-file') {
    if (state.oauthFileDraft.kind === OAuthFileDraftKind.Configured) {
      const oauthFile = state.oauthFileDraft.config
      return stagedConfiguredOauthProviderLabel(
        oauthFile.fileName,
        oauthFile.preset,
      )
    }
    return state.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
      ? stagedConfiguredOauthProviderLabel('', state.oauthSetupSelection.preset)
      : stagedUnconfiguredOauthProviderLabel()
  }
  return stagedLocalProviderLabel(providerType)
}

export function hasRemoteProviderCredentials(
  state: ProviderActionsContext,
): boolean {
  return hasRemoteCredentials(
    state.storageMode,
    state.githubPat,
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? state.oauthFileDraft.config.accessToken
      : '',
    state.localFolderDraft.kind === LocalFolderDraftKind.Configured
      ? state.localFolderDraft.config.handleId
      : '',
  )
}

export function syncOAuthRemoteRefFromManager(
  state: ProviderActionsContext,
): void {
  if (
    state.storageMode !== OAUTH_FILE_PROVIDER_TYPE ||
    !state.hasManager ||
    state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured
  ) {
    return
  }
  const updated = updateOauthRemoteRef(
    $state.snapshot(state.oauthFileDraft.config),
    state.requireManager().storage_remote_ref ?? '',
  )
  if (updated) state.configureOauthFile(updated)
}

export async function chooseLocalFolder(
  state: ProviderActionsContext,
): Promise<void> {
  refreshLocalFolderBackupSupport(state)
  if (!state.localFolderBackupSupported) {
    throw new Error(state.t('provider_setup.local_folder_unsupported_browser'))
  }
  const folder = await chooseLocalFolderBackupDirectory()
  state.configureLocalFolder({
    directoryName: folder.directoryName,
    handleId: folder.handleId,
  })
}

export function refreshLocalFolderBackupSupport(
  state: ProviderActionsContext,
): void {
  state.localFolderBackupSupported =
    'window' in globalThis && isLocalFolderBackupSupported()
}

export function localProvider(
  state: ProviderActionsContext,
): LocalProviderLookup {
  const id = state.hasActiveVaultStore
    ? localProviderIdForActiveVault(
        providerSnapshot(state),
        state.requireActiveVaultStoreId(),
      )
    : localProviderIdForActiveVault(providerSnapshot(state))
  const provider = id
    ? state.providers.find((candidate) => candidate.id === id)
    : false
  return provider
    ? { kind: LocalProviderLookupKind.Found, provider }
    : { kind: LocalProviderLookupKind.Missing }
}

export function activeProviders(
  state: ProviderActionsContext,
): StorageProvider[] {
  return (
    state.hasActiveVaultStore
      ? activeVaultProviders(
          providerSnapshot(state),
          state.requireActiveVaultStoreId(),
        )
      : activeVaultProviders(providerSnapshot(state))
  ).providers
}

export function syncProviders(
  state: ProviderActionsContext,
): StorageProvider[] {
  return (
    state.hasActiveVaultStore
      ? syncProvidersForActiveVault(
          providerSnapshot(state),
          state.requireActiveVaultStoreId(),
        )
      : syncProvidersForActiveVault(providerSnapshot(state))
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
  if (!state.hasManager) throw new Error(state.t('errors.engine_unavailable'))
  const manager = state.requireManager()
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
): Promise<ProviderSaveStoreId> {
  const fromManager = state.hasManager
    ? (
        await state.enqueueStorage(() => state.requireManager().vaultStoreId)
      ).trim()
    : ''
  if (fromManager) {
    return { kind: ProviderSaveStoreIdKind.Available, storeId: fromManager }
  }
  if (state.activeVault.kind === ActiveVaultKind.Open) {
    return {
      kind: ProviderSaveStoreIdKind.Available,
      storeId: state.activeVault.storeId,
    }
  }
  return state.selectedLoginVault.kind === LoginVaultSelectionKind.Selected
    ? {
        kind: ProviderSaveStoreIdKind.Available,
        storeId: state.selectedLoginVault.storeId,
      }
    : { kind: ProviderSaveStoreIdKind.Unavailable }
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
      ? state.requireManager().loadAuthProvidersWithLocalRow()
      : state.requireManager().loadAuthProviders(),
  )
  state.providers = snapshot.providers.map((p) =>
    p.label === 'GitHub sync' ? { ...p, label: 'GitHub' } : p,
  )
  if (snapshot.activeVaultStoreId) {
    state.openActiveVault(snapshot.activeVaultStoreId)
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
  const snapshot = await state
    .requireManager()
    .ensureLocalAuthProviderSnapshot({
      providers: state.providers,
    })
  if (snapshot.providers.length !== state.providers.length) {
    state.providers = snapshot.providers
    await state.enqueueStorage(() =>
      saveAuthProviders(state.requireManager(), snapshot),
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
    state.configureOauthFile(syncProvider.oauthFile)
    state.clearLocalFolder()
    state.githubRepo =
      syncProvider.oauthFile?.fileName?.trim() || DEFAULT_DRIVE_BACKUP_NAME
  } else if (syncProvider.type === 'local-folder') {
    state.configureLocalFolder(syncProvider.localFolder)
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
      state.requireManager().loadAuthProviders(),
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
    saveAuthProviders(state.requireManager(), {
      providers: state.providers,
      ...(state.hasActiveVaultStore
        ? { activeVaultStoreId: state.requireActiveVaultStoreId() }
        : {}),
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
    state.selectOauthSetupPreset(preset)
    state.configureOauthFile({
      preset,
      accessToken: '',
      fileName: DEFAULT_DRIVE_BACKUP_NAME,
      driveMode: 'private',
      iCloudMode: 'private',
    })
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
  const oauthFileDraft = state.oauthFileDraft
  const sharedGoogleDrive =
    oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
    oauthFileDraft.config.preset === 'google-drive' &&
    (oauthFileDraft.config.driveMode === 'shared' ||
      Boolean(oauthFileDraft.config.folderId?.trim()))
  const driveFile = sharedGoogleDrive
    ? oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? oauthFileDraft.config.fileName?.trim() || DEFAULT_DRIVE_BACKUP_NAME
      : DEFAULT_DRIVE_BACKUP_NAME
    : state.githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME
  const type = stagedProviderType(state)
  const isNewSetup = state.loginSetup.kind === LoginSetupKind.Active
  let oauthProviderToUpdate: OAuthProviderUpdate = {
    kind: OAuthProviderUpdateKind.NotRequired,
  }
  const vaultStoreId = await vaultStoreIdForProviderSave(state)
  const providerStoreFields: { storeId?: string } =
    vaultStoreId.kind === ProviderSaveStoreIdKind.Available
      ? { storeId: vaultStoreId.storeId }
      : {}
  const oauthPreset =
    oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? oauthFileDraft.config.preset
      : state.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
        ? state.oauthSetupSelection.preset
        : 'google-drive'

  const isExplicitAdd =
    state.addProviderOpen ||
    (state.isAuthenticated && state.loginSetup.kind === LoginSetupKind.Active)

  if (isNewSetup && type !== 'local') {
    let provider: StorageProvider
    if (type === 'github') {
      provider = {
        id: generateId(),
        type,
        label: providerDefaultLabel(type, {
          detail: repo,
          oauthPreset,
        }),
        githubPat: pat,
        githubRepo: repo,
        ...providerStoreFields,
        createdAt: isoTimestamp(),
      }
    } else if (type === 'oauth-file') {
      const oauthFile: OAuthFileConfig = {
        ...(oauthFileDraft.kind === OAuthFileDraftKind.Configured
          ? oauthFileDraft.config
          : {}),
        preset: oauthPreset,
        accessToken:
          oauthFileDraft.kind === OAuthFileDraftKind.Configured
            ? oauthFileDraft.config.accessToken
            : '',
        driveMode:
          oauthFileDraft.kind === OAuthFileDraftKind.Configured
            ? (oauthFileDraft.config.driveMode ?? 'private')
            : 'private',
        iCloudMode:
          oauthFileDraft.kind === OAuthFileDraftKind.Configured
            ? (oauthFileDraft.config.iCloudMode ?? 'private')
            : 'private',
        fileName: driveFile,
      }
      provider = {
        id: generateId(),
        type,
        label: providerDefaultLabel(type, {
          detail: driveFile,
          oauthPreset,
        }),
        oauthFile,
        ...providerStoreFields,
        createdAt: isoTimestamp(),
      }
    } else {
      if (state.localFolderDraft.kind !== LocalFolderDraftKind.Configured) {
        state.errorMsg = state.t('auth_storage.local_folder_choose_err')
        return false
      }
      const localFolder: LocalFolderConfig = state.localFolderDraft.config
      provider = {
        id: generateId(),
        type,
        label: providerDefaultLabel(type, {
          detail: localFolder.directoryName,
          oauthPreset,
        }),
        localFolder,
        ...providerStoreFields,
        createdAt: isoTimestamp(),
      }
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
  } else if (
    isNewSetup &&
    type === 'local' &&
    state.localProvider.kind === LocalProviderLookupKind.Missing
  ) {
    const provider: StorageProvider = {
      id: generateId(),
      type: 'local',
      label: providerDefaultLabel('local'),
      ...providerStoreFields,
      createdAt: isoTimestamp(),
    }
    state.providers = [...state.providers, provider]
  } else if (state.localProvider.kind === LocalProviderLookupKind.Found) {
    const localProviderId = state.localProvider.provider.id
    state.providers = state.providers.map((provider) =>
      provider.id === localProviderId
        ? {
            ...provider,
            ...providerStoreFields,
          }
        : provider,
    )
  } else {
    const snapshot = ensureLocalProviderRowWasm(
      {
        providers: state.providers,
        activeVaultStoreId: state.requireActiveVaultStoreId(),
      } as AuthProvidersSnapshot,
      providerStoreFields.storeId,
    )
    state.providers = snapshot.providers
  }

  if (
    state.storageMode === 'oauth-file' &&
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
    state.oauthFileDraft.config.fileId
  ) {
    const activeOauthFile = state.oauthFileDraft.config
    const activePreset = activeOauthFile.preset
    if (oauthProviderToUpdate.kind === OAuthProviderUpdateKind.NotRequired) {
      const duplicate = findDuplicateSyncProvider(state.syncProviders, {
        id: 'oauth-provider-update-target',
        type: 'oauth-file',
        label: '',
        oauthFile: activeOauthFile,
        createdAt: '',
      })
      if (duplicate.kind === DuplicateSyncProviderKind.Duplicate) {
        oauthProviderToUpdate = {
          kind: OAuthProviderUpdateKind.Required,
          providerId: duplicate.provider.id,
        }
      }
    }
    if (oauthProviderToUpdate.kind === OAuthProviderUpdateKind.Required) {
      const oauthProviderToUpdateId = oauthProviderToUpdate.providerId
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
            activeOauthFile.accessToken || provider.oauthFile.accessToken,
          refreshToken: provider.oauthFile.refreshToken,
          expiresAt: provider.oauthFile.expiresAt ?? activeOauthFile.expiresAt,
          fileId: activeOauthFile.fileId,
          folderId: activeOauthFile.folderId ?? provider.oauthFile.folderId,
          driveMode: activeOauthFile.driveMode ?? provider.oauthFile.driveMode,
          iCloudMode:
            activeOauthFile.iCloudMode ?? provider.oauthFile.iCloudMode,
          iCloudShareTarget:
            activeOauthFile.iCloudShareTarget ??
            provider.oauthFile.iCloudShareTarget,
          fileName:
            provider.oauthFile.fileName?.trim() ||
            activeOauthFile.fileName?.trim() ||
            driveFile,
          accountEmail:
            provider.oauthFile.accountEmail ?? activeOauthFile.accountEmail,
        }
        return { ...provider, oauthFile: merged }
      })
      state.configureOauthFile(
        state.providers.find(
          (provider) => provider.id === oauthProviderToUpdateId,
        )?.oauthFile ?? activeOauthFile,
      )
    }
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
  if (!state.hasManager || state.loginSetup.kind !== LoginSetupKind.Active) {
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
        const handleId =
          state.localFolderDraft.kind === LocalFolderDraftKind.Configured
            ? (state.localFolderDraft.config.handleId?.trim() ?? '')
            : ''
        if (!handleId) return ''
        return await state.enqueueStorage(async () => {
          state.requireManager().resetVaultSession()
          await state.requireManager().syncLocalFolderProvider(handleId)
          return state.requireManager().vaultStoreId.trim()
        })
      }
      const stagedStorage = state.stagedRemoteStorageArgs()
      const [storageMode, accessToken, remoteRef] =
        stagedStorage.kind === StagedRemoteStorageKind.Available
          ? stagedStorage.args
          : state.wasmStorageArgs()
      return (
        await state.enqueueStorage(() =>
          state
            .requireManager()
            .discoverRemoteVaultStoreId(storageMode, accessToken, remoteRef),
        )
      ).trim()
    })()
    const timeout = startVaultDiscoveryTimeout(
      state.t('auth_storage.sync_failed'),
      30_000,
    )
    try {
      const storeId = await Promise.race([discovery, timeout.completion])
      if (storeId && state.hasManager) {
        try {
          state.recordExistingVaultRecovery(
            await state.enqueueStorage(() =>
              state.requireManager().vaultRecoveryOptions(),
            ),
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
  if (!state.hasManager) return
  if (state.isVerifying) return
  state.isVerifying = true
  const stagedRemoteArgs = state.stagedRemoteStorageArgs()
  try {
    if (stagedRemoteArgs.kind === StagedRemoteStorageKind.Available) {
      const accessStatus = await state.assessVaultConnectStatus(
        stagedRemoteArgs.args,
      )
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
      !assessTimedOut &&
      stagedRemoteArgs.kind === StagedRemoteStorageKind.Available
        ? await state.stageStagedProviderSyncIssue(stagedRemoteArgs.args)
        : false
    if (!stagedConflict) {
      state.errorMsg =
        state.localFolderHealth.kind === LocalFolderHealthKind.MultipleVaults
          ? state.t('auth_storage.local_folder_multiple_vaults_short')
          : e instanceof Error
            ? e.message
            : state.t('auth_storage.sync_failed')
    }
  } finally {
    state.isVerifying = false
  }
}
