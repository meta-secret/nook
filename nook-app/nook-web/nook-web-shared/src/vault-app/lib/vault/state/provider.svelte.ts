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
type ActiveVault = { kind: "closed" } | { kind: "open"; storeId: StoreId };
type LoginVaultSelection =
  | { kind: "not-selected" }
  | { kind: "selected"; storeId: StoreId };
type LoginSetup =
  | { kind: "inactive" }
  | { kind: "active"; providerType: StorageProviderType };
type RecoveryDiscovery =
  | { kind: "not-found" }
  | { kind: "found"; summary: VaultRecoverySummary };
type OAuthFileDraft =
  | { kind: "not-configured" }
  | { kind: "configured"; config: OAuthFileConfig };
type LocalFolderDraft =
  | { kind: "not-configured" }
  | { kind: "configured"; config: LocalFolderConfig };
type OAuthSetupPreset =
  | { kind: "not-selected" }
  | { kind: "selected"; preset: OAuthFilePreset };
export class VaultProviderState {
  providers = $state.raw<StorageProvider[]>([]);
  providersLoaded = $state(false);
  /** Locally cached vaults on this browser (metadata only). */
  localVaults = $state<NookLocalVaultEntry[]>([]);
  /** Active vault store_id — sync providers and local blob are scoped to this. */
  private activeVaultStoreState = $state<ActiveVault>({ kind: "closed" });
  get activeVaultStoreId(): StoreId | void {
    if (this.activeVaultStoreState.kind === "open")
      return this.activeVaultStoreState.storeId;
    return;
  }
  get hasActiveVaultStore(): boolean {
    return this.activeVaultStoreState.kind === "open";
  }
  set activeVaultStoreId(value: StoreId) {
    this.activeVaultStoreState = { kind: "open", storeId: value };
  }
  clearActiveVaultStore(): void {
    this.activeVaultStoreState = { kind: "closed" };
  }
  /** Login gate: user picked a vault but has not unlocked yet. */
  private selectedLoginVaultStoreState = $state<LoginVaultSelection>({
    kind: "not-selected",
  });
  get selectedLoginVaultStoreId(): StoreId | void {
    if (this.selectedLoginVaultStoreState.kind === "selected")
      return this.selectedLoginVaultStoreState.storeId;
    return;
  }
  get hasSelectedLoginVaultStore(): boolean {
    return this.selectedLoginVaultStoreState.kind === "selected";
  }
  set selectedLoginVaultStoreId(value: StoreId) {
    this.selectedLoginVaultStoreState = { kind: "selected", storeId: value };
  }
  clearSelectedLoginVaultStore(): void {
    this.selectedLoginVaultStoreState = { kind: "not-selected" };
  }
  /** True when the active vault blob exists in IndexedDB. */
  localVaultPresent = $state(false);
  localLoginPrepared = $state(false);
  private loginSetupState = $state<LoginSetup>({ kind: "inactive" });
  get loginSetupType(): StorageProviderType | void {
    if (this.loginSetupState.kind === "active")
      return this.loginSetupState.providerType;
    return;
  }
  get loginSetupActive(): boolean {
    return this.loginSetupState.kind === "active";
  }
  set loginSetupType(value: StorageProviderType) {
    this.loginSetupState = { kind: "active", providerType: value };
  }
  clearLoginSetup(): void {
    this.loginSetupState = { kind: "inactive" };
  }
  loginRequiresExistingVault = $state(false);
  private recoverySummaryState = $state<RecoveryDiscovery>({
    kind: "not-found",
  });
  get existingVaultRecoverySummary(): VaultRecoverySummary | void {
    if (this.recoverySummaryState.kind === "found")
      return this.recoverySummaryState.summary;
    return;
  }
  set existingVaultRecoverySummary(value: VaultRecoverySummary) {
    this.recoverySummaryState = { kind: "found", summary: value };
  }
  clearExistingVaultRecoverySummary(): void {
    this.recoverySummaryState = { kind: "not-found" };
  }
  addProviderOpen = $state(false);

  storageMode = $state<StorageProviderType>(LOCAL_PROVIDER_TYPE);
  githubPat = $state("");
  githubRepo = $state(DEFAULT_GITHUB_REPO);
  private oauthFileState = $state.raw<OAuthFileDraft>({
    kind: "not-configured",
  });
  get oauthFile(): OAuthFileConfig | void {
    if (this.oauthFileState.kind === "configured")
      return this.oauthFileState.config;
    return;
  }
  set oauthFile(value: OAuthFileConfig) {
    this.oauthFileState = { kind: "configured", config: value };
  }
  clearOauthFile(): void {
    this.oauthFileState = { kind: "not-configured" };
  }
  private localFolderState = $state.raw<LocalFolderDraft>({
    kind: "not-configured",
  });
  get localFolder(): LocalFolderConfig | void {
    if (this.localFolderState.kind === "configured")
      return this.localFolderState.config;
    return;
  }
  set localFolder(value: LocalFolderConfig) {
    this.localFolderState = { kind: "configured", config: value };
  }
  clearLocalFolder(): void {
    this.localFolderState = { kind: "not-configured" };
  }
  localFolderBackupSupported = $state(
    "window" in globalThis && isLocalFolderBackupSupported(),
  );
  vaultArchitecture = $state<VaultArchitecture>(defaultVaultArchitecture());
  draftDeviceMode = $state<DeviceMode>("standard");
  draftVaultType = $state(VaultType.Simple);
  draftReplicationType = $state<ReplicationType>("personal");
  private oauthSetupPresetState = $state<OAuthSetupPreset>({
    kind: "not-selected",
  });
  get oauthSetupPreset(): OAuthFilePreset | void {
    if (this.oauthSetupPresetState.kind === "selected")
      return this.oauthSetupPresetState.preset;
    return;
  }
  set oauthSetupPreset(value: OAuthFilePreset) {
    this.oauthSetupPresetState = { kind: "selected", preset: value };
  }
  clearOauthSetupPreset(): void {
    this.oauthSetupPresetState = { kind: "not-selected" };
  }
  googleOAuthBusy = $state(false);
  icloudOAuthPreparing = $state(false);
  icloudOAuthReady = $state(false);
  icloudOAuthBusy = $state(false);
}
