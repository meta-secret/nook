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
  DeviceMode,
  ReplicationType,
  VaultType,
  type VaultArchitecture,
} from "$lib/vault-architecture";
enum ActiveVaultKind {
  Closed = "closed",
  Open = "open",
}

type ActiveVault =
  | { kind: ActiveVaultKind.Closed }
  | { kind: ActiveVaultKind.Open; storeId: StoreId };
enum LoginVaultSelectionKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

type LoginVaultSelection =
  | { kind: LoginVaultSelectionKind.NotSelected }
  | { kind: LoginVaultSelectionKind.Selected; storeId: StoreId };
enum LoginSetupKind {
  Inactive = "inactive",
  Active = "active",
}

type LoginSetup =
  | { kind: LoginSetupKind.Inactive }
  | { kind: LoginSetupKind.Active; providerType: StorageProviderType };
enum RecoveryDiscoveryKind {
  NotFound = "not-found",
  Found = "found",
}

type RecoveryDiscovery =
  | { kind: RecoveryDiscoveryKind.NotFound }
  | { kind: RecoveryDiscoveryKind.Found; summary: VaultRecoverySummary };
enum OAuthFileDraftKind {
  NotConfigured = "not-configured",
  Configured = "configured",
}

type OAuthFileDraft =
  | { kind: OAuthFileDraftKind.NotConfigured }
  | { kind: OAuthFileDraftKind.Configured; config: OAuthFileConfig };
enum LocalFolderDraftKind {
  NotConfigured = "not-configured",
  Configured = "configured",
}

type LocalFolderDraft =
  | { kind: LocalFolderDraftKind.NotConfigured }
  | { kind: LocalFolderDraftKind.Configured; config: LocalFolderConfig };
enum OAuthSetupPresetKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

type OAuthSetupPreset =
  | { kind: OAuthSetupPresetKind.NotSelected }
  | { kind: OAuthSetupPresetKind.Selected; preset: OAuthFilePreset };
export class VaultProviderState {
  providers = $state.raw<StorageProvider[]>([]);
  providersLoaded = $state(false);
  /** Locally cached vaults on this browser (metadata only). */
  localVaults = $state<NookLocalVaultEntry[]>([]);
  /** Active vault store_id — sync providers and local blob are scoped to this. */
  private activeVaultStoreState = $state<ActiveVault>({
    kind: ActiveVaultKind.Closed,
  });
  get activeVaultStoreId(): StoreId | void {
    if (this.activeVaultStoreState.kind === ActiveVaultKind.Open)
      return this.activeVaultStoreState.storeId;
    return;
  }
  get hasActiveVaultStore(): boolean {
    return this.activeVaultStoreState.kind === ActiveVaultKind.Open;
  }
  set activeVaultStoreId(value: StoreId) {
    this.activeVaultStoreState = { kind: ActiveVaultKind.Open, storeId: value };
  }
  clearActiveVaultStore(): void {
    this.activeVaultStoreState = { kind: ActiveVaultKind.Closed };
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
  private loginSetupState = $state<LoginSetup>({
    kind: LoginSetupKind.Inactive,
  });
  get loginSetupType(): StorageProviderType | void {
    if (this.loginSetupState.kind === LoginSetupKind.Active)
      return this.loginSetupState.providerType;
    return;
  }
  get loginSetupActive(): boolean {
    return this.loginSetupState.kind === LoginSetupKind.Active;
  }
  set loginSetupType(value: StorageProviderType) {
    this.loginSetupState = { kind: LoginSetupKind.Active, providerType: value };
  }
  clearLoginSetup(): void {
    this.loginSetupState = { kind: LoginSetupKind.Inactive };
  }
  loginRequiresExistingVault = $state(false);
  private recoverySummaryState = $state<RecoveryDiscovery>({
    kind: RecoveryDiscoveryKind.NotFound,
  });
  get existingVaultRecoverySummary(): VaultRecoverySummary | void {
    if (this.recoverySummaryState.kind === RecoveryDiscoveryKind.Found)
      return this.recoverySummaryState.summary;
    return;
  }
  set existingVaultRecoverySummary(value: VaultRecoverySummary) {
    this.recoverySummaryState = {
      kind: RecoveryDiscoveryKind.Found,
      summary: value,
    };
  }
  clearExistingVaultRecoverySummary(): void {
    this.recoverySummaryState = { kind: RecoveryDiscoveryKind.NotFound };
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
  draftDeviceMode = $state<DeviceMode>(DeviceMode.Standard);
  draftVaultType = $state(VaultType.Simple);
  draftReplicationType = $state<ReplicationType>(ReplicationType.Personal);
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
