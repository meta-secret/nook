import { err, ok, type Result } from "neverthrow";
import type { OAuthFailure } from "$lib/auth/oauth-failure";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import {
  generate_password,
  type AuthProvidersSnapshot,
  type IdentityControlSnapshot,
  type NookEnrollmentIssueInput,
  type NookSecretPage,
  type NookStorageConnectArgs,
  type NookVaultManager,
  type PasswordGenerationOptions,
  type StorageProvider,
} from "$app-wasm";
import {
  LocalFolderHandleKind,
  LocalFolderPresentation,
  LocalFolderProviderConfigurationKind,
  StorageProviderPresentation,
  unselectedVaultScope,
} from "$lib/auth/providers";

/** Named values required by `IdentityControl.deleteAtMount`. */
type MountVaultDeletion = {
  readonly storeId: string;
  readonly provider: StorageProvider;
};
import { IdentityStandingPresentation } from "$lib/components/identity-control/identity-standing";
import { browserLogRuntime } from "$lib/runtime/log";
import { PairedExtensionIdentityJoin } from "$lib/vault/paired-extension-identity-join";
import type { VaultState } from "$lib/vault.svelte";
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
  /** The paired extension's identity join in progress; one at a time. */
  private extensionJoin: Promise<void> | false = false;

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
      const args = this.vault.providerWasmArgs(provider);
      const synced = await this.syncOneMount(args);
      if (synced.isErr()) return err(synced.error);
    }
    log.info("identity log synchronized with mounts");
    const loaded = await this.loadSnapshot();
    if (loaded.isOk()) this.invitePairedExtension();
    return loaded;
  }

  /** With a cloud copy, bring a paired extension that joined only a vault
   * into the identity. Runs beside the sync and shows its failure. */
  private invitePairedExtension(): void {
    if (this.extensionJoin !== false) return;
    const vault = this.vault;
    this.extensionJoin = PairedExtensionIdentityJoin.forPage(vault)
      .run()
      .then((joined) => {
        if (joined.isErr()) vault.errorMsg = vault.t(joined.error);
      })
      .finally(() => {
        this.extensionJoin = false;
      });
  }

  /** Delete a removed vault's files at one identity mount. A local folder
   * this browser cannot open fails rather than being skipped. */
  private async deleteAtMount({
    storeId,
    provider,
  }: MountVaultDeletion): Promise<Result<boolean, VaultStorageFailure>> {
    if (provider.type === "local-folder") {
      const configuration = new StorageProviderPresentation(
        provider,
      ).localFolderProviderConfiguration();
      if (configuration.kind === LocalFolderProviderConfigurationKind.Missing) {
        return err(
          new VaultStorageFailure(
            VaultStorageFailureKind.LocalFolderUnavailable,
          ),
        );
      }
      const handle = new LocalFolderPresentation(
        configuration.config,
      ).localFolderHandle();
      if (handle.kind !== LocalFolderHandleKind.Selected) {
        return err(
          new VaultStorageFailure(
            VaultStorageFailureKind.LocalFolderUnavailable,
          ),
        );
      }
      return this.withManager((manager) =>
        manager.delete_removed_vault_at_local_folder(storeId, handle.handleId),
      );
    }
    const args = this.vault.providerWasmArgs(provider);
    return this.withManager((manager) =>
      manager.delete_removed_vault_at_provider(
        storeId,
        args.mode,
        args.pat,
        args.repo,
      ),
    );
  }

  private async syncOneMount(
    args: NookStorageConnectArgs,
  ): Promise<Result<IdentityActionOutcome, VaultStorageFailure>> {
    const synced = await this.withManager((manager) =>
      manager.sync_identity_log_with_provider(args.mode, args.pat, args.repo),
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

  /**
   * Issue a one-time invite code. The open vault is registered with the
   * identity first, so the code carries its DEK; the invite then reaches
   * every mount before the joiner looks for it there.
   */
  async issueInvite({
    input,
    passphrase,
  }: IdentityInviteIssue): Promise<Result<string, VaultStorageFailure>> {
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
   * the open vault.
   */
  async followOpenVault(): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
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

  /** Open a vault the identity granted this app, from an identity mount. */
  async openVault(
    storeId: string,
  ): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure | OAuthFailure>
  > {
    const providers = this.providersSnapshot();
    const row = await this.withManager(async (manager) =>
      manager.identity_vault_provider(providers, storeId),
    );
    if (row.isErr()) return err(row.error);
    const args = this.vault.providerWasmArgs(row.value);
    const pageSize = this.vault.secretPageSize;
    const page = await this.withManager((manager) =>
      manager.connect_identity_vault(
        args.mode,
        args.pat,
        args.repo,
        storeId,
        pageSize,
      ),
    );
    if (page.isErr()) return err(page.error);
    return this.completeVaultConnect(page.value);
  }

  /** Finish a vault opened through the identity like any connected vault. */
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
      () => vault.refreshPasswordEntriesList(),
      () => vault.hydrateMultiDeviceState(),
    ];
    for (const step of steps) {
      const done = await step();
      if (done.isErr()) return err(done.error);
    }
    const unlocked = vault.markVaultUnlocked();
    if (unlocked.isErr()) return err(unlocked.error);
    this.join = { kind: IdentityJoinKind.Idle };
    vault.startIdleSessionTracking();
    vault.startVaultSync();
    return ok(IdentityActionOutcome.Completed);
  }
}
