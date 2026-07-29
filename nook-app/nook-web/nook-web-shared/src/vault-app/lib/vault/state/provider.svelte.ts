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
  get activeVaultStoreId(): StoreId | void {
    if (this.activeVaultStoreState.kind === "present")
      return this.activeVaultStoreState.value;
    return;
  }
  set activeVaultStoreId(value: StoreId | void) {
    this.activeVaultStoreState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearActiveVaultStore(): void {
    this.activeVaultStoreState = EMPTY_VALUE;
  }
  /** Login gate: user picked a vault but has not unlocked yet. */
  private selectedLoginVaultStoreState =
    $state<ValueState<StoreId>>(EMPTY_VALUE);
  get selectedLoginVaultStoreId(): StoreId | void {
    if (this.selectedLoginVaultStoreState.kind === "present")
      return this.selectedLoginVaultStoreState.value;
    return;
  }
  set selectedLoginVaultStoreId(value: StoreId | void) {
    this.selectedLoginVaultStoreState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearSelectedLoginVaultStore(): void {
    this.selectedLoginVaultStoreState = EMPTY_VALUE;
  }
  /** True when the active vault blob exists in IndexedDB. */
  localVaultPresent = $state(false);
  localLoginPrepared = $state(false);
  private loginSetupState =
    $state<ValueState<StorageProviderType>>(EMPTY_VALUE);
  get loginSetupType(): StorageProviderType | void {
    if (this.loginSetupState.kind === "present")
      return this.loginSetupState.value;
    return;
  }
  set loginSetupType(value: StorageProviderType | void) {
    this.loginSetupState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearLoginSetup(): void {
    this.loginSetupState = EMPTY_VALUE;
  }
  loginRequiresExistingVault = $state(false);
  private recoverySummaryState =
    $state<ValueState<VaultRecoverySummary>>(EMPTY_VALUE);
  get existingVaultRecoverySummary(): VaultRecoverySummary | void {
    if (this.recoverySummaryState.kind === "present")
      return this.recoverySummaryState.value;
    return;
  }
  set existingVaultRecoverySummary(value: VaultRecoverySummary | void) {
    this.recoverySummaryState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearExistingVaultRecoverySummary(): void {
    this.recoverySummaryState = EMPTY_VALUE;
  }
  addProviderOpen = $state(false);

  storageMode = $state<StorageProviderType>(LOCAL_PROVIDER_TYPE);
  githubPat = $state("");
  githubRepo = $state(DEFAULT_GITHUB_REPO);
  private oauthFileState = $state.raw<ValueState<OAuthFileConfig>>(EMPTY_VALUE);
  get oauthFile(): OAuthFileConfig | void {
    if (this.oauthFileState.kind === "present")
      return this.oauthFileState.value;
    return;
  }
  set oauthFile(value: OAuthFileConfig | void) {
    this.oauthFileState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearOauthFile(): void {
    this.oauthFileState = EMPTY_VALUE;
  }
  private localFolderState =
    $state.raw<ValueState<LocalFolderConfig>>(EMPTY_VALUE);
  get localFolder(): LocalFolderConfig | void {
    if (this.localFolderState.kind === "present")
      return this.localFolderState.value;
    return;
  }
  set localFolder(value: LocalFolderConfig | void) {
    this.localFolderState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearLocalFolder(): void {
    this.localFolderState = EMPTY_VALUE;
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
  get oauthSetupPreset(): OAuthFilePreset | void {
    if (this.oauthSetupPresetState.kind === "present")
      return this.oauthSetupPresetState.value;
    return;
  }
  set oauthSetupPreset(value: OAuthFilePreset | void) {
    this.oauthSetupPresetState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearOauthSetupPreset(): void {
    this.oauthSetupPresetState = EMPTY_VALUE;
  }
  googleOAuthBusy = $state(false);
  icloudOAuthPreparing = $state(false);
  icloudOAuthReady = $state(false);
  icloudOAuthBusy = $state(false);
}
