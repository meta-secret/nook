import { StagedProviderConflictOutcome } from "$lib/vault/provider-conflict";
import { ProviderSyncOutcome } from "$lib/vault/provider-sync.svelte";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { VaultOperationStale } from "$lib/runtime/vault-operation-stale";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  ProviderDraftIncompleteFailure,
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { ProviderActionsContext } from "$lib/vault/action-contexts";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  draft_storage_args,
  NookLocalFolderHealthState,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
  type LocalFolderDraft,
  type NookRemoteVaultDiscovery,
} from "$app-wasm";
import {
  LoginSetupKind,
  RemoteVaultChoices,
  StagedRemoteStorageKind,
} from "$lib/vault/state/provider.svelte";
import {
  VaultDiscoveryTimeout,
  type DiscoveryCompletion,
} from "$lib/vault/vault-discovery-timeout";
import { ProviderEventOutbox } from "$lib/vault/sync-operation-state";
import { ProviderConnectionPhase } from "$lib/vault/provider-connection-progress";
import { PaintOpportunity } from "$lib/runtime/paint-opportunity";

const log = browserLogRuntime.createLogger("vault-provider-connection");

export enum StagedVaultDiscoveryKind {
  Found = "found",
  /** The provider's keyrings wait on the state for the user's choice:
   * several vaults, or one whose keyring a recovery passphrase can open. */
  Choose = "choose",
  NotFound = "not-found",
}

/** What the provider being set up holds, as staged discovery found it. */
export type StagedVaultDiscovery =
  | { readonly kind: StagedVaultDiscoveryKind.Found; readonly storeId: string }
  | { readonly kind: StagedVaultDiscoveryKind.Choose }
  | { readonly kind: StagedVaultDiscoveryKind.NotFound };

class StagedVaultDiscoveries {
  static readonly NOT_FOUND: StagedVaultDiscovery = {
    kind: StagedVaultDiscoveryKind.NotFound,
  };
  static readonly CHOOSE: StagedVaultDiscovery = {
    kind: StagedVaultDiscoveryKind.Choose,
  };
}

type DiscoveryResult = Result<StagedVaultDiscovery, StorageOperationFailure>;

/** Owns browser orchestration for one provider connection context. */
export class ProviderConnectionActions {
  constructor(private readonly state: ProviderActionsContext) {}

  async connectStagedProvider(): Promise<void> {
    const state = this.state;
    if (
      state.isAuthenticated &&
      (state.loginSetup.kind !== LoginSetupKind.Active ||
        state.loginSetup.providerKind.type !== "local")
    ) {
      await state.connectAndSyncStagedProvider();
      return;
    }
    await state.loadDb();
  }

  /** Recover this vault when the provider being imported holds several. */
  chooseRemoteVault(storeId: string): Result<true, StorageOperationFailure> {
    const state = this.state;
    const admitted = state.admitManager();
    if (admitted.isErr()) return storageErr(admitted.error);
    try {
      admitted.value.choose_remote_vault(storeId);
    } catch (nativeFailure) {
      return storageErr(new NativeVaultStorageFailure(nativeFailure));
    }
    state.remoteVaultChoices = RemoteVaultChoices.NONE;
    return storageOk(true);
  }

  async discoverStagedVault(): Promise<DiscoveryResult> {
    const state = this.state;
    if (!state.hasManager || state.loginSetup.kind !== LoginSetupKind.Active)
      return storageOk(StagedVaultDiscoveries.NOT_FOUND);
    if (state.isVerifying)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    state.isVerifying = true;
    try {
      const discovery = this.discover();
      const discoveryDeadline: ConstructorParameters<
        typeof VaultDiscoveryTimeout
      >[0] = {
        timeoutMs: 30_000,
      };
      const discoveryCompletion: DiscoveryCompletion<
        StagedVaultDiscovery,
        StorageOperationFailure
      > = {
        operation: discovery,
        releaseLateValue: () => {},
      };
      const discovered = await new VaultDiscoveryTimeout(
        discoveryDeadline,
      ).waitFor(discoveryCompletion);
      if (discovered.isErr()) return storageErr(discovered.error);
      if (
        discovered.value.kind === StagedVaultDiscoveryKind.Found &&
        state.hasManager
      ) {
        const summary = await state.enqueueStorage(async () => {
          const admitted = state.admitManager();
          if (admitted.isErr()) return storageErr(admitted.error);
          try {
            return storageOk(await admitted.value.vault_recovery_options());
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure));
          }
        });
        if (summary.isErr()) {
          state.clearExistingVaultRecoverySummary();
          log.warn("vault recovery summary unavailable");
          return storageErr(summary.error);
        }
        state.recordExistingVaultRecovery(summary.value);
      }
      return discovered;
    } finally {
      state.isVerifying = false;
    }
  }

  /** A local-folder setup reads its chosen folder; every other setup reads
   * its draft's connection, and a draft with a gap fails with it. */
  private discover(): Promise<DiscoveryResult> {
    const draft = this.state.providerDraft;
    switch (draft.type) {
      case "local-folder":
        return this.discoverFolder(draft);
      case "local":
      case "github":
      case "oauth-file":
      case "s3":
        return this.discoverRemote();
    }
  }

  private async discoverFolder(
    folder: LocalFolderDraft,
  ): Promise<DiscoveryResult> {
    const state = this.state;
    switch (folder.state) {
      case "awaitingFolder":
        return storageOk(StagedVaultDiscoveries.NOT_FOUND);
      case "selected":
        return state.enqueueStorage(async () => {
          const admitted = state.admitManager();
          if (admitted.isErr()) return storageErr(admitted.error);
          try {
            return storageOk(
              this.adoptDiscovery(
                await admitted.value.discover_backup_folder_vault(
                  folder.handleId,
                ),
              ),
            );
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure));
          }
        });
    }
  }

  private async discoverRemote(): Promise<DiscoveryResult> {
    const state = this.state;
    const connection = draft_storage_args(state.providerDraft);
    switch (connection.state) {
      case "incomplete":
        return storageErr(new ProviderDraftIncompleteFailure(connection.gap));
      case "ready":
        return state.enqueueStorage(async () => {
          const admitted = state.admitManager();
          if (admitted.isErr()) return storageErr(admitted.error);
          try {
            return storageOk(
              this.adoptDiscovery(
                await admitted.value.discover_remote_vault(
                  connection.connection,
                ),
              ),
            );
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure));
          }
        });
    }
  }

  /** The provider's keyrings wait on the state for the user's choice. */
  private adoptDiscovery(
    discovered: NookRemoteVaultDiscovery,
  ): StagedVaultDiscovery {
    const state = this.state;
    switch (discovered.state) {
      case "found":
        state.remoteVaultChoices = RemoteVaultChoices.NONE;
        return {
          kind: StagedVaultDiscoveryKind.Found,
          storeId: discovered.storeId,
        };
      case "choose":
        state.remoteVaultChoices = new RemoteVaultChoices(discovered);
        return StagedVaultDiscoveries.CHOOSE;
      case "empty":
        state.remoteVaultChoices = RemoteVaultChoices.NONE;
        return StagedVaultDiscoveries.NOT_FOUND;
    }
  }

  async connectAndSyncStagedProvider(): Promise<void> {
    const state = this.state;
    if (!state.hasManager) return;
    if (state.isVerifying) return;
    state.isVerifying = true;
    const stagedRemoteArgs = state.stagedRemoteStorageArgs();
    try {
      if (stagedRemoteArgs.kind === StagedRemoteStorageKind.Available) {
        await this.enterPhase(ProviderConnectionPhase.Checking);
        const accessStatus = await state.assessVaultConnectStatus(
          stagedRemoteArgs.args,
        );
        if (accessStatus.isErr()) {
          if (
            accessStatus.error.kind !== StorageOperationFailureKind.TimedOut
          ) {
            const stagedConflict = await state.stageStagedProviderSyncIssue(
              stagedRemoteArgs.args,
            );
            if (stagedConflict.isErr()) {
              state.errorMsg = state.t(stagedConflict.error.translationKey);
              return;
            }
            if (stagedConflict.value instanceof VaultOperationStale) return;
            if (stagedConflict.value === StagedProviderConflictOutcome.Staged)
              return;
          }
          state.errorMsg = state.t(accessStatus.error.translationKey);
          return;
        }
        if (await state.handleRemoteVaultAssessStatus(accessStatus.value))
          return;
      }

      await this.enterPhase(ProviderConnectionPhase.Saving);
      const saved = await state.ensureProviderSaved();
      if (saved.isErr()) {
        state.errorMsg = state.t(saved.error.translationKey);
        return;
      }
      const [provider = state.providers[state.providers.length - 1]] = [
        state.syncProviders[state.syncProviders.length - 1],
      ];
      if (!provider || provider.provider.type === "local") {
        state.errorMsg = state.t(I18N_KEYS.ErrorsCloudSyncProviderRequired);
        return;
      }
      if (provider.provider.type !== "local-folder") {
        await this.enterPhase(ProviderConnectionPhase.Uploading);
        const request = new ProviderEventOutbox(provider).request();
        const flushed = await state.flushRemoteEventOutboxNow(request);
        if (flushed.isErr()) {
          state.errorMsg = state.t(flushed.error.translationKey);
          return;
        }
      }
      await this.enterPhase(ProviderConnectionPhase.Syncing);
      const syncProviderByIdArgs: Parameters<typeof state.syncProviderById>[0] =
        {
          providerId: provider.id,
          visibility: ProviderSyncVisibility.Quiet,
          failureHandling: ProviderSyncFailureHandling.Propagate,
        };
      const providerSync = await state.syncProviderById(syncProviderByIdArgs);
      if (providerSync.isErr()) {
        state.errorMsg =
          state.localFolderHealth.state ===
          NookLocalFolderHealthState.MultipleVaults
            ? state.t(I18N_KEYS.AuthStorageLocalFolderMultipleVaultsShort)
            : state.t(providerSync.error.translationKey);
        return;
      }
      if (providerSync.value !== ProviderSyncOutcome.Synced) return;
      state.clearLoginSetup();
      state.addProviderOpen = false;
    } catch (error) {
      if (stagedRemoteArgs.kind === StagedRemoteStorageKind.Available) {
        const stagedConflict = await state.stageStagedProviderSyncIssue(
          stagedRemoteArgs.args,
        );
        if (stagedConflict.isErr()) {
          state.errorMsg = state.t(stagedConflict.error.translationKey);
          return;
        }
        if (stagedConflict.value instanceof VaultOperationStale) return;
        if (stagedConflict.value === StagedProviderConflictOutcome.Staged)
          return;
      }
      {
        state.errorMsg =
          state.localFolderHealth.state ===
          NookLocalFolderHealthState.MultipleVaults
            ? state.t(I18N_KEYS.AuthStorageLocalFolderMultipleVaultsShort)
            : error instanceof Error
              ? error.message
              : state.t(I18N_KEYS.AuthStorageSyncFailed);
      }
    } finally {
      state.isVerifying = false;
      state.providerConnectionPhase = ProviderConnectionPhase.Idle;
    }
  }

  /** Show the next connection step, painted before its work begins. */
  private async enterPhase(phase: ProviderConnectionPhase): Promise<void> {
    this.state.providerConnectionPhase = phase;
    await PaintOpportunity.next();
  }
}
