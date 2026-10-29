/**
 * The unified workspace: identities are the hub, a vault is opened from an
 * identity, and management pages are grouped by what they act on — the
 * identity (keys, vaults, devices, sync providers, backup passwords, browser
 * settings) or the open vault (imports).
 */

import { UnlockReturn } from "$lib/app/unlock-return";
import {
  EmptyVaultReplacementKind,
  type EmptyVaultReplacementPlan,
} from "$lib/vault/provider-vaults";
import {
  IdentityDirectoryLoadKind,
  type IdentityDirectoryLoadState,
} from "$lib/components/devices-access/identity-directory-view";
import {
  FirstRunJoinKind,
  IdentityJoinWaitKind,
  type FirstRunJoin,
  type IdentityJoinWait,
} from "$lib/vault/identity-join-wait";

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

/** Where first-run setup stands. The identity is settled before any vault:
 * the passkey makes this browser's key, the sync provider shows the
 * identities that key belongs to or may join, and only a new identity gets
 * a first vault. */
export enum FirstRunStage {
  /** No first-run setup in progress. */
  Off = "off",
  /** The identity waits for this browser's passkey or PIN. */
  Protect = "protect",
  /** The key exists: sign in to a sync provider and pick an identity on it. */
  Sync = "sync",
  /** A new identity is being named, on the sync provider or this browser. */
  Name = "name",
  /** The new identity exists on this browser: create its first vault, or
   * leave it without one for now. */
  Vault = "vault",
  /** This browser asked to join an identity; one of its devices answers. */
  Joining = "joining",
  /** The new identity's first vault exists; it connects the sync provider
   * signed in to during setup. */
  Connect = "connect",
}

/** Whether joining with an invite waits for an iCloud sign-in. */
export enum JoinICloudSignIn {
  /** No invite asked for iCloud. */
  NotNeeded = "not-needed",
  /** The invite is kept in iCloud and this browser is not signed in yet. */
  Needed = "needed",
}

/** Where a new identity created during setup is kept. */
export enum FirstRunPlace {
  ThisBrowser = "this-browser",
  SyncProvider = "sync-provider",
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
  /** The access check page is open, unlocked or not. */
  accessCheckOpen = $state(false);
  firstRun = $state<FirstRunStage>(FirstRunStage.Off);
  /** The name given to a new identity during setup; its first vault takes
   * it too. */
  firstRunVaultName = $state("");
  /** An invite kept in iCloud asked this browser to sign in to iCloud. */
  joinICloudSignIn = $state<JoinICloudSignIn>(JoinICloudSignIn.NotNeeded);
  /** Where a new identity created during setup is kept. */
  firstRunPlace = $state<FirstRunPlace>(FirstRunPlace.ThisBrowser);
  /** The identity this browser asked to join during setup. */
  firstRunJoin = $state.raw<FirstRunJoin>({ kind: FirstRunJoinKind.None });
  newIdentity = $state<NewIdentityStage>(NewIdentityStage.Off);
  /** The name given to the identity being created. */
  newIdentityName = $state("");
  /** The vault opened beside its identity card. It stays open while the
   * vault unlocks, so unlocking does not go into the vault by itself. */
  vaultPanelStoreId = $state("");
  /** The deep link a panel unlock interrupted, for Open vault to return to. */
  readonly unlockReturn = new UnlockReturn();
  /** Importing a vault from a sync provider ("Import from sync provider"
   * under New vault). The unlocked workspace sets it before locking, so
   * the locked identities page continues the import on the card. */
  vaultImportOpen = $state(false);
  /** An empty vault the user chose to swap for one a provider holds. It
   * survives the lock that starts the import, then goes once the chosen
   * vault is open. */
  emptyVaultReplacement = $state<EmptyVaultReplacementPlan>({
    kind: EmptyVaultReplacementKind.Idle,
  });
  forgetEmptyVaultReplacement(): void {
    this.emptyVaultReplacement = { kind: EmptyVaultReplacementKind.Idle };
  }
  /** The identity directory as last read, shared by every identities hub:
   * the workspace that replaces the login screen as a vault opens shows the
   * same cards at once and reads them again behind them. */
  identityDirectory = $state<IdentityDirectoryLoadState>({
    kind: IdentityDirectoryLoadKind.Loading,
  });
  /** A join to an identity that waits for the fresh key it asks with: the
   * device protection gate, or a new local identity's key ceremony. */
  identityJoin = $state<IdentityJoinWait>({ kind: IdentityJoinWaitKind.Idle });
}
