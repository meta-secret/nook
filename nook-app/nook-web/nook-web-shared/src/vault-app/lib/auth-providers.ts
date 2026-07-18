import {
  bindGoogleDriveSharedFolder as bindGoogleDriveSharedFolderWasm,
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
  sealAuthProvidersForDevicePublicKey as sealAuthProvidersForDevicePublicKeyWasm,
  setGoogleDriveProviderMode as setGoogleDriveProviderModeWasm,
  setICloudProviderMode as setICloudProviderModeWasm,
  wasmStorageModeForProvider,
  type AuthProvidersSnapshot,
  type GoogleDriveMode,
  type ICloudMode,
  type OAuthFileConfig,
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
  deleteAuthProvidersDb,
  formatDriveStorageRef,
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

export function setGoogleDriveProviderMode(
  config: OAuthFileConfig,
  mode: GoogleDriveMode,
): OAuthFileConfig {
  return setGoogleDriveProviderModeWasm(toPlain(config), mode);
}

export function setICloudProviderMode(
  config: OAuthFileConfig,
  mode: ICloudMode,
): OAuthFileConfig {
  return setICloudProviderModeWasm(toPlain(config), mode);
}

export function bindGoogleDriveSharedFolder(
  config: OAuthFileConfig,
  folderRef: string,
): OAuthFileConfig {
  return bindGoogleDriveSharedFolderWasm(toPlain(config), folderRef);
}

/** Plain snapshot safe for the wasm boundary (no reactive proxies / undefined). */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function findDuplicateSyncProvider(
  providers: StorageProvider[],
  candidate: StorageProvider,
  options?: { excludeId?: string },
): StorageProvider | undefined {
  return findDuplicateSyncProviderWasm(
    { providers: toPlain(providers) },
    toPlain(candidate),
    options?.excludeId ?? undefined,
  );
}

export async function saveAuthProviders(
  manager: NookVaultManager,
  snapshot: AuthProvidersSnapshot,
): Promise<void> {
  await manager.saveAuthProviders(toPlain(snapshot));
}

export function sealAuthProvidersForDevicePublicKey(
  devicePublicKey: string,
  snapshot: AuthProvidersSnapshot,
): AuthProvidersSnapshot {
  return sealAuthProvidersForDevicePublicKeyWasm(
    devicePublicKey,
    toPlain(snapshot),
  );
}

export function providerDefaultLabel(
  type: StorageProviderType,
  detail?: string,
  oauthPreset: OAuthFilePreset = "google-drive",
): string {
  return providerDefaultLabelCore(type, detail ?? undefined, oauthPreset);
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
  pat: string | undefined,
  t?: (key: string) => string,
): string {
  const hint = maskGithubPatHintCore(pat ?? undefined);
  if (hint == undefined) {
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
    toPlain(provider),
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
