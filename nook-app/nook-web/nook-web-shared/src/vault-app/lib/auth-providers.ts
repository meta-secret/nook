import {
  bindGoogleDriveSharedFolder,
  deleteAuthProvidersDb,
  default as initNookWasm,
  defaultDriveBackupName,
  defaultGithubRepo,
  findDuplicateSyncProvider as findDuplicateSyncProviderWasm,
  formatDriveStorageRef,
  maskGithubPatHint as maskGithubPatHintCore,
  localizeProviderLabel as localizeProviderLabelCore,
  providerDefaultLabel as providerDefaultLabelCore,
  providerStorageDetail as providerStorageDetailCore,
  sealAuthProvidersForDevicePublicKey,
  setGoogleDriveProviderMode,
  setICloudProviderMode,
  wasmStorageModeForProvider,
  type AuthProvidersSnapshot,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
  type NookVaultManager,
} from "$app-wasm";

await initNookWasm();

export type {
  AuthProvidersSnapshot,
  GoogleDriveMode,
  ICloudMode,
  LocalFolderConfig,
  OAuthFileConfig,
  OAuthFilePreset,
  StorageProvider,
  StorageProviderType,
} from "$app-wasm";

export {
  bindGoogleDriveSharedFolder,
  deleteAuthProvidersDb,
  formatDriveStorageRef,
  sealAuthProvidersForDevicePublicKey,
  setGoogleDriveProviderMode,
  setICloudProviderMode,
  wasmStorageModeForProvider,
};

export const LOCAL_PROVIDER_TYPE = "local" satisfies StorageProviderType;
export const LOCAL_FOLDER_PROVIDER_TYPE =
  "local-folder" satisfies StorageProviderType;
export const GITHUB_PROVIDER_TYPE = "github" satisfies StorageProviderType;
export const OAUTH_FILE_PROVIDER_TYPE =
  "oauth-file" satisfies StorageProviderType;

export const DEFAULT_GITHUB_REPO = defaultGithubRepo();
export const DEFAULT_DRIVE_BACKUP_NAME = defaultDriveBackupName();

export function findDuplicateSyncProvider(
  providers: StorageProvider[],
  candidate: StorageProvider,
  options?: { excludeId?: string },
): StorageProvider | void {
  return findDuplicateSyncProviderWasm(
    { providers },
    candidate,
    options?.excludeId,
  );
}

export async function saveAuthProviders(
  manager: NookVaultManager,
  snapshot: AuthProvidersSnapshot,
): Promise<void> {
  await manager.saveAuthProviders(snapshot);
}

export function providerDefaultLabel(
  type: StorageProviderType,
  detail?: string,
  oauthPreset: OAuthFilePreset = "google-drive",
): string {
  return providerDefaultLabelCore(type, detail, oauthPreset);
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
export function maskGithubPat(
  pat: string | void,
  t?: (key: string) => string,
): string {
  const hint = maskGithubPatHintCore(pat);
  if (!hint) {
    return t ? t("auth_storage.no_token_saved") : "No token saved";
  }
  return hint;
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
