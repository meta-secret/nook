import {
  bindGoogleDriveSharedFolder,
  deleteAuthProvidersDb,
  default as initNookWasm,
  defaultDriveBackupName,
  defaultGithubRepo,
  findDuplicateSyncProvider as findDuplicateSyncProviderWasm,
  findDuplicateSyncProviderExcluding as findDuplicateSyncProviderExcludingWasm,
  formatDriveStorageRef as formatDriveStorageRefCore,
  formatNewDriveStorageRef,
  maskGithubPatHint as maskGithubPatHintCore,
  localizeProviderLabel as localizeProviderLabelCore,
  providerDefaultLabel as providerDefaultLabelCore,
  providerDefaultLabelWithoutDetail,
  providerStorageDetail as providerStorageDetailCore,
  sealAuthProvidersForDevicePublicKey,
  setGoogleDriveProviderMode,
  setICloudProviderMode,
  wasmStorageModeForProvider,
  NookDuplicateSyncProviderState,
  type AuthProvidersSnapshot,
  type ActiveVaultScope,
  type LocalFolderConfig,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
  type StoredGithubPat,
  type StoredGithubRepository,
  type StoredGoogleDriveFolder,
  type StoredICloudShareTarget,
  type StoredLocalFolderConfiguration,
  type StoredLocalFolderDirectory,
  type StoredLocalFolderHandle,
  type StoredOAuthAccessCredential,
  type StoredOAuthAccountIdentity,
  type StoredOAuthFileConfiguration,
  type StoredOAuthRefreshCredential,
  type StoredOAuthRemoteFileId,
  type StoredOAuthRemoteFileName,
  type StoredOAuthTokenExpiry,
  type ProviderVaultScope,
  NookGithubPatHintState,
  type NookVaultManager,
} from "$app-wasm";

await initNookWasm();

export type {
  AuthProvidersSnapshot,
  ActiveVaultScope,
  GoogleDriveMode,
  ICloudMode,
  LocalFolderConfig,
  OAuthFileConfig,
  OAuthFilePreset,
  StorageProvider,
  StorageProviderType,
  StoredGithubPat,
  StoredGithubRepository,
  StoredGoogleDriveFolder,
  StoredICloudShareTarget,
  StoredLocalFolderConfiguration,
  StoredLocalFolderDirectory,
  StoredLocalFolderHandle,
  StoredOAuthAccessCredential,
  StoredOAuthAccountIdentity,
  StoredOAuthFileConfiguration,
  StoredOAuthRefreshCredential,
  StoredOAuthRemoteFileId,
  StoredOAuthRemoteFileName,
  StoredOAuthTokenExpiry,
  ProviderVaultScope,
} from "$app-wasm";

export {
  bindGoogleDriveSharedFolder,
  deleteAuthProvidersDb,
  sealAuthProvidersForDevicePublicKey,
  setGoogleDriveProviderMode,
  setICloudProviderMode,
  wasmStorageModeForProvider,
};

export enum DriveFileIdentityKind {
  New = "new",
  Existing = "existing",
}

export type DriveFileIdentity =
  | { kind: DriveFileIdentityKind.New }
  | { kind: DriveFileIdentityKind.Existing; fileId: string };

export function formatDriveStorageRef(
  identity: DriveFileIdentity,
  fileName: string,
): string {
  return identity.kind === DriveFileIdentityKind.Existing
    ? formatDriveStorageRefCore(identity.fileId, fileName)
    : formatNewDriveStorageRef(fileName);
}

export const LOCAL_PROVIDER_TYPE = "local" satisfies StorageProviderType;
export const LOCAL_FOLDER_PROVIDER_TYPE =
  "local-folder" satisfies StorageProviderType;
export const GITHUB_PROVIDER_TYPE = "github" satisfies StorageProviderType;
export const OAUTH_FILE_PROVIDER_TYPE =
  "oauth-file" satisfies StorageProviderType;

export const DEFAULT_GITHUB_REPO = defaultGithubRepo();
export const DEFAULT_DRIVE_BACKUP_NAME = defaultDriveBackupName();

export function unselectedVaultScope(): ActiveVaultScope {
  return { state: "unselected" };
}

export function activeVaultScope(storeId: string): ActiveVaultScope {
  return { state: "storeId", value: storeId };
}

export function unscopedProviderVault(): ProviderVaultScope {
  return { state: "unscoped" };
}

export function scopedProviderVault(storeId: string): ProviderVaultScope {
  return { state: "storeId", value: storeId };
}

export function providerBelongsToVault(
  provider: StorageProvider,
  storeId: string,
): boolean {
  return (
    provider.storeId.state === "unscoped" || provider.storeId.value === storeId
  );
}

export function missingGithubPat(): StoredGithubPat {
  return { state: "missing" };
}

export function storedGithubPat(token: string): StoredGithubPat {
  return { state: "token", value: token };
}

export function githubPatValue(pat: StoredGithubPat): string {
  return pat.state === "token" ? pat.value.trim() : "";
}

export function defaultGithubRepository(): StoredGithubRepository {
  return { state: "defaultRepository" };
}

export function storedGithubRepository(
  repository: string,
): StoredGithubRepository {
  return { state: "repository", value: repository };
}

export function githubRepositoryValue(
  repository: StoredGithubRepository,
): string {
  return repository.state === "repository" ? repository.value.trim() : "";
}

export function signedOutOAuthCredential(): StoredOAuthAccessCredential {
  return { state: "signedOut" };
}

export function storedOAuthCredential(
  accessToken: string,
): StoredOAuthAccessCredential {
  return { state: "accessToken", value: accessToken };
}

export function oauthRefreshCredentialNotIssued(): StoredOAuthRefreshCredential {
  return { state: "notIssued" };
}

export function storedOAuthRefreshCredential(
  refreshToken: string,
): StoredOAuthRefreshCredential {
  return { state: "token", value: refreshToken };
}

export function unknownOAuthTokenExpiry(): StoredOAuthTokenExpiry {
  return { state: "unknown" };
}

export function storedOAuthTokenExpiry(
  expiresAt: string,
): StoredOAuthTokenExpiry {
  return { state: "expiresAt", value: expiresAt };
}

export function unresolvedOAuthRemoteFileId(): StoredOAuthRemoteFileId {
  return { state: "unresolved" };
}

export function storedOAuthRemoteFileId(
  fileId: string,
): StoredOAuthRemoteFileId {
  return { state: "fileId", value: fileId };
}

export function unresolvedOAuthRemoteFileName(): StoredOAuthRemoteFileName {
  return { state: "unresolved" };
}

export function storedOAuthRemoteFileName(
  fileName: string,
): StoredOAuthRemoteFileName {
  return { state: "fileName", value: fileName };
}

export function unknownOAuthAccountIdentity(): StoredOAuthAccountIdentity {
  return { state: "unknown" };
}

export function storedOAuthAccountEmail(
  email: string,
): StoredOAuthAccountIdentity {
  return { state: "email", value: email };
}

export function rootGoogleDriveFolder(): StoredGoogleDriveFolder {
  return { state: "root" };
}

export function storedGoogleDriveFolder(
  folderId: string,
): StoredGoogleDriveFolder {
  return { state: "folderId", value: folderId };
}

export function personalICloudShareTarget(): StoredICloudShareTarget {
  return { state: "personal" };
}

export function storedICloudShareTarget(
  storageTargetId: string,
): StoredICloudShareTarget {
  return { state: "sharedTarget", value: storageTargetId };
}

export function oauthConfigurationNotApplicable(): StoredOAuthFileConfiguration {
  return { state: "notApplicable" };
}

export function configuredOAuthFile(
  config: OAuthFileConfig,
): StoredOAuthFileConfiguration {
  return { state: "configured", config };
}

export function localFolderConfigurationNotApplicable(): StoredLocalFolderConfiguration {
  return { state: "notApplicable" };
}

export function configuredLocalFolder(
  config: LocalFolderConfig,
): StoredLocalFolderConfiguration {
  return { state: "configured", config };
}

export function unnamedLocalFolderDirectory(): StoredLocalFolderDirectory {
  return { state: "unnamed" };
}

export function storedLocalFolderDirectory(
  directoryName: string,
): StoredLocalFolderDirectory {
  return { state: "directoryName", value: directoryName };
}

export function localFolderDirectoryValue(
  directory: StoredLocalFolderDirectory,
): string {
  return directory.state === "directoryName" ? directory.value.trim() : "";
}

export function unboundLocalFolderHandle(): StoredLocalFolderHandle {
  return { state: "unbound" };
}

export function storedLocalFolderHandle(
  handleId: string,
): StoredLocalFolderHandle {
  return { state: "handleId", value: handleId };
}

export function defaultOAuthFileConfig(
  preset: OAuthFilePreset,
  fileName = DEFAULT_DRIVE_BACKUP_NAME,
): OAuthFileConfig {
  return {
    preset,
    accessToken: signedOutOAuthCredential(),
    refreshToken: oauthRefreshCredentialNotIssued(),
    expiresAt: unknownOAuthTokenExpiry(),
    fileId: unresolvedOAuthRemoteFileId(),
    fileName: storedOAuthRemoteFileName(fileName),
    accountEmail: unknownOAuthAccountIdentity(),
    driveMode: "private",
    folderId: rootGoogleDriveFolder(),
    iCloudMode: "private",
    iCloudShareTarget: personalICloudShareTarget(),
  };
}

export function providerPersistenceDefaults(): Pick<
  StorageProvider,
  "githubPat" | "githubRepo" | "oauthFile" | "localFolder" | "storeId"
> {
  return {
    githubPat: missingGithubPat(),
    githubRepo: defaultGithubRepository(),
    oauthFile: oauthConfigurationNotApplicable(),
    localFolder: localFolderConfigurationNotApplicable(),
    storeId: unscopedProviderVault(),
  };
}

export enum OAuthAccessTokenKind {
  Missing = "missing",
  Available = "available",
}

export type OAuthAccessToken =
  | { kind: OAuthAccessTokenKind.Missing }
  | { kind: OAuthAccessTokenKind.Available; token: string };

export function oauthAccessToken(config: OAuthFileConfig): OAuthAccessToken {
  const token =
    config.accessToken.state === "accessToken"
      ? config.accessToken.value.trim()
      : "";
  return token.length > 0
    ? { kind: OAuthAccessTokenKind.Available, token }
    : { kind: OAuthAccessTokenKind.Missing };
}

export enum OAuthFileNameKind {
  Unresolved = "unresolved",
  Resolved = "resolved",
}

export type OAuthFileName =
  | { kind: OAuthFileNameKind.Unresolved }
  | { kind: OAuthFileNameKind.Resolved; fileName: string };

export function oauthFileName(config: OAuthFileConfig): OAuthFileName {
  const fileName =
    config.fileName.state === "fileName" ? config.fileName.value.trim() : "";
  return fileName.length > 0
    ? { kind: OAuthFileNameKind.Resolved, fileName }
    : { kind: OAuthFileNameKind.Unresolved };
}

export enum LocalFolderHandleKind {
  Unselected = "unselected",
  Selected = "selected",
}

export type LocalFolderHandle =
  | { kind: LocalFolderHandleKind.Unselected }
  | { kind: LocalFolderHandleKind.Selected; handleId: string };

export function localFolderHandle(
  config: LocalFolderConfig,
): LocalFolderHandle {
  const handleId =
    config.handleId.state === "handleId" ? config.handleId.value.trim() : "";
  return handleId.length > 0
    ? { kind: LocalFolderHandleKind.Selected, handleId }
    : { kind: LocalFolderHandleKind.Unselected };
}

export enum OAuthProviderConfigurationKind {
  Missing = "missing",
  Configured = "configured",
}

export type OAuthProviderConfiguration =
  | { kind: OAuthProviderConfigurationKind.Missing }
  | {
      kind: OAuthProviderConfigurationKind.Configured;
      config: OAuthFileConfig;
    };

export function oauthProviderConfiguration(
  provider: StorageProvider,
): OAuthProviderConfiguration {
  return provider.oauthFile.state === "configured"
    ? {
        kind: OAuthProviderConfigurationKind.Configured,
        config: provider.oauthFile.config,
      }
    : { kind: OAuthProviderConfigurationKind.Missing };
}

export enum LocalFolderProviderConfigurationKind {
  Missing = "missing",
  Configured = "configured",
}

export type LocalFolderProviderConfiguration =
  | { kind: LocalFolderProviderConfigurationKind.Missing }
  | {
      kind: LocalFolderProviderConfigurationKind.Configured;
      config: LocalFolderConfig;
    };

export function localFolderProviderConfiguration(
  provider: StorageProvider,
): LocalFolderProviderConfiguration {
  return provider.localFolder.state === "configured"
    ? {
        kind: LocalFolderProviderConfigurationKind.Configured,
        config: provider.localFolder.config,
      }
    : { kind: LocalFolderProviderConfigurationKind.Missing };
}

export enum DuplicateSyncProviderKind {
  Duplicate = "duplicate",
  Unique = "unique",
}

export type DuplicateSyncProvider =
  | { kind: DuplicateSyncProviderKind.Duplicate; provider: StorageProvider }
  | { kind: DuplicateSyncProviderKind.Unique };

export function findDuplicateSyncProvider(
  providers: StorageProvider[],
  candidate: StorageProvider,
): DuplicateSyncProvider {
  const result = findDuplicateSyncProviderWasm(
    { providers, activeVaultStoreId: unselectedVaultScope() },
    candidate,
  );
  return result.state === NookDuplicateSyncProviderState.Duplicate
    ? {
        kind: DuplicateSyncProviderKind.Duplicate,
        provider: result.provider,
      }
    : { kind: DuplicateSyncProviderKind.Unique };
}

export function findDuplicateSyncProviderExcluding(
  providers: StorageProvider[],
  candidate: StorageProvider,
  excludeId: string,
): DuplicateSyncProvider {
  const result = findDuplicateSyncProviderExcludingWasm(
    { providers, activeVaultStoreId: unselectedVaultScope() },
    candidate,
    excludeId,
  );
  return result.state === NookDuplicateSyncProviderState.Duplicate
    ? {
        kind: DuplicateSyncProviderKind.Duplicate,
        provider: result.provider,
      }
    : { kind: DuplicateSyncProviderKind.Unique };
}

export async function saveAuthProviders(
  manager: NookVaultManager,
  snapshot: AuthProvidersSnapshot,
): Promise<void> {
  await manager.saveAuthProviders(snapshot);
}

export function providerDefaultLabel(
  type: StorageProviderType,
  options: {
    detail?: string;
    oauthPreset?: OAuthFilePreset;
  } = {},
): string {
  const oauthPreset = options.oauthPreset ?? "google-drive";
  return typeof options.detail === "string"
    ? providerDefaultLabelCore(type, options.detail, oauthPreset)
    : providerDefaultLabelWithoutDetail(type, oauthPreset);
}

export function localizeProviderLabel(
  label: string,
  t: (key: string) => string,
): string {
  return localizeProviderLabelCore(
    label,
    t("provider_picker.this_device"),
    t("provider_picker.github"),
    t("provider_picker.local_folder"),
    t("provider_picker.google_drive"),
    t("provider_picker.icloud"),
  );
}

/** Safe PAT hint for provider lists — never shows the full token. */
export enum GithubPatDisplayKind {
  NoToken = "no-token",
  Stored = "stored",
}

export type GithubPatDisplay =
  | { kind: GithubPatDisplayKind.NoToken }
  | { kind: GithubPatDisplayKind.Stored; pat: string };

export function maskGithubPat(
  state: GithubPatDisplay,
  t?: (key: string) => string,
): string {
  const hint = maskGithubPatHintCore(
    state.kind === GithubPatDisplayKind.Stored
      ? storedGithubPat(state.pat)
      : missingGithubPat(),
  );
  try {
    if (hint.state === NookGithubPatHintState.Missing) {
      return t ? t("auth_storage.no_token_saved") : "No token saved";
    }
    return hint.value;
  } finally {
    hint.free();
  }
}

/** Secondary line for provider rows in management / picker UIs. */
export function providerStorageDetail(
  provider: StorageProvider,
  t?: (key: string) => string,
): string {
  return providerStorageDetailCore(
    provider,
    t
      ? t("provider_picker.this_device_desc")
      : "Vault in browser storage on this device",
    t ? t("auth_storage.no_token_saved") : "No token saved",
    t ? t("auth_storage.google_signed_in") : "Signed in with Google",
    t ? t("auth_storage.icloud_signed_in") : "Signed in with iCloud",
    t ? t("auth_storage.google_not_signed_in") : "Not signed in",
    t ? t("auth_storage.icloud_not_signed_in") : "Not signed in with iCloud",
    t ? t("auth_storage.local_folder_needs_reconnect") : "Choose folder",
  );
}
