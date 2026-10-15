/**
 * The unified workspace: identities are the hub, a vault is opened from an
 * identity, and management pages are grouped by what they act on — the
 * identity (keys, vaults, devices, sync providers, backup passwords, browser
 * settings) or the open vault (imports).
 */
export enum WorkspaceSection {
  Vault = "vault",
  Identities = "identities",
  /** The identity's page: what it has (devices, vaults, copies, sign-in). */
  Overview = "overview",
  Keys = "keys",
  Vaults = "vaults",
  Settings = "settings",
  Devices = "devices",
  /** Invite another phone or computer into the identity, then approve it. */
  AddDevice = "add-device",
  Sync = "sync",
  Passwords = "passwords",
  Import = "import",
}

export enum ManageSectionScope {
  Identity = "identity",
  Vault = "vault",
  None = "none",
}

/** Which management group a workspace section belongs to. */
export class WorkspaceSectionScope {
  constructor(private readonly section: WorkspaceSection) {}

  get scope(): ManageSectionScope {
    switch (this.section) {
      case WorkspaceSection.Keys:
      case WorkspaceSection.Vaults:
      case WorkspaceSection.Devices:
      case WorkspaceSection.Sync:
      case WorkspaceSection.Settings:
      case WorkspaceSection.Passwords:
        return ManageSectionScope.Identity;
      case WorkspaceSection.Import:
        return ManageSectionScope.Vault;
      // The overview opens on the hub beside the identity's card; adding a
      // device is a focused flow of its own. Neither is a management page.
      case WorkspaceSection.Vault:
      case WorkspaceSection.Identities:
      case WorkspaceSection.Overview:
      case WorkspaceSection.AddDevice:
        return ManageSectionScope.None;
    }
  }
}

/** Where a first-vault setup stands after its name was given. */
export enum FirstRunStage {
  /** No first-vault setup in progress. */
  Off = "off",
  /** The vault waits for this browser's passkey or PIN. */
  Protect = "protect",
  /** The vault exists; offer to back up its identity. */
  Backup = "backup",
}

/** Where creating another identity stands. */
export enum NewIdentityStage {
  /** No identity being created. */
  Off = "off",
  /** The new identity is being named. */
  Name = "name",
  /** The new identity waits for its own passkey. */
  Key = "key",
  /** The identity exists; offer its first vault. */
  Ready = "ready",
}

export class VaultUiState {
  workspaceSection = $state<WorkspaceSection>(WorkspaceSection.Vault);
  /** Survives panel cancellation and navigation until the identity authenticates. */
  identityTransitionPending = $state(false);
  helpOpen = $state(false);
  firstRun = $state<FirstRunStage>(FirstRunStage.Off);
  /** The name given on the first-vault screen, shown by the later steps. */
  firstRunVaultName = $state("");
  newIdentity = $state<NewIdentityStage>(NewIdentityStage.Off);
  /** The name given to the identity being created. */
  newIdentityName = $state("");
  /** The vault opened beside its identity card. It stays open while the
   * vault unlocks, so unlocking does not go into the vault by itself. */
  vaultPanelStoreId = $state("");
  /** Importing a vault from a sync provider ("Import from sync provider"
   * under New vault). The unlocked workspace sets it before locking, so
   * the locked identities page continues the import on the card. */
  vaultImportOpen = $state(false);
}
