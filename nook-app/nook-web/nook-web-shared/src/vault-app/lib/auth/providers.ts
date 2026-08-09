import { I18N_KEYS } from "../../../generated/i18n-keys";
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
  oauthAccessToken as oauthAccessTokenWasm,
  localizeProviderLabel as localizeProviderLabelCore,
  providerDefaultLabel as providerDefaultLabelCore,
  providerDefaultLabelWithoutDetail,
  providerStorageDetail as providerStorageDetailCore,
  sealAuthProvidersForDevicePublicKey,
  setGoogleDriveProviderMode,
  setICloudProviderMode,
  wasmStorageModeForProvider,
  NookDuplicateSyncProviderState,
  NookStoredOAuthFileConfigurationState,
  storedOAuthFileConfigurationState,
  NookOAuthAccessTokenKind as OAuthAccessTokenKind,
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
  type NookOAuthAccessToken,
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
  OAuthAccessTokenKind,
};

export type OAuthAccessToken =
  | { kind: OAuthAccessTokenKind.Missing }
  | { kind: OAuthAccessTokenKind.Available; token: string };

function copyOAuthAccessToken(
  accessToken: NookOAuthAccessToken,
): OAuthAccessToken {
  try {
    return accessToken.kind === OAuthAccessTokenKind.Available
      ? {
          kind: OAuthAccessTokenKind.Available,
          token: accessToken.token,
        }
      : { kind: OAuthAccessTokenKind.Missing };
  } finally {
    accessToken.free();
  }
}

export function oauthAccessToken(config: OAuthFileConfig): OAuthAccessToken {
  return copyOAuthAccessToken(oauthAccessTokenWasm(config));
}

export function missingOAuthAccessToken(): OAuthAccessToken {
  return { kind: OAuthAccessTokenKind.Missing };
}

export enum DriveFileIdentityKind {
  New = "new",
  Existing = "existing",
}

export type DriveFileIdentity =
  | { kind: DriveFileIdentityKind.New }
  | { kind: DriveFileIdentityKind.Existing; fileId: string };

export function formatDriveStorageRef({
  identity,
  fileName,
}: {
  readonly identity: DriveFileIdentity;
  readonly fileName: string;
}): string {
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

export function providerBelongsToVault({
  provider,
  storeId,
}: {
  readonly provider: StorageProvider;
  readonly storeId: string;
}): boolean {
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

export function defaultOAuthFileConfig({
  preset,
  fileName,
}: {
  readonly preset: OAuthFilePreset;
  readonly fileName: string;
}): OAuthFileConfig {
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

export function oauthAccountLabel(config: OAuthFileConfig): string {
  return config.accountEmail.state === "email"
    ? config.accountEmail.value.trim()
    : "";
}

export function hasGoogleDriveFolder(config: OAuthFileConfig): boolean {
  return config.folderId.state === "folderId";
}

export function hasICloudShareTarget(config: OAuthFileConfig): boolean {
  return config.iCloudShareTarget.state === "sharedTarget";
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

export { NookStoredOAuthFileConfigurationState };

export function isConfiguredOAuthFile(
  configuration: StoredOAuthFileConfiguration,
): configuration is Extract<
  StoredOAuthFileConfiguration,
  { config: OAuthFileConfig }
> {
  return (
    storedOAuthFileConfigurationState(configuration) ===
    NookStoredOAuthFileConfigurationState.Configured
  );
}

export function isICloudProvider(provider: StorageProvider): boolean {
  const configuration = provider.oauthFile;
  return (
    isConfiguredOAuthFile(configuration) &&
    configuration.config.preset === "icloud"
  );
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

export type DuplicateSyncProvider =
  | {
      state: NookDuplicateSyncProviderState.Duplicate;
      provider: StorageProvider;
    }
  | { state: NookDuplicateSyncProviderState.Unique };

export function findDuplicateSyncProvider({
  providers,
  candidate,
}: {
  readonly providers: StorageProvider[];
  readonly candidate: StorageProvider;
}): DuplicateSyncProvider {
  const findDuplicateSyncProviderWasmArgs: Parameters<
    typeof findDuplicateSyncProviderWasm
  >[0] = { providers, activeVaultStoreId: unselectedVaultScope() };
  const result = findDuplicateSyncProviderWasm(
    findDuplicateSyncProviderWasmArgs,
    candidate,
  );
  try {
    if (result.state === NookDuplicateSyncProviderState.Duplicate) {
      const provider = result.provider;
      return {
        state: NookDuplicateSyncProviderState.Duplicate,
        provider,
      };
    }
    return { state: NookDuplicateSyncProviderState.Unique };
  } finally {
    result.free();
  }
}

export function findDuplicateSyncProviderExcluding({
  providers,
  candidate,
  excludeId,
}: {
  readonly providers: StorageProvider[];
  readonly candidate: StorageProvider;
  readonly excludeId: string;
}): DuplicateSyncProvider {
  const findDuplicateSyncProviderExcludingWasmArgs: Parameters<
    typeof findDuplicateSyncProviderExcludingWasm
  >[0] = { providers, activeVaultStoreId: unselectedVaultScope() };
  const result = findDuplicateSyncProviderExcludingWasm(
    findDuplicateSyncProviderExcludingWasmArgs,
    candidate,
    excludeId,
  );
  try {
    if (result.state === NookDuplicateSyncProviderState.Duplicate) {
      const provider = result.provider;
      return {
        state: NookDuplicateSyncProviderState.Duplicate,
        provider,
      };
    }
    return { state: NookDuplicateSyncProviderState.Unique };
  } finally {
    result.free();
  }
}

export async function saveAuthProviders({
  manager,
  snapshot,
}: {
  readonly manager: NookVaultManager;
  readonly snapshot: AuthProvidersSnapshot;
}): Promise<void> {
  await manager.saveAuthProviders(snapshot);
}

export function providerDefaultLabel({
  type,
  options,
}: {
  readonly type: StorageProviderType;
  readonly options: {
    detail?: string;
    oauthPreset?: OAuthFilePreset;
  };
}): string {
  const oauthPreset = options.oauthPreset ?? "google-drive";
  return typeof options.detail === "string"
    ? providerDefaultLabelCore(type, options.detail, oauthPreset)
    : providerDefaultLabelWithoutDetail(type, oauthPreset);
}

export function localizeProviderLabel({
  label,
  t,
}: {
  readonly label: string;
  readonly t: (key: string) => string;
}): string {
  return localizeProviderLabelCore(
    label,
    t(I18N_KEYS.ProviderPickerThisDevice),
    t(I18N_KEYS.ProviderPickerGithub),
    t(I18N_KEYS.ProviderPickerLocalFolder),
    t(I18N_KEYS.ProviderPickerGoogleDrive),
    t(I18N_KEYS.ProviderPickerIcloud),
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

export function maskGithubPat({
  state,
  t,
}: {
  readonly state: GithubPatDisplay;
  readonly t?: (key: string) => string;
}): string {
  const hint = maskGithubPatHintCore(
    state.kind === GithubPatDisplayKind.Stored
      ? storedGithubPat(state.pat)
      : missingGithubPat(),
  );
  try {
    if (hint.state === NookGithubPatHintState.Missing) {
      return t ? t(I18N_KEYS.AuthStorageNoTokenSaved) : "No token saved";
    }
    return hint.value;
  } finally {
    hint.free();
  }
}

/** Secondary line for provider rows in management / picker UIs. */
export function providerStorageDetail({
  provider,
  t,
}: {
  readonly provider: StorageProvider;
  readonly t?: (key: string) => string;
}): string {
  return providerStorageDetailCore(
    provider,
    t
      ? t(I18N_KEYS.ProviderPickerThisDeviceDesc)
      : "Vault in browser storage on this device",
    t ? t(I18N_KEYS.AuthStorageNoTokenSaved) : "No token saved",
    t ? t(I18N_KEYS.AuthStorageGoogleSignedIn) : "Signed in with Google",
    t ? t(I18N_KEYS.AuthStorageIcloudSignedIn) : "Signed in with iCloud",
    t ? t(I18N_KEYS.AuthStorageGoogleNotSignedIn) : "Not signed in",
    t ? t(I18N_KEYS.AuthStorageIcloudNotSignedIn) : "Not signed in with iCloud",
    t ? t(I18N_KEYS.AuthStorageLocalFolderNeedsReconnect) : "Choose folder",
  );
}
