import {
  isLocalFolderBackupSupported,
  type NookLocalVaultEntry,
  type StoreId,
  type VaultRecoverySummary,
} from '$app-wasm'
import {
  DEFAULT_GITHUB_REPO,
  LOCAL_PROVIDER_TYPE,
  type LocalFolderConfig,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from '$lib/auth-providers'
import {
  defaultVaultArchitecture,
  DeviceMode,
  ReplicationType,
  VaultType,
  type VaultArchitecture,
} from '$lib/vault-architecture'
enum ActiveVaultKind {
  Closed = 'closed',
  Open = 'open',
}

type ActiveVault =
  | { kind: ActiveVaultKind.Closed }
  | { kind: ActiveVaultKind.Open; storeId: StoreId }
enum LoginVaultSelectionKind {
  NotSelected = 'not-selected',
  Selected = 'selected',
}

type LoginVaultSelection =
  | { kind: LoginVaultSelectionKind.NotSelected }
  | { kind: LoginVaultSelectionKind.Selected; storeId: StoreId }
export enum LoginSetupKind {
  Inactive = 'inactive',
  Active = 'active',
}

export type LoginSetup =
  | { kind: LoginSetupKind.Inactive }
  | { kind: LoginSetupKind.Active; providerType: StorageProviderType }

export enum StagedRemoteStorageKind {
  Unavailable = 'unavailable',
  Available = 'available',
}

export type StagedRemoteStorage =
  | { kind: StagedRemoteStorageKind.Unavailable }
  | {
      kind: StagedRemoteStorageKind.Available
      args: [string, string, string]
    }

export enum LocalProviderLookupKind {
  Missing = 'missing',
  Found = 'found',
}

export type LocalProviderLookup =
  | { kind: LocalProviderLookupKind.Missing }
  | { kind: LocalProviderLookupKind.Found; provider: StorageProvider }
enum RecoveryDiscoveryKind {
  NotFound = 'not-found',
  Found = 'found',
}

type RecoveryDiscovery =
  | { kind: RecoveryDiscoveryKind.NotFound }
  | { kind: RecoveryDiscoveryKind.Found; summary: VaultRecoverySummary }
enum OAuthFileDraftKind {
  NotConfigured = 'not-configured',
  Configured = 'configured',
}

type OAuthFileDraft =
  | { kind: OAuthFileDraftKind.NotConfigured }
  | { kind: OAuthFileDraftKind.Configured; config: OAuthFileConfig }
enum LocalFolderDraftKind {
  NotConfigured = 'not-configured',
  Configured = 'configured',
}

type LocalFolderDraft =
  | { kind: LocalFolderDraftKind.NotConfigured }
  | { kind: LocalFolderDraftKind.Configured; config: LocalFolderConfig }
enum OAuthSetupPresetKind {
  NotSelected = 'not-selected',
  Selected = 'selected',
}

type OAuthSetupPreset =
  | { kind: OAuthSetupPresetKind.NotSelected }
  | { kind: OAuthSetupPresetKind.Selected; preset: OAuthFilePreset }
export class VaultProviderState {
  providers = $state.raw<StorageProvider[]>([])
  providersLoaded = $state(false)
  /** Locally cached vaults on this browser (metadata only). */
  localVaults = $state<NookLocalVaultEntry[]>([])
  /** Active vault store_id — sync providers and local blob are scoped to this. */
  private activeVaultStoreState = $state<ActiveVault>({
    kind: ActiveVaultKind.Closed,
  })
  get activeVaultStoreId(): StoreId | void {
    if (this.activeVaultStoreState.kind === ActiveVaultKind.Open)
      return this.activeVaultStoreState.storeId
    return
  }
  get hasActiveVaultStore(): boolean {
    return this.activeVaultStoreState.kind === ActiveVaultKind.Open
  }
  requireActiveVaultStoreId(): StoreId {
    if (this.activeVaultStoreState.kind === ActiveVaultKind.Open)
      return this.activeVaultStoreState.storeId
    throw new Error('Active vault store is required')
  }
  set activeVaultStoreId(value: StoreId) {
    this.activeVaultStoreState = { kind: ActiveVaultKind.Open, storeId: value }
  }
  clearActiveVaultStore(): void {
    this.activeVaultStoreState = { kind: ActiveVaultKind.Closed }
  }
  /** Login gate: user picked a vault but has not unlocked yet. */
  private selectedLoginVaultStoreState = $state<LoginVaultSelection>({
    kind: LoginVaultSelectionKind.NotSelected,
  })
  get selectedLoginVaultStoreId(): StoreId | void {
    if (
      this.selectedLoginVaultStoreState.kind ===
      LoginVaultSelectionKind.Selected
    )
      return this.selectedLoginVaultStoreState.storeId
    return
  }
  get hasSelectedLoginVaultStore(): boolean {
    return (
      this.selectedLoginVaultStoreState.kind ===
      LoginVaultSelectionKind.Selected
    )
  }
  set selectedLoginVaultStoreId(value: StoreId) {
    this.selectedLoginVaultStoreState = {
      kind: LoginVaultSelectionKind.Selected,
      storeId: value,
    }
  }
  clearSelectedLoginVaultStore(): void {
    this.selectedLoginVaultStoreState = {
      kind: LoginVaultSelectionKind.NotSelected,
    }
  }
  /** True when the active vault blob exists in IndexedDB. */
  localVaultPresent = $state(false)
  localLoginPrepared = $state(false)
  private loginSetupState = $state<LoginSetup>({
    kind: LoginSetupKind.Inactive,
  })
  get loginSetup(): LoginSetup {
    return this.loginSetupState
  }
  activateLoginSetup(value: StorageProviderType): void {
    this.loginSetupState = { kind: LoginSetupKind.Active, providerType: value }
  }
  clearLoginSetup(): void {
    this.loginSetupState = { kind: LoginSetupKind.Inactive }
  }
  loginRequiresExistingVault = $state(false)
  private recoverySummaryState = $state<RecoveryDiscovery>({
    kind: RecoveryDiscoveryKind.NotFound,
  })
  get existingVaultRecoverySummary(): VaultRecoverySummary | void {
    if (this.recoverySummaryState.kind === RecoveryDiscoveryKind.Found)
      return this.recoverySummaryState.summary
    return
  }
  set existingVaultRecoverySummary(value: VaultRecoverySummary) {
    this.recoverySummaryState = {
      kind: RecoveryDiscoveryKind.Found,
      summary: value,
    }
  }
  clearExistingVaultRecoverySummary(): void {
    this.recoverySummaryState = { kind: RecoveryDiscoveryKind.NotFound }
  }
  addProviderOpen = $state(false)

  storageMode = $state<StorageProviderType>(LOCAL_PROVIDER_TYPE)
  githubPat = $state('')
  githubRepo = $state(DEFAULT_GITHUB_REPO)
  private oauthFileState = $state.raw<OAuthFileDraft>({
    kind: OAuthFileDraftKind.NotConfigured,
  })
  get oauthFile(): OAuthFileConfig | void {
    if (this.oauthFileState.kind === OAuthFileDraftKind.Configured)
      return this.oauthFileState.config
    return
  }
  set oauthFile(value: OAuthFileConfig) {
    this.oauthFileState = {
      kind: OAuthFileDraftKind.Configured,
      config: value,
    }
  }
  clearOauthFile(): void {
    this.oauthFileState = { kind: OAuthFileDraftKind.NotConfigured }
  }
  private localFolderState = $state.raw<LocalFolderDraft>({
    kind: LocalFolderDraftKind.NotConfigured,
  })
  get localFolder(): LocalFolderConfig | void {
    if (this.localFolderState.kind === LocalFolderDraftKind.Configured)
      return this.localFolderState.config
    return
  }
  set localFolder(value: LocalFolderConfig) {
    this.localFolderState = {
      kind: LocalFolderDraftKind.Configured,
      config: value,
    }
  }
  clearLocalFolder(): void {
    this.localFolderState = { kind: LocalFolderDraftKind.NotConfigured }
  }
  localFolderBackupSupported = $state(
    'window' in globalThis && isLocalFolderBackupSupported(),
  )
  vaultArchitecture = $state<VaultArchitecture>(defaultVaultArchitecture())
  draftDeviceMode = $state<DeviceMode>(DeviceMode.Standard)
  draftVaultType = $state(VaultType.Simple)
  draftReplicationType = $state<ReplicationType>(ReplicationType.Personal)
  private oauthSetupPresetState = $state<OAuthSetupPreset>({
    kind: OAuthSetupPresetKind.NotSelected,
  })
  get oauthSetupPreset(): OAuthFilePreset | void {
    if (this.oauthSetupPresetState.kind === OAuthSetupPresetKind.Selected)
      return this.oauthSetupPresetState.preset
    return
  }
  set oauthSetupPreset(value: OAuthFilePreset) {
    this.oauthSetupPresetState = {
      kind: OAuthSetupPresetKind.Selected,
      preset: value,
    }
  }
  clearOauthSetupPreset(): void {
    this.oauthSetupPresetState = { kind: OAuthSetupPresetKind.NotSelected }
  }
  googleOAuthBusy = $state(false)
  icloudOAuthPreparing = $state(false)
  icloudOAuthReady = $state(false)
  icloudOAuthBusy = $state(false)
}
