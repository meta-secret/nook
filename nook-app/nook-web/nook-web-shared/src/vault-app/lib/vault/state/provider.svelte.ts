import {
  isLocalFolderBackupSupported,
  type NookLocalVaultEntry,
  type StoreId,
  type VaultRecoverySummary,
} from "$app-wasm";
import {
  DEFAULT_GITHUB_REPO,
  LOCAL_PROVIDER_TYPE,
  type LocalFolderConfig,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from "$lib/auth-providers";
import {
  defaultVaultArchitecture,
  VaultType,
  type DeviceMode,
  type ReplicationType,
  type VaultArchitecture,
} from "$lib/vault-architecture";
export class VaultProviderState {
  providers = $state.raw<StorageProvider[]>([]);
  providersLoaded = $state(false);
  /** Locally cached vaults on this browser (metadata only). */
  localVaults = $state<NookLocalVaultEntry[]>([]);
  /** Active vault store_id — sync providers and local blob are scoped to this. */
  activeVaultStoreId = $state<StoreId>();
  /** Login gate: user picked a vault but has not unlocked yet. */
  selectedLoginVaultStoreId = $state<StoreId>();
  /** True when the active vault blob exists in IndexedDB. */
  localVaultPresent = $state(false);
  localLoginPrepared = $state(false);
  loginSetupType = $state<StorageProviderType>();
  loginRequiresExistingVault = $state(false);
  existingVaultRecoverySummary = $state<VaultRecoverySummary>();
  addProviderOpen = $state(false);

  storageMode = $state<StorageProviderType>(LOCAL_PROVIDER_TYPE);
  githubPat = $state("");
  githubRepo = $state(DEFAULT_GITHUB_REPO);
  oauthFile = $state.raw<OAuthFileConfig>();
  localFolder = $state.raw<LocalFolderConfig>();
  localFolderBackupSupported = $state(
    typeof window !== "undefined" && isLocalFolderBackupSupported(),
  );
  vaultArchitecture = $state<VaultArchitecture>(defaultVaultArchitecture());
  draftDeviceMode = $state<DeviceMode>("standard");
  draftVaultType = $state(VaultType.Simple);
  draftReplicationType = $state<ReplicationType>("personal");
  oauthSetupPreset = $state<OAuthFilePreset>();
  googleOAuthBusy = $state(false);
  icloudOAuthPreparing = $state(false);
  icloudOAuthReady = $state(false);
  icloudOAuthBusy = $state(false);
}
