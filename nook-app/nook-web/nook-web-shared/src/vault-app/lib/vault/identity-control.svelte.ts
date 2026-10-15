import { err, ok, type Result } from "neverthrow";
import type { OAuthFailure } from "$lib/auth/oauth-failure";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import {
  generate_password,
  type AuthProvidersSnapshot,
  type IdentityControlSnapshot,
  type NookSecretPage,
  type NookStorageConnectArgs,
  type NookVaultManager,
  type PasswordGenerationOptions,
  type StorageProvider,
} from "$app-wasm";
import { unselectedVaultScope } from "$lib/auth/providers";
import { IdentityStandingPresentation } from "$lib/components/identity-control/identity-standing";
import { browserLogRuntime } from "$lib/runtime/log";
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

export enum IdentityUpgradeKind {
  NotNeeded = "not-needed",
  AwaitingFounder = "awaiting-founder",
}

export type IdentityUpgrade =
  | { readonly kind: IdentityUpgradeKind.NotNeeded }
  | {
      readonly kind: IdentityUpgradeKind.AwaitingFounder;
      readonly storeIds: readonly string[];
    };

export enum IdentityJoinKind {
  Idle = "idle",
  Pending = "pending",
  Approved = "approved",
}

export type IdentityJoin =
  | { readonly kind: IdentityJoinKind.Idle }
  | {
      readonly kind: IdentityJoinKind.Pending | IdentityJoinKind.Approved;
      readonly identityLabel: string;
    };

export enum IdentityActionOutcome {
  Completed = "completed",
}

type IdentityManagerOperation<T> = (manager: NookVaultManager) => Promise<T>;

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
  upgrade = $state<IdentityUpgrade>({ kind: IdentityUpgradeKind.NotNeeded });
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
      manager.ensure_identity_control_log(false),
    );
    if (ensured.isErr()) {
      this.view = {
        kind: IdentityControlViewKind.Unavailable,
        failure: ensured.error,
      };
      return err(ensured.error);
    }
    this.upgrade =
      ensured.value.state === "awaitingFounder"
        ? {
            kind: IdentityUpgradeKind.AwaitingFounder,
            storeIds: ensured.value.storeIds,
          }
        : { kind: IdentityUpgradeKind.NotNeeded };
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
    if (
      this.join.kind === IdentityJoinKind.Pending &&
      new IdentityStandingPresentation(loaded.value.snapshot).isMember()
    ) {
      this.join = {
        kind: IdentityJoinKind.Approved,
        identityLabel: this.join.identityLabel,
      };
    }
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
    return this.loadSnapshot();
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
   * Approve a join. The open vault is registered with the identity first, so
   * the approval wraps its DEK for the new app.
   */
  async approve(
    appId: string,
  ): Promise<Result<IdentityActionOutcome, VaultStorageFailure>> {
    const reconciled = await this.reconcileOpenVault();
    if (reconciled.isErr()) {
      this.report(reconciled.error);
      return reconciled;
    }
    return this.act((manager) => manager.approve_identity_join(appId));
  }

  deny(appId: string) {
    return this.act((manager) => manager.deny_identity_join(appId));
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

  /** Upgrade vaults that another app of this identity created, here. */
  upgradeHere() {
    return this.act(async (manager) => {
      await manager.ensure_identity_control_log(true);
      this.upgrade = { kind: IdentityUpgradeKind.NotNeeded };
    });
  }

  /** Adopt the identity a provider publishes for this app key. */
  async adoptFromProviders(): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
    for (const provider of this.vault.syncProviders) {
      const args = this.vault.providerWasmArgs(provider);
      const adopted = await this.withManager((manager) =>
        manager.adopt_identity_from_provider(args.mode, args.pat, args.repo),
      );
      if (adopted.isErr()) {
        this.report(adopted.error);
        return err(adopted.error);
      }
      if (adopted.value.state === "adopted") {
        this.upgrade = { kind: IdentityUpgradeKind.NotNeeded };
        return this.syncWithMounts();
      }
    }
    return this.refresh();
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

  /**
   * Save provider rows with the layout the identity's mount records give
   * their targets. A joined app saved its row before it could read the log.
   */
  async alignProviderRows(): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
    const providers = this.providersSnapshot();
    const aligned = await this.withManager((manager) =>
      manager.align_identity_provider_rows(providers),
    );
    if (aligned.isErr()) return err(aligned.error);
    if (
      JSON.stringify(aligned.value.providers) ===
      JSON.stringify(providers.providers)
    )
      return ok(IdentityActionOutcome.Completed);
    const persistence: Parameters<typeof this.vault.persistProviders>[0] = {
      replace: true,
      providers: aligned.value.providers,
    };
    const persisted = await this.vault.persistProviders(persistence);
    if (persisted.isErr()) return err(persisted.error);
    log.info("provider rows aligned with identity mounts");
    return ok(IdentityActionOutcome.Completed);
  }

  markJoinPending(identityLabel: string): void {
    this.join = { kind: IdentityJoinKind.Pending, identityLabel };
  }

  /** The joining app checks whether a member approved it yet. */
  async checkJoinApproval(): Promise<
    Result<IdentityActionOutcome, VaultStorageFailure>
  > {
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
    const aligned = await this.alignProviderRows();
    if (aligned.isErr()) return err(aligned.error);
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
