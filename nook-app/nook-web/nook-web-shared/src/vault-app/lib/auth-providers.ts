import {
  bindGoogleDriveSharedFolder as bindGoogleDriveSharedFolderWasm,
  deleteAuthProvidersDb as deleteAuthProvidersDbWasm,
  default as initNookWasm,
  defaultDriveBackupName,
  ensureLocalAuthProviderSnapshot as ensureLocalAuthProviderSnapshotWasm,
  defaultGithubRepo,
  findDuplicateSyncProvider as findDuplicateSyncProviderWasm,
  formatDriveStorageRef as formatDriveStorageRefCore,
  loadAuthProviders as loadAuthProvidersWasm,
  maskGithubPatHint as maskGithubPatHintCore,
  NookAuthProvidersSnapshotValue,
  NookOAuthFileConfigValue,
  NookStorageProviderList,
  NookStorageProviderKind,
  NookStorageProviderValue,
  NookStorageProviderTypeUtil,
  localizeProviderLabel as localizeProviderLabelCore,
  providerDefaultLabel as providerDefaultLabelCore,
  providerStorageDetail as providerStorageDetailCore,
  saveAuthProviders as saveAuthProvidersWasm,
  sealAuthProvidersForDevicePublicKey as sealAuthProvidersForDevicePublicKeyWasm,
  setGoogleDriveProviderMode as setGoogleDriveProviderModeWasm,
  setICloudProviderMode as setICloudProviderModeWasm,
  wasmStorageModeForProvider as wasmStorageModeForProviderCore,
  type NookAuthProvidersSnapshot,
  type NookLoadedAuthProviders,
  type NookLocalFolderProviderConfig,
  type NookGoogleDriveMode,
  type NookICloudMode,
  type NookOAuthFileConfig,
  type NookOAuthFilePreset,
  type NookStorageProvider,
  type NookStorageProviderType,
  type NookVaultManager,
} from "$app-wasm";

await initNookWasm();

export type StorageProviderType = NookStorageProviderType;
export type OAuthFilePreset = NookOAuthFilePreset;
export type GoogleDriveMode = NookGoogleDriveMode;
export type ICloudMode = NookICloudMode;
export type OAuthFileConfig = NookOAuthFileConfig;
export type LocalFolderConfig = NookLocalFolderProviderConfig;
export type StorageProvider = NookStorageProvider;
export type AuthProvidersSnapshot = NookAuthProvidersSnapshot;
type LoadedAuthProviders = NookLoadedAuthProviders;

export { NookStorageProviderKind };

export const LOCAL_PROVIDER_TYPE = NookStorageProviderTypeUtil.value(
  NookStorageProviderKind.Local,
) as StorageProviderType;
export const LOCAL_FOLDER_PROVIDER_TYPE = NookStorageProviderTypeUtil.value(
  NookStorageProviderKind.LocalFolder,
) as StorageProviderType;
export const GITHUB_PROVIDER_TYPE = NookStorageProviderTypeUtil.value(
  NookStorageProviderKind.Github,
) as StorageProviderType;
export const OAUTH_FILE_PROVIDER_TYPE = NookStorageProviderTypeUtil.value(
  NookStorageProviderKind.OauthFile,
) as StorageProviderType;

export const DEFAULT_GITHUB_REPO = defaultGithubRepo();
export const DEFAULT_DRIVE_BACKUP_NAME = defaultDriveBackupName();

export function setGoogleDriveProviderMode(
  config: OAuthFileConfig,
  mode: GoogleDriveMode,
): OAuthFileConfig {
  const input = NookOAuthFileConfigValue.fromObject(toPlain(config));
  try {
    const output = setGoogleDriveProviderModeWasm(input, mode);
    try {
      return output.toObject() as OAuthFileConfig;
    } finally {
      output.free();
    }
  } finally {
    input.free();
  }
}

export function setICloudProviderMode(
  config: OAuthFileConfig,
  mode: ICloudMode,
): OAuthFileConfig {
  const input = NookOAuthFileConfigValue.fromObject(toPlain(config));
  try {
    const output = setICloudProviderModeWasm(input, mode);
    try {
      return output.toObject() as OAuthFileConfig;
    } finally {
      output.free();
    }
  } finally {
    input.free();
  }
}

export function bindGoogleDriveSharedFolder(
  config: OAuthFileConfig,
  folderRef: string,
): OAuthFileConfig {
  const input = NookOAuthFileConfigValue.fromObject(toPlain(config));
  try {
    const output = bindGoogleDriveSharedFolderWasm(input, folderRef);
    try {
      return output.toObject() as OAuthFileConfig;
    } finally {
      output.free();
    }
  } finally {
    input.free();
  }
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
  const providerList = NookStorageProviderList.fromArray(toPlain(providers));
  const candidateValue = NookStorageProviderValue.fromObject(
    toPlain(candidate),
  );
  try {
    const duplicate = findDuplicateSyncProviderWasm(
      providerList,
      candidateValue,
      options?.excludeId ?? undefined,
    );
    if (!duplicate) return undefined;
    try {
      return duplicate.toObject() as StorageProvider;
    } finally {
      duplicate.free();
    }
  } finally {
    candidateValue.free();
    providerList.free();
  }
}

export function formatDriveStorageRef(
  fileId: string | undefined,
  fileName: string,
): string {
  return formatDriveStorageRefCore(fileId ?? undefined, fileName);
}

export async function loadAuthProviders(
  manager: NookVaultManager,
): Promise<AuthProvidersSnapshot> {
  const loadedValue = await loadAuthProvidersWasm(manager);
  try {
    const loaded = loadedValue.toObject() as LoadedAuthProviders;
    return loaded.snapshot;
  } finally {
    loadedValue.free();
  }
}

/** Load providers and ensure the local provider row exists. */
export async function loadAuthProvidersWithLocalRow(
  manager: NookVaultManager,
): Promise<AuthProvidersSnapshot> {
  const loadedValue = await loadAuthProvidersWasm(manager);
  let loaded: LoadedAuthProviders;
  try {
    loaded = loadedValue.toObject() as LoadedAuthProviders;
  } finally {
    loadedValue.free();
  }
  const snapshotValue = NookAuthProvidersSnapshotValue.fromObject(
    toPlain(loaded.snapshot),
  );
  let migratedSnapshot: AuthProvidersSnapshot;
  let migrated: boolean;
  try {
    const migratedValue =
      await ensureLocalAuthProviderSnapshotWasm(snapshotValue);
    try {
      migrated = migratedValue.migrated;
      const migratedSnapshotValue = migratedValue.snapshot;
      try {
        migratedSnapshot =
          migratedSnapshotValue.toObject() as AuthProvidersSnapshot;
      } finally {
        migratedSnapshotValue.free();
      }
    } finally {
      migratedValue.free();
    }
  } finally {
    snapshotValue.free();
  }
  if (
    migrated ||
    migratedSnapshot.providers.length !== loaded.snapshot.providers.length
  ) {
    await saveAuthProviders(manager, migratedSnapshot);
  }
  return migratedSnapshot;
}

export async function saveAuthProviders(
  manager: NookVaultManager,
  snapshot: AuthProvidersSnapshot,
): Promise<void> {
  const snapshotValue = NookAuthProvidersSnapshotValue.fromObject(
    toPlain(snapshot),
  );
  try {
    await saveAuthProvidersWasm(manager, snapshotValue);
  } finally {
    snapshotValue.free();
  }
}

export function sealAuthProvidersForDevicePublicKey(
  devicePublicKey: string,
  snapshot: AuthProvidersSnapshot,
): AuthProvidersSnapshot {
  const snapshotValue = NookAuthProvidersSnapshotValue.fromObject(
    toPlain(snapshot),
  );
  try {
    const sealed = sealAuthProvidersForDevicePublicKeyWasm(
      devicePublicKey,
      snapshotValue,
    );
    try {
      return sealed.toObject() as AuthProvidersSnapshot;
    } finally {
      sealed.free();
    }
  } finally {
    snapshotValue.free();
  }
}

export function wasmStorageModeForProvider(
  type: StorageProviderType,
  oauthPreset?: OAuthFilePreset,
): string {
  return wasmStorageModeForProviderCore(type, oauthPreset ?? undefined);
}

export function storageProviderKind(
  type: StorageProviderType,
): NookStorageProviderKind {
  return NookStorageProviderTypeUtil.parse(type);
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
  const providerValue = NookStorageProviderValue.fromObject(toPlain(provider));
  try {
    return providerStorageDetailCore(
      providerValue,
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
  } finally {
    providerValue.free();
  }
}

export async function deleteAuthProvidersDb(): Promise<void> {
  await deleteAuthProvidersDbWasm();
}
