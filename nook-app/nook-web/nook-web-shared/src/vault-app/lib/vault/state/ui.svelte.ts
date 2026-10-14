/**
 * The unified workspace: identities are the hub, a vault is opened from an
 * identity, and management pages are grouped by what they act on — the
 * identity (keys, vaults, devices, sync providers, backup passwords, browser
 * settings) or the open vault (imports).
 */
export enum WorkspaceSection {
  Vault = "vault",
  Identities = "identities",
  Keys = "keys",
  Vaults = "vaults",
  Settings = "settings",
  Devices = "devices",
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
      case WorkspaceSection.Vault:
      case WorkspaceSection.Identities:
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

export class VaultUiState {
  workspaceSection = $state<WorkspaceSection>(WorkspaceSection.Vault);
  devicesAccessIdentityProtectionOpen = $state(false);
  /** Survives panel cancellation and navigation until the identity authenticates. */
  devicesAccessIdentityTransitionPending = $state(false);
  /** Identity the Keys page should present first, chosen from an identity card. */
  identityFocus = $state("");
  /** Set by the "New identity" card so the Keys page starts identity creation. */
  identityCreationRequested = $state(false);
  helpOpen = $state(false);
  firstRun = $state<FirstRunStage>(FirstRunStage.Off);
  /** The name given on the first-vault screen, shown by the later steps. */
  firstRunVaultName = $state("");
}
