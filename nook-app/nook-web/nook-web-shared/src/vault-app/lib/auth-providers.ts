import {
  bindGoogleDriveSharedFolder,
  deleteAuthProvidersDb,
  default as initNookWasm,
  defaultDriveBackupName,
  defaultGithubRepo,
  findDuplicateSyncProvider as findDuplicateSyncProviderWasm,
  formatDriveStorageRef as formatDriveStorageRefCore,
  maskGithubPatHint as maskGithubPatHintCore,
  localizeProviderLabel as localizeProviderLabelCore,
  providerDefaultLabel as providerDefaultLabelCore,
  providerStorageDetail as providerStorageDetailCore,
  sealAuthProvidersForDevicePublicKey,
  setGoogleDriveProviderMode,
  setICloudProviderMode,
  wasmStorageModeForProvider,
  type AuthProvidersSnapshot,
  type LocalFolderConfig,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
  type NookVaultManager,
} from '$app-wasm'

await initNookWasm()

export type {
  AuthProvidersSnapshot,
  GoogleDriveMode,
  ICloudMode,
  LocalFolderConfig,
  OAuthFileConfig,
  OAuthFilePreset,
  StorageProvider,
  StorageProviderType,
} from '$app-wasm'

export {
  bindGoogleDriveSharedFolder,
  deleteAuthProvidersDb,
  sealAuthProvidersForDevicePublicKey,
  setGoogleDriveProviderMode,
  setICloudProviderMode,
  wasmStorageModeForProvider,
}

export enum DriveFileIdentityKind {
  New = 'new',
  Existing = 'existing',
}

export type DriveFileIdentity =
  | { kind: DriveFileIdentityKind.New }
  | { kind: DriveFileIdentityKind.Existing; fileId: string }

export function formatDriveStorageRef(
  identity: DriveFileIdentity,
  fileName: string,
): string {
  const boundary: { fileId?: string } =
    identity.kind === DriveFileIdentityKind.Existing
      ? { fileId: identity.fileId }
      : {}
  return formatDriveStorageRefCore(boundary.fileId, fileName)
}

export const LOCAL_PROVIDER_TYPE = 'local' satisfies StorageProviderType
export const LOCAL_FOLDER_PROVIDER_TYPE =
  'local-folder' satisfies StorageProviderType
export const GITHUB_PROVIDER_TYPE = 'github' satisfies StorageProviderType
export const OAUTH_FILE_PROVIDER_TYPE =
  'oauth-file' satisfies StorageProviderType

export const DEFAULT_GITHUB_REPO = defaultGithubRepo()
export const DEFAULT_DRIVE_BACKUP_NAME = defaultDriveBackupName()

export enum OAuthAccessTokenKind {
  Missing = 'missing',
  Available = 'available',
}

export type OAuthAccessToken =
  | { kind: OAuthAccessTokenKind.Missing }
  | { kind: OAuthAccessTokenKind.Available; token: string }

export function oauthAccessToken(config: OAuthFileConfig): OAuthAccessToken {
  const token = config.accessToken?.trim()
  return token
    ? { kind: OAuthAccessTokenKind.Available, token }
    : { kind: OAuthAccessTokenKind.Missing }
}

export enum OAuthFileNameKind {
  Unresolved = 'unresolved',
  Resolved = 'resolved',
}

export type OAuthFileName =
  | { kind: OAuthFileNameKind.Unresolved }
  | { kind: OAuthFileNameKind.Resolved; fileName: string }

export function oauthFileName(config: OAuthFileConfig): OAuthFileName {
  const fileName = config.fileName?.trim()
  return fileName
    ? { kind: OAuthFileNameKind.Resolved, fileName }
    : { kind: OAuthFileNameKind.Unresolved }
}

export enum LocalFolderHandleKind {
  Unselected = 'unselected',
  Selected = 'selected',
}

export type LocalFolderHandle =
  | { kind: LocalFolderHandleKind.Unselected }
  | { kind: LocalFolderHandleKind.Selected; handleId: string }

export function localFolderHandle(
  config: LocalFolderConfig,
): LocalFolderHandle {
  const handleId = config.handleId?.trim()
  return handleId
    ? { kind: LocalFolderHandleKind.Selected, handleId }
    : { kind: LocalFolderHandleKind.Unselected }
}

export enum OAuthProviderConfigurationKind {
  Missing = 'missing',
  Configured = 'configured',
}

export type OAuthProviderConfiguration =
  | { kind: OAuthProviderConfigurationKind.Missing }
  | {
      kind: OAuthProviderConfigurationKind.Configured
      config: OAuthFileConfig
    }

export function oauthProviderConfiguration(
  provider: StorageProvider,
): OAuthProviderConfiguration {
  return provider.oauthFile
    ? {
        kind: OAuthProviderConfigurationKind.Configured,
        config: provider.oauthFile,
      }
    : { kind: OAuthProviderConfigurationKind.Missing }
}

export enum LocalFolderProviderConfigurationKind {
  Missing = 'missing',
  Configured = 'configured',
}

export type LocalFolderProviderConfiguration =
  | { kind: LocalFolderProviderConfigurationKind.Missing }
  | {
      kind: LocalFolderProviderConfigurationKind.Configured
      config: LocalFolderConfig
    }

export function localFolderProviderConfiguration(
  provider: StorageProvider,
): LocalFolderProviderConfiguration {
  return provider.localFolder
    ? {
        kind: LocalFolderProviderConfigurationKind.Configured,
        config: provider.localFolder,
      }
    : { kind: LocalFolderProviderConfigurationKind.Missing }
}

export enum DuplicateSyncProviderKind {
  Duplicate = 'duplicate',
  Unique = 'unique',
}

export type DuplicateSyncProvider =
  | { kind: DuplicateSyncProviderKind.Duplicate; provider: StorageProvider }
  | { kind: DuplicateSyncProviderKind.Unique }

export function findDuplicateSyncProvider(
  providers: StorageProvider[],
  candidate: StorageProvider,
  options?: { excludeId?: string },
): DuplicateSyncProvider {
  const provider = findDuplicateSyncProviderWasm(
    { providers },
    candidate,
    options?.excludeId,
  )
  return provider
    ? { kind: DuplicateSyncProviderKind.Duplicate, provider }
    : { kind: DuplicateSyncProviderKind.Unique }
}

export async function saveAuthProviders(
  manager: NookVaultManager,
  snapshot: AuthProvidersSnapshot,
): Promise<void> {
  await manager.saveAuthProviders(snapshot)
}

export function providerDefaultLabel(
  type: StorageProviderType,
  options: {
    detail?: string
    oauthPreset?: OAuthFilePreset
  } = {},
): string {
  return providerDefaultLabelCore(
    type,
    options.detail,
    options.oauthPreset ?? 'google-drive',
  )
}

export function localizeProviderLabel(
  label: string,
  t: (key: string) => string,
): string {
  return localizeProviderLabelCore(
    label,
    t('provider_picker.this_device'),
    t('provider_picker.github'),
    t('provider_picker.local_folder'),
    t('provider_picker.google_drive'),
    t('provider_picker.icloud'),
  )
}

/** Safe PAT hint for provider lists — never shows the full token. */
export enum GithubPatDisplayKind {
  NoToken = 'no-token',
  Stored = 'stored',
}

export type GithubPatDisplay =
  | { kind: GithubPatDisplayKind.NoToken }
  | { kind: GithubPatDisplayKind.Stored; pat: string }

export function maskGithubPat(
  state: GithubPatDisplay,
  t?: (key: string) => string,
): string {
  const boundary: { pat?: string } =
    state.kind === GithubPatDisplayKind.Stored ? { pat: state.pat } : {}
  const hint = maskGithubPatHintCore(boundary.pat)
  if (!hint) {
    return t ? t('auth_storage.no_token_saved') : 'No token saved'
  }
  return hint
}

/** Secondary line for provider rows in management / picker UIs. */
export function providerStorageDetail(
  provider: StorageProvider,
  t?: (key: string) => string,
): string {
  return providerStorageDetailCore(
    provider,
    t
      ? t('provider_picker.this_device_desc')
      : 'Vault in browser storage on this device',
    t ? t('auth_storage.no_token_saved') : 'No token saved',
    t ? t('auth_storage.google_signed_in') : 'Signed in with Google',
    t ? t('auth_storage.icloud_signed_in') : 'Signed in with iCloud',
    t ? t('auth_storage.google_not_signed_in') : 'Not signed in',
    t ? t('auth_storage.icloud_not_signed_in') : 'Not signed in with iCloud',
    t ? t('auth_storage.local_folder_needs_reconnect') : 'Choose folder',
  )
}
