import type { NookStorageConnection } from "$app-wasm";
import {
  begin_provider_draft,
  is_local_folder_backup_supported,
  LocalVaultPresence,
  provider_draft_kind,
  type NookLocalVaultEntry,
  type FilingIdentity,
  type ProviderVaultSummary,
  type StoreId,
} from "$app-wasm";
import type {
  ProviderDraft,
  ProviderKind,
  StorageProvider,
} from "$lib/auth/providers";
import { ProviderSetupKinds } from "$lib/vault/provider-setup-kinds";
import {
  default_vault_architecture,
  DeviceMode,
  ReplicationType,
  VaultType,
  type VaultArchitecture,
} from "$lib/vault/architecture-model";
import { LocalLoginPreparationState } from "./local-login-preparation-state";
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
  | { kind: LoginSetupKind.Active; providerKind: ProviderKind };

export enum StagedRemoteStorageKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type StagedRemoteStorage =
  | { kind: StagedRemoteStorageKind.Unavailable }
  | {
      kind: StagedRemoteStorageKind.Available;
      args: NookStorageConnection;
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
/** The keyrings a provider being recovered from keeps, one card each,
 * with the vaults filed under them. */
export type RemoteVaultChoiceList = {
  readonly vaults: readonly ProviderVaultSummary[];
  readonly identities: readonly FilingIdentity[];
};

const NO_REMOTE_VAULT_CHOICES: RemoteVaultChoiceList = {
  vaults: [],
  identities: [],
};

export class RemoteVaultChoices {
  static readonly NONE = new RemoteVaultChoices(NO_REMOTE_VAULT_CHOICES);
  readonly vaults: readonly ProviderVaultSummary[];
  readonly identities: readonly FilingIdentity[];
  constructor({ vaults, identities }: RemoteVaultChoiceList) {
    this.vaults = vaults;
    this.identities = identities;
  }
}

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
  activateLoginSetup(value: ProviderKind): void {
    this.loginSetupState = { kind: LoginSetupKind.Active, providerKind: value };
  }
  clearLoginSetup(): void {
    this.loginSetupState = { kind: LoginSetupKind.Inactive };
  }
  /** Recovering a keyring from a sync provider: Connect lists its keyrings. */
  keyringRecoveryActive = $state(false);
  /** The keyrings the provider being recovered from keeps, with their
   * vaults. */
  remoteVaultChoices = $state.raw<RemoteVaultChoices>(RemoteVaultChoices.NONE);
  addProviderOpen = $state(false);

  /** The provider being set up or in use: the one Rust-owned draft. Its
   * credentials stay in memory only, and every transition replaces it. */
  private draftState = $state.raw<ProviderDraft>(
    begin_provider_draft(ProviderSetupKinds.THIS_BROWSER),
  );
  get providerDraft(): ProviderDraft {
    return this.draftState;
  }
  /** Adopt a draft a Rust constructor or transition returned. */
  stageProviderDraft(draft: ProviderDraft): void {
    this.draftState = draft;
  }
  /** This browser's own store: no provider and no credential. */
  useThisBrowser(): void {
    this.draftState = begin_provider_draft(ProviderSetupKinds.THIS_BROWSER);
  }
  /** Lock: the draft keeps which provider it is and nothing it gathered. */
  forgetDraftCredentials(): void {
    this.draftState = begin_provider_draft(
      provider_draft_kind(this.draftState),
    );
  }
  /** Whether this browser holds the active vault, as Rust requests take it. */
  get localVaultPresence(): LocalVaultPresence {
    switch (this.localVaultPresent) {
      case true:
        return LocalVaultPresence.Present;
      case false:
        return LocalVaultPresence.Absent;
    }
  }
  localFolderBackupSupported = $state(
    "window" in globalThis && is_local_folder_backup_supported(),
  );
  vaultArchitecture = $state<VaultArchitecture>(default_vault_architecture());
  draftDeviceMode = $state<DeviceMode>(DeviceMode.Standard);
  draftVaultType = $state(VaultType.Simple);
  draftReplicationType = $state<ReplicationType>(ReplicationType.Personal);
  clearIdentityProviderSession(): void {
    this.providers = [];
    this.providersLoaded = false;
    this.clearActiveVaultStore();
    this.clearSelectedLoginVaultStore();
    this.localLoginPreparation = LocalLoginPreparationState.Idle;
    this.clearLoginSetup();
    this.keyringRecoveryActive = false;
    this.remoteVaultChoices = RemoteVaultChoices.NONE;
    this.addProviderOpen = false;
    this.useThisBrowser();
    this.googleOAuthBusy = false;
    this.icloudOAuthPreparing = false;
    this.icloudOAuthReady = false;
    this.icloudOAuthBusy = false;
  }
  googleOAuthBusy = $state(false);
  icloudOAuthPreparing = $state(false);
  icloudOAuthReady = $state(false);
  icloudOAuthBusy = $state(false);
}
