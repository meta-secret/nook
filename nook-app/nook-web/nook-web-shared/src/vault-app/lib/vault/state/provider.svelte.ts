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
} from "$lib/auth/providers";
import {
  defaultVaultArchitecture,
  DeviceMode,
  ReplicationType,
  VaultType,
  type VaultArchitecture,
} from "$lib/vault/architecture-model";
export enum ActiveVaultKind {
  Closed = "closed",
  Open = "open",
}

export type ActiveVault =
  | { kind: ActiveVaultKind.Closed }
  | { kind: ActiveVaultKind.Open; storeId: StoreId };
export enum LoginVaultSelectionKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

export type LoginVaultSelection =
  | { kind: LoginVaultSelectionKind.NotSelected }
  | { kind: LoginVaultSelectionKind.Selected; storeId: StoreId };
export enum LoginSetupKind {
  Inactive = "inactive",
  Active = "active",
}

export type LoginSetup =
  | { kind: LoginSetupKind.Inactive }
  | { kind: LoginSetupKind.Active; providerType: StorageProviderType };

export enum LocalLoginPreparationState {
  Idle = "idle",
  Preparing = "preparing",
  Ready = "ready",
}

export enum StagedRemoteStorageKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type StagedRemoteStorage =
  | { kind: StagedRemoteStorageKind.Unavailable }
  | {
      kind: StagedRemoteStorageKind.Available;
      args: [string, string, string];
    };

export enum LocalProviderLookupKind {
  Missing = "missing",
  Found = "found",
}

export type LocalProviderLookup =
  | { kind: LocalProviderLookupKind.Missing }
  | { kind: LocalProviderLookupKind.Found; provider: StorageProvider };
export enum LocalVaultCatalogKind {
  Empty = "empty",
  Available = "available",
}

export type LocalVaultCatalog =
  | { kind: LocalVaultCatalogKind.Empty }
  | { kind: LocalVaultCatalogKind.Available; first: NookLocalVaultEntry };
export enum RecoveryDiscoveryKind {
  NotFound = "not-found",
  Found = "found",
}

export type RecoveryDiscovery =
  | { kind: RecoveryDiscoveryKind.NotFound }
  | { kind: RecoveryDiscoveryKind.Found; summary: VaultRecoverySummary };
export enum OAuthFileDraftKind {
  NotConfigured = "not-configured",
  Configured = "configured",
}

export type OAuthFileDraft =
  | { kind: OAuthFileDraftKind.NotConfigured }
  | { kind: OAuthFileDraftKind.Configured; config: OAuthFileConfig };
export enum LocalFolderDraftKind {
  NotConfigured = "not-configured",
  Configured = "configured",
}

export type LocalFolderDraft =
  | { kind: LocalFolderDraftKind.NotConfigured }
  | { kind: LocalFolderDraftKind.Configured; config: LocalFolderConfig };
export enum OAuthSetupPresetKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

export type OAuthSetupPreset =
  | { kind: OAuthSetupPresetKind.NotSelected }
  | { kind: OAuthSetupPresetKind.Selected; preset: OAuthFilePreset };
export class VaultProviderState {
  providers = $state.raw<StorageProvider[]>([]);
  providersLoaded = $state(false);
  /** Locally cached vaults on this browser (metadata only). */
  localVaults = $state<NookLocalVaultEntry[]>([]);
  get localVaultCatalog(): LocalVaultCatalog {
    for (const first of this.localVaults) {
      return { kind: LocalVaultCatalogKind.Available, first };
    }
    return { kind: LocalVaultCatalogKind.Empty };
  }
  /** Active vault store_id — sync providers and local blob are scoped to this. */
  private activeVaultStoreState = $state<ActiveVault>({
    kind: ActiveVaultKind.Closed,
  });
  get activeVault(): ActiveVault {
    return this.activeVaultStoreState;
  }
  get hasActiveVaultStore(): boolean {
    return this.activeVaultStoreState.kind === ActiveVaultKind.Open;
  }
  requireActiveVaultStoreId(): StoreId {
    if (this.activeVaultStoreState.kind === ActiveVaultKind.Open)
      return this.activeVaultStoreState.storeId;
    throw new Error("Active vault store is required");
  }
  openActiveVault(value: StoreId): void {
    this.activeVaultStoreState = { kind: ActiveVaultKind.Open, storeId: value };
  }
  clearActiveVaultStore(): void {
    this.activeVaultStoreState = { kind: ActiveVaultKind.Closed };
  }
  /** Login gate: user picked a vault but has not unlocked yet. */
  private selectedLoginVaultStoreState = $state<LoginVaultSelection>({
    kind: LoginVaultSelectionKind.NotSelected,
  });
  get selectedLoginVault(): LoginVaultSelection {
    return this.selectedLoginVaultStoreState;
  }
  get hasSelectedLoginVaultStore(): boolean {
    return (
      this.selectedLoginVaultStoreState.kind ===
      LoginVaultSelectionKind.Selected
    );
  }
  selectLoginVault(value: StoreId): void {
    this.selectedLoginVaultStoreState = {
      kind: LoginVaultSelectionKind.Selected,
      storeId: value,
    };
  }
  clearSelectedLoginVaultStore(): void {
    this.selectedLoginVaultStoreState = {
      kind: LoginVaultSelectionKind.NotSelected,
    };
  }
  /** True when the active vault blob exists in IndexedDB. */
  localVaultPresent = $state(false);
  localLoginPreparation = $state<LocalLoginPreparationState>(
    LocalLoginPreparationState.Idle,
  );
  private loginSetupState = $state<LoginSetup>({
    kind: LoginSetupKind.Inactive,
  });
  get loginSetup(): LoginSetup {
    return this.loginSetupState;
  }
  activateLoginSetup(value: StorageProviderType): void {
    this.loginSetupState = { kind: LoginSetupKind.Active, providerType: value };
  }
  clearLoginSetup(): void {
    this.loginSetupState = { kind: LoginSetupKind.Inactive };
  }
  loginRequiresExistingVault = $state(false);
  private recoverySummaryState = $state<RecoveryDiscovery>({
    kind: RecoveryDiscoveryKind.NotFound,
  });
  get recoveryDiscovery(): RecoveryDiscovery {
    return this.recoverySummaryState;
  }
  requireExistingVaultRecovery(): VaultRecoverySummary {
    if (this.recoverySummaryState.kind === RecoveryDiscoveryKind.Found) {
      return this.recoverySummaryState.summary;
    }
    throw new Error("Existing vault recovery summary is required");
  }
  recordExistingVaultRecovery(value: VaultRecoverySummary): void {
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
    kind: OAuthFileDraftKind.NotConfigured,
  });
  get oauthFileDraft(): OAuthFileDraft {
    return this.oauthFileState;
  }
  requireOauthFileConfig(): OAuthFileConfig {
    if (this.oauthFileState.kind === OAuthFileDraftKind.Configured) {
      return this.oauthFileState.config;
    }
    throw new Error("OAuth file configuration is required");
  }
  configureOauthFile(value: OAuthFileConfig): void {
    this.oauthFileState = {
      kind: OAuthFileDraftKind.Configured,
      config: value,
    };
  }
  clearOauthFile(): void {
    if (this.oauthFileState.kind === OAuthFileDraftKind.NotConfigured) return;
    this.oauthFileState = { kind: OAuthFileDraftKind.NotConfigured };
  }
  private localFolderState = $state.raw<LocalFolderDraft>({
    kind: LocalFolderDraftKind.NotConfigured,
  });
  get localFolderDraft(): LocalFolderDraft {
    return this.localFolderState;
  }
  requireLocalFolderConfig(): LocalFolderConfig {
    if (this.localFolderState.kind === LocalFolderDraftKind.Configured) {
      return this.localFolderState.config;
    }
    throw new Error("Local folder configuration is required");
  }
  configureLocalFolder(value: LocalFolderConfig): void {
    this.localFolderState = {
      kind: LocalFolderDraftKind.Configured,
      config: value,
    };
  }
  clearLocalFolder(): void {
    if (this.localFolderState.kind === LocalFolderDraftKind.NotConfigured)
      return;
    this.localFolderState = { kind: LocalFolderDraftKind.NotConfigured };
  }
  localFolderBackupSupported = $state(
    "window" in globalThis && isLocalFolderBackupSupported(),
  );
  vaultArchitecture = $state<VaultArchitecture>(defaultVaultArchitecture());
  draftDeviceMode = $state<DeviceMode>(DeviceMode.Standard);
  draftVaultType = $state(VaultType.Simple);
  draftReplicationType = $state<ReplicationType>(ReplicationType.Personal);
  private oauthSetupPresetState = $state<OAuthSetupPreset>({
    kind: OAuthSetupPresetKind.NotSelected,
  });
  get oauthSetupSelection(): OAuthSetupPreset {
    return this.oauthSetupPresetState;
  }
  selectOauthSetupPreset(value: OAuthFilePreset): void {
    this.oauthSetupPresetState = {
      kind: OAuthSetupPresetKind.Selected,
      preset: value,
    };
  }
  clearOauthSetupPreset(): void {
    this.oauthSetupPresetState = { kind: OAuthSetupPresetKind.NotSelected };
  }
  googleOAuthBusy = $state(false);
  icloudOAuthPreparing = $state(false);
  icloudOAuthReady = $state(false);
  icloudOAuthBusy = $state(false);
}
