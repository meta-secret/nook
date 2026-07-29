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
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from "../../../../explicit-state";
export class VaultProviderState {
  providers = $state.raw<StorageProvider[]>([]);
  providersLoaded = $state(false);
  /** Locally cached vaults on this browser (metadata only). */
  localVaults = $state<NookLocalVaultEntry[]>([]);
  /** Active vault store_id — sync providers and local blob are scoped to this. */
  private activeVaultStoreState = $state<ValueState<StoreId>>(EMPTY_VALUE);
  get activeVaultStoreId(): StoreId | undefined {
    return this.activeVaultStoreState.kind === "present"
      ? this.activeVaultStoreState.value
      : undefined;
  }
  set activeVaultStoreId(value: StoreId | undefined) {
    this.activeVaultStoreState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
  /** Login gate: user picked a vault but has not unlocked yet. */
  private selectedLoginVaultStoreState =
    $state<ValueState<StoreId>>(EMPTY_VALUE);
  get selectedLoginVaultStoreId(): StoreId | undefined {
    return this.selectedLoginVaultStoreState.kind === "present"
      ? this.selectedLoginVaultStoreState.value
      : undefined;
  }
  set selectedLoginVaultStoreId(value: StoreId | undefined) {
    this.selectedLoginVaultStoreState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
  /** True when the active vault blob exists in IndexedDB. */
  localVaultPresent = $state(false);
  localLoginPrepared = $state(false);
  private loginSetupState =
    $state<ValueState<StorageProviderType>>(EMPTY_VALUE);
  get loginSetupType(): StorageProviderType | undefined {
    return this.loginSetupState.kind === "present"
      ? this.loginSetupState.value
      : undefined;
  }
  set loginSetupType(value: StorageProviderType | undefined) {
    this.loginSetupState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
  loginRequiresExistingVault = $state(false);
  private recoverySummaryState =
    $state<ValueState<VaultRecoverySummary>>(EMPTY_VALUE);
  get existingVaultRecoverySummary(): VaultRecoverySummary | undefined {
    return this.recoverySummaryState.kind === "present"
      ? this.recoverySummaryState.value
      : undefined;
  }
  set existingVaultRecoverySummary(value: VaultRecoverySummary | undefined) {
    this.recoverySummaryState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
  addProviderOpen = $state(false);

  storageMode = $state<StorageProviderType>(LOCAL_PROVIDER_TYPE);
  githubPat = $state("");
  githubRepo = $state(DEFAULT_GITHUB_REPO);
  private oauthFileState = $state.raw<ValueState<OAuthFileConfig>>(EMPTY_VALUE);
  get oauthFile(): OAuthFileConfig | undefined {
    return this.oauthFileState.kind === "present"
      ? this.oauthFileState.value
      : undefined;
  }
  set oauthFile(value: OAuthFileConfig | undefined) {
    this.oauthFileState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
  private localFolderState =
    $state.raw<ValueState<LocalFolderConfig>>(EMPTY_VALUE);
  get localFolder(): LocalFolderConfig | undefined {
    return this.localFolderState.kind === "present"
      ? this.localFolderState.value
      : undefined;
  }
  set localFolder(value: LocalFolderConfig | undefined) {
    this.localFolderState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
  localFolderBackupSupported = $state(
    typeof window !== "undefined" && isLocalFolderBackupSupported(),
  );
  vaultArchitecture = $state<VaultArchitecture>(defaultVaultArchitecture());
  draftDeviceMode = $state<DeviceMode>("standard");
  draftVaultType = $state(VaultType.Simple);
  draftReplicationType = $state<ReplicationType>("personal");
  private oauthSetupPresetState =
    $state<ValueState<OAuthFilePreset>>(EMPTY_VALUE);
  get oauthSetupPreset(): OAuthFilePreset | undefined {
    return this.oauthSetupPresetState.kind === "present"
      ? this.oauthSetupPresetState.value
      : undefined;
  }
  set oauthSetupPreset(value: OAuthFilePreset | undefined) {
    this.oauthSetupPresetState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
  googleOAuthBusy = $state(false);
  icloudOAuthPreparing = $state(false);
  icloudOAuthReady = $state(false);
  icloudOAuthBusy = $state(false);
}
