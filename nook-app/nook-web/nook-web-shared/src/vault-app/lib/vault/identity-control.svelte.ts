import { err, ok, type Result } from "neverthrow";
import type { OAuthFailure } from "$lib/auth/oauth-failure";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import {
  generate_password,
  NookBrowserExtensionMembership,
  type AuthProvidersSnapshot,
  type IdentityControlSnapshot,
  type IdentityVaultView,
  type NookEnrollmentIssueInput,
  type NookSecretPage,
  type NookStorageConnection,
  type NookVaultManager,
  type PasswordGenerationOptions,
  type NookRecoveryWords,
  type NookRecoveryWordsCheck,
  type RecoveryStrength,
  type StorageProvider,
} from "$app-wasm";
import { unselectedVaultScope } from "$lib/auth/providers";

/** A removed vault's files are gone from one mount. */
enum MountDeletion {
  Deleted = "deleted",
}

/** Named values required by `IdentityControl.deleteAtMount`. */
type MountVaultDeletion = {
  readonly storeId: string;
  readonly provider: StorageProvider;
};
import { IdentityStandingPresentation } from "$lib/components/identity-control/identity-standing";
import { browserLogRuntime } from "$lib/runtime/log";
import type { VaultState } from "$lib/vault.svelte";
import { WorkspaceSection } from "$lib/vault/state/ui.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";

const log = browserLogRuntime.createLogger("identity-control");

export enum IdentityControlViewKind {
  Loading = "loading",
  Unavailable = "unavailable",
  Ready = "ready",
}

export type IdentityControlView =
  | { readonly kind: IdentityControlViewKind.Loading }
  | {
      readonly kind: IdentityControlViewKind.Unavailable;
      readonly failure: VaultStorageFailure;
    }
  | {
      readonly kind: IdentityControlViewKind.Ready;
      readonly snapshot: IdentityControlSnapshot;
    };

export enum IdentityJoinKind {
  Idle = "idle",
  Joined = "joined",
}

export type IdentityJoin =
  | { readonly kind: IdentityJoinKind.Idle }
  | {
      readonly kind: IdentityJoinKind.Joined;
      readonly identityLabel: string;
    };

export enum IdentityActionOutcome {
  Completed = "completed",
}

type IdentityManagerOperation<T> = (manager: NookVaultManager) => Promise<T>;

/** Named values required by `IdentityControlModel.issueInvite`. */
export type IdentityInviteIssue = {
  readonly input: NookEnrollmentIssueInput;
  readonly passphrase: string;
};

export type IdentityMemberRename = {
  readonly appId: string;
  readonly label: string;
};

/** Named values required by `IdentityControlModel.beginRecoveryPassphrase`. */
export type RecoveryPassphraseRequest = {
  readonly label: string;
  readonly strength: RecoveryStrength;
};

/** A recovery passphrase the keyring holds, as its list row names it. */
export type RecoveryPassphraseRemoval = {
  readonly id: string;
  readonly label: string;
};

export enum IdentityJoinDecision {
  Approve = "approve",
  Deny = "deny",
}

/** A member's answer to one device asking to join this identity. */
export type IdentityJoinAnswer = {
  readonly appId: string;
  readonly decision: IdentityJoinDecision;
};

const PASSPHRASE_OPTIONS: PasswordGenerationOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  numbers: true,
  symbols: false,
};

/** Identity-level devices, onboarding, and sync-provider mounts. */
export class IdentityControlModel {
  view = $state<IdentityControlView>({ kind: IdentityControlViewKind.Loading });
  join = $state<IdentityJoin>({ kind: IdentityJoinKind.Idle });
  /** Remote provider rows that carry this identity's control log. */
  mounts = $state<StorageProvider[]>([]);
  busy = $state(false);

  constructor(private readonly vault: VaultState) {}

  get snapshot(): IdentityControlSnapshot | false {
    return this.view.kind === IdentityControlViewKind.Ready
      ? this.view.snapshot
      : false;
  }

  /**
   * Apps that can open this identity's vaults. Before the identity log is
   * projected, the open vault's roster is that same set of apps.
   */
  memberCount(vaultRosterCount: number): number {
    const snapshot = this.snapshot;
    return snapshot === false ? vaultRosterCount : snapshot.members.length;
  }

  /**
   * Devices those apps run on: the extension in this browser shares this
   * device. Before the identity log is projected, each roster app counts.
   */
  deviceCount(vaultRosterCount: number): number {
    const snapshot = this.snapshot;
    return snapshot === false ? vaultRosterCount : snapshot.deviceCount;
  }

  /** Whether a browser extension on this device has joined the identity,
   * as nook-core projects it; none has before the log is projected. */
  extensionMembership(): NookBrowserExtensionMembership {
    const snapshot = this.snapshot;
    if (snapshot === false) return NookBrowserExtensionMembership.NotJoined;
    switch (snapshot.extensionOnThisDevice) {
      case "joined":
        return NookBrowserExtensionMembership.Joined;
      case "notJoined":
        return NookBrowserExtensionMembership.NotJoined;
    }
  }

  newPassphrase(): string {
    return generate_password(PASSPHRASE_OPTIONS);
  }

  private providersSnapshot(): AuthProvidersSnapshot {
    return {
      providers: $state.snapshot(this.vault.providers),
      activeVaultStoreId: unselectedVaultScope(),
    };
  }

  private async withManager<T>(
    operation: IdentityManagerOperation<T>,
  ): Promise<Result<T, VaultStorageFailure>> {
    const vault = this.vault;
    return vault.enqueueStorage(async () => {
      const admitted = vault.admitManager();
      if (admitted.isErr()) return err(admitted.error);
      try {
        return ok(await operation(admitted.value));
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
  }

  private report(failure: VaultStorageFailure): void {
    this.vault.errorMsg = this.vault.t(failure.translationKey);
  }

  /** Create or confirm the identity log, then project its current state. */
  async refresh(): Promise<Result<IdentityActionOutcome, VaultStorageFailure>> {
    const ensured = await this.withManager((manager) =>
      manager.ensure_identity_control_log(),
    );
    if (ensured.isErr()) {
      this.view = {
        kind: IdentityControlViewKind.Unavailable,
        failure: ensured.error,
      };
      return err(ensured.error);
    }
    return this.loadSnapshot();
  }

  /** Another keyring is now in use: the prior one's log, with its vaults
   * and mounts, no longer describes this browser's keyring. */
  forgetIdentity(): void {
    this.view = { kind: IdentityControlViewKind.Loading };
    this.mounts = [];
  }

  /** Project the identity log this app already holds, without creating one. */
  async loadSnapshot(): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
    const providers = this.providersSnapshot();
    const loaded = await this.withManager(async (manager) => {
      const snapshot = await manager.identity_control_snapshot(providers);
      const mounts = await manager.identity_replication_providers(providers);
      return { snapshot, mounts: mounts.providers };
    });
    if (loaded.isErr()) {
      this.view = {
        kind: IdentityControlViewKind.Unavailable,
        failure: loaded.error,
      };
      return err(loaded.error);
    }
    this.view = {
      kind: IdentityControlViewKind.Ready,
      snapshot: loaded.value.snapshot,
    };
    this.mounts = loaded.value.mounts;
    return ok(IdentityActionOutcome.Completed);
  }

  /** Record new mounts, then union the identity log with every mount. */
  async syncWithMounts(): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
    const providers = this.providersSnapshot();
    const mounted = await this.withManager(async (manager) => {
      const snapshot = await manager.identity_control_snapshot(providers);
      if (new IdentityStandingPresentation(snapshot).isMember()) {
        await manager.record_identity_provider_mounts(providers);
      }
      return (await manager.identity_replication_providers(providers))
        .providers;
    });
    if (mounted.isErr()) return err(mounted.error);
    for (const provider of mounted.value) {
      const synced = await this.syncOneMount(provider);
      if (synced.isErr()) return err(synced.error);
    }
    log.info("identity log synchronized with mounts");
    return this.loadSnapshot();
  }

  /** Delete a removed vault's files at one identity mount: a local folder
   * through its own handle, any other provider through its connection. */
  private async deleteAtMount({
    storeId,
    provider,
  }: MountVaultDeletion): Promise<Result<MountDeletion, VaultStorageFailure>> {
    const stored = provider.provider;
    switch (stored.type) {
      case "local-folder": {
        const deleted = await this.withManager((manager) =>
          manager.delete_removed_vault_at_local_folder(
            storeId,
            stored.handleId,
          ),
        );
        return deleted.map(() => MountDeletion.Deleted);
      }
      case "local":
      case "github":
      case "oauth-file":
      case "s3": {
        const args = this.vault.providerWasmArgs(provider);
        const deleted = await this.withManager((manager) =>
          manager.delete_removed_vault_at_provider(storeId, args),
        );
        return deleted.map(() => MountDeletion.Deleted);
      }
    }
  }

  /** Union the identity log with one mount: a local folder through its own
   * handle, any other provider through the prepared storage. */
  private async syncOneMount(
    provider: StorageProvider,
  ): Promise<Result<IdentityActionOutcome, VaultStorageFailure>> {
    const stored = provider.provider;
    if (stored.type === "local-folder") {
      const synced = await this.withManager((manager) =>
        manager.sync_identity_log_with_local_folder(stored.handleId),
      );
      return synced.map(() => IdentityActionOutcome.Completed);
    }
    let args: NookStorageConnection;
    try {
      args = this.vault.providerWasmArgs(provider);
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    const synced = await this.withManager((manager) =>
      manager.sync_identity_log_with_provider(args),
    );
    return synced.map(() => IdentityActionOutcome.Completed);
  }

  private async act<T>(
    operation: IdentityManagerOperation<T>,
  ): Promise<Result<IdentityActionOutcome, VaultStorageFailure>> {
    if (this.busy) return ok(IdentityActionOutcome.Completed);
    this.busy = true;
    this.vault.errorMsg = "";
    try {
      const done = await this.withManager(operation);
      if (done.isErr()) {
        this.report(done.error);
        return err(done.error);
      }
      const synced = await this.syncWithMounts();
      if (synced.isErr()) this.report(synced.error);
      return synced;
    } finally {
      this.busy = false;
    }
  }

  /** The first vault the identity granted this browser that it does not
   * hold yet, which opens through one of the identity's providers. */
  grantedVaultElsewhere(): IdentityVaultView | false {
    const snapshot = this.snapshot;
    if (snapshot === false) return false;
    const local = this.vault.localVaults.map((entry) => entry.storeId);
    const [away] = snapshot.vaults.filter(
      (entry) =>
        entry.grantedToCurrentInstallation && !local.includes(entry.storeId),
    );
    return away ? away : false;
  }

  /** What an identity page shows when it opens: with a vault open, the log
   * is created or confirmed; without one, only the log it has is read. */
  async showPage(): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
    return this.vault.isAuthenticated ? this.refresh() : this.loadSnapshot();
  }

  /**
   * Issue a one-time invite code. Inviting uses the identity, so its log
   * exists from here on. The open vault is registered with the identity
   * first, so the code carries its DEK; the invite then reaches every mount
   * before the joiner looks for it there.
   */
  async issueInvite({
    input,
    passphrase,
  }: IdentityInviteIssue): Promise<Result<string, VaultStorageFailure>> {
    const ensured = await this.refresh();
    if (ensured.isErr()) return err(ensured.error);
    const reconciled = await this.reconcileOpenVault();
    if (reconciled.isErr()) return err(reconciled.error);
    const issued = await this.withManager((manager) =>
      manager.issue_identity_invite_code(input, passphrase),
    );
    if (issued.isErr()) return err(issued.error);
    const synced = await this.syncWithMounts();
    if (synced.isErr()) return err(synced.error);
    log.info("identity invite issued");
    return ok(issued.value);
  }

  async revoke(
    appId: string,
  ): Promise<Result<IdentityActionOutcome, VaultStorageFailure>> {
    const revoked = await this.act((manager) =>
      manager.revoke_identity_member(appId),
    );
    if (revoked.isErr()) return revoked;
    const refreshed = await this.vault.refreshSecretsFromSession();
    if (refreshed.isErr()) return err(refreshed.error);
    return revoked;
  }

  rename({ appId, label }: IdentityMemberRename) {
    return this.act((manager) => manager.rename_identity_member(appId, label));
  }

  /**
   * Generate the words of a new recovery passphrase, to show once. Adding
   * one uses the keyring, so its log exists from here on, and the open
   * vault is registered first, so the recovery key receives its DEK. Rust
   * keeps the pending passphrase; nothing is written until it is confirmed.
   */
  async beginRecoveryPassphrase({
    label,
    strength,
  }: RecoveryPassphraseRequest): Promise<
    Result<NookRecoveryWords, VaultStorageFailure>
  > {
    const ensured = await this.refresh();
    if (ensured.isErr()) return err(ensured.error);
    const reconciled = await this.reconcileOpenVault();
    if (reconciled.isErr()) return err(reconciled.error);
    return this.withManager((manager) =>
      manager.begin_recovery_passphrase(label, strength),
    );
  }

  /**
   * Check the words typed back. Only when Rust accepts them is the
   * passphrase recorded; it then reaches every mount, where a new device
   * finds it. Accepted words are saved even when that copy fails: the list
   * shows the passphrase, and the failed copy is reported on its own so
   * the next sync can carry it. A slip is returned for the form to show.
   */
  async confirmRecoveryPassphrase(
    words: string,
  ): Promise<Result<NookRecoveryWordsCheck, VaultStorageFailure>> {
    const checked = await this.withManager((manager) =>
      manager.confirm_recovery_passphrase(words),
    );
    if (checked.isErr()) return checked;
    switch (checked.value.state) {
      case "accepted": {
        log.info("recovery passphrase added");
        const synced = await this.syncWithMounts();
        if (synced.isOk()) return checked;
        await this.loadSnapshot();
        this.report(synced.error);
        return checked;
      }
      case "empty":
      case "unknownWords":
      case "wrongWordCount":
      case "wrongWords":
        return checked;
    }
  }

  /** Drop the pending recovery passphrase and its words. It waits its turn
   * like every manager call: a flow closing while its accepted words still
   * reach the mounts must not touch the manager under that sync. */
  async cancelRecoveryPassphrase(): Promise<void> {
    const cancelled = await this.withManager(async (manager) =>
      manager.cancel_recovery_passphrase(),
    );
    if (cancelled.isErr()) log.warn("recovery passphrase cancel failed");
  }

  /** Remove a recovery passphrase: its words stop adding devices, and every
   * vault rotates before its next write. */
  async removeRecoveryPassphrase({
    id,
    label,
  }: RecoveryPassphraseRemoval): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
    const removed = await this.act((manager) =>
      manager.remove_recovery_passphrase(id),
    );
    if (removed.isErr()) return removed;
    const request: Parameters<typeof this.vault.t>[0] = {
      key: I18N_KEYS.RecoveryPassphraseRemoved,
      replacements: { label },
    };
    this.vault.showSuccess(this.vault.t(request));
    return removed;
  }

  /**
   * Answer a device asking to join this identity. Rust approves it with
   * every vault's DEK, or denies it; the answer then reaches every mount,
   * where the asking device reads it.
   */
  async answerJoin({
    appId,
    decision,
  }: IdentityJoinAnswer): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
    const answered = await this.act((manager) => {
      switch (decision) {
        case IdentityJoinDecision.Approve:
          return manager.approve_identity_join(appId);
        case IdentityJoinDecision.Deny:
          return manager.deny_identity_join(appId);
      }
    });
    if (answered.isErr()) return answered;
    const toast =
      decision === IdentityJoinDecision.Approve
        ? I18N_KEYS.IdentityControlJoinRequestApproved
        : I18N_KEYS.IdentityControlJoinRequestDenied;
    this.vault.showSuccess(this.vault.t(toast));
    return answered;
  }

  /** Delete a vault from the identity on every device. The removal reaches
   * the other devices through the identity mounts; this browser's copy goes
   * at once. */
  async deleteVaultEverywhere(
    storeId: string,
  ): Promise<Result<IdentityActionOutcome, VaultStorageFailure>> {
    const deleted = await this.act((manager) =>
      manager.delete_vault_everywhere(storeId),
    );
    if (deleted.isErr()) return deleted;
    // The identity log now records the removal everywhere; the vault's
    // encrypted files go from every mount too.
    const mounts = await this.withManager(
      async (manager) =>
        (await manager.identity_replication_providers(this.providersSnapshot()))
          .providers,
    );
    if (mounts.isErr()) {
      this.report(mounts.error);
      return err(mounts.error);
    }
    for (const provider of mounts.value) {
      const deletion: MountVaultDeletion = { storeId, provider };
      const removed = await this.deleteAtMount(deletion);
      if (removed.isErr()) {
        this.report(removed.error);
        return err(removed.error);
      }
    }
    const refreshed = await this.vault.refreshLocalVaultCatalog();
    if (refreshed.isErr()) {
      this.vault.errorMsg = this.vault.t(refreshed.error.translationKey);
      return err(refreshed.error);
    }
    this.vault.showSuccess(this.vault.t(I18N_KEYS.ToastsVaultDeleted));
    return deleted;
  }

  /** Drop the identity mount of a provider row the user removed. */
  async unmount(
    provider: StorageProvider,
  ): Promise<Result<IdentityActionOutcome, VaultStorageFailure>> {
    const row = $state.snapshot(provider);
    const removed = await this.withManager((manager) =>
      manager.remove_identity_provider_mount(row),
    );
    if (removed.isErr()) return err(removed.error);
    return removed.value ? this.syncWithMounts() : this.loadSnapshot();
  }

  /** Bring the open vault in line with identity revocations and key epochs. */
  async reconcileOpenVault(): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
    const changed = await this.withManager((manager) =>
      manager.reconcile_open_vault_with_identity_log(),
    );
    if (changed.isErr()) return err(changed.error);
    if (!changed.value) return ok(IdentityActionOutcome.Completed);
    return this.syncWithMounts();
  }

  /**
   * After a vault opens or syncs: create or confirm the identity log, union
   * it with every mount, then apply identity revocations and key epochs to
   * the open vault. With no vault open, looking at the identity changes
   * nothing: the log it has is projected, and a fresh identity keeps none
   * until it is used, so an approved join can still adopt it.
   */
  async followOpenVault(): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
    if (!this.vault.isAuthenticated) return this.loadSnapshot();
    const refreshed = await this.refresh();
    if (refreshed.isErr()) return refreshed;
    const synced = await this.syncWithMounts();
    if (synced.isErr()) return synced;
    return this.reconcileOpenVault();
  }

  /** This app signed itself into an identity with an invite: load its
   * mounts and the vaults the invite granted. */
  async followInviteJoin(
    identityLabel: string,
  ): Promise<Result<IdentityActionOutcome, VaultStorageFailure>> {
    this.join = { kind: IdentityJoinKind.Joined, identityLabel };
    const providerLoad: Parameters<typeof this.vault.loadProviders>[0] = {
      ensureLocalRow: false,
    };
    const loaded = await this.vault.loadProviders(providerLoad);
    if (loaded.isErr()) return err(loaded.error);
    return this.syncWithMounts();
  }

  /** Open a vault the identity granted this app, from an identity mount.
   * The keyring is busy until the vault is open, so its rows and Open stay
   * disabled: a second press would queue another open that lands after
   * whatever the person did next, such as switching to another vault. */
  async openVault(
    storeId: string,
  ): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure | OAuthFailure>
  > {
    this.busy = true;
    try {
      const opened = await this.openGrantedVault(storeId);
      if (opened.isErr()) {
        const failure = opened.error;
        log.warn(
          `granted vault open failed: ${failure.kind} (${failure.translationKey}${failure instanceof VaultStorageFailure ? `, ${failure.cause}` : ""})`,
        );
      }
      return opened;
    } finally {
      this.busy = false;
    }
  }

  private async openGrantedVault(
    storeId: string,
  ): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure | OAuthFailure>
  > {
    const providers = this.providersSnapshot();
    const row = await this.withManager(async (manager) =>
      manager.identity_vault_provider(providers, storeId),
    );
    if (row.isErr()) return err(row.error);
    const pageSize = this.vault.secretPageSize;
    // Rust reads the vault through the row: a local folder's records come
    // from the folder, any other row opens its connection.
    const page = await this.withManager((manager) =>
      manager.connect_identity_vault_by_row(row.value, storeId, pageSize),
    );
    if (page.isErr()) return err(page.error);
    return this.completeVaultConnect(page.value);
  }

  /** Finish a vault opened through the identity like any connected vault,
   * and show it: Open vault on the keyrings page lands in the vault. */
  private async completeVaultConnect(
    page: NookSecretPage,
  ): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure | OAuthFailure>
  > {
    const vault = this.vault;
    const connected: Parameters<typeof vault.applyConnectedSecretPage>[0] = {
      page,
      query: "",
    };
    vault.applyConnectedSecretPage(connected);
    const steps = [
      () => vault.refreshLocalVaultCatalog(),
      () => vault.syncActiveVaultStoreIdToAuth(),
      () => vault.hydrateMultiDeviceState(),
    ];
    for (const step of steps) {
      const done = await step();
      if (done.isErr()) return err(done.error);
    }
    const unlocked = vault.markVaultUnlocked();
    if (unlocked.isErr()) return err(unlocked.error);
    this.join = { kind: IdentityJoinKind.Idle };
    vault.openSection(WorkspaceSection.Vault);
    vault.startIdleSessionTracking();
    vault.startVaultSync();
    return ok(IdentityActionOutcome.Completed);
  }
}
