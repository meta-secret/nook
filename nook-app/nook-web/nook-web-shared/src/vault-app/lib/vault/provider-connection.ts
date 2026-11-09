import { ProviderSyncOutcome } from "$lib/vault/provider-sync.svelte";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  ProviderDraftIncompleteFailure,
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { ProviderActionsContext } from "$lib/vault/action-contexts";
import {
  draft_storage_args,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
  type LocalFolderDraft,
  type ProviderKeyringDiscovery,
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

/** What the provider being set up keeps, as keyring recovery found it. A
 * provider keeps keyrings, not vaults: each is listed, whatever vaults it
 * owns, and none opens a vault on its own. */
export enum StagedKeyringDiscovery {
  /** The provider's keyrings wait on the state, one card each. */
  Listed = "listed",
  /** The provider keeps no keyring. */
  NotFound = "not-found",
}

type DiscoveryResult = Result<StagedKeyringDiscovery, StorageOperationFailure>;

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

  /** Keyring recovery's Connect: list the keyrings the provider keeps for
   * the recovery screen's cards. A provider that keeps none says so, and
   * another provider can be picked. */
  async listKeyringsForRecovery(): Promise<void> {
    const state = this.state;
    const discovered = await this.discoverStagedKeyrings();
    if (discovered.isErr()) {
      state.errorMsg = state.t(discovered.error.translationKey);
      return;
    }
    switch (discovered.value) {
      case StagedKeyringDiscovery.Listed:
        return;
      case StagedKeyringDiscovery.NotFound:
        state.errorMsg = state.t(I18N_KEYS.AuthStorageKeyringNotFound);
    }
  }

  async discoverStagedKeyrings(): Promise<DiscoveryResult> {
    const state = this.state;
    if (!state.hasManager || state.loginSetup.kind !== LoginSetupKind.Active)
      return storageOk(StagedKeyringDiscovery.NotFound);
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
        StagedKeyringDiscovery,
        StorageOperationFailure
      > = {
        operation: discovery,
        releaseLateValue: () => {},
      };
      return await new VaultDiscoveryTimeout(discoveryDeadline).waitFor(
        discoveryCompletion,
      );
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
        return storageOk(StagedKeyringDiscovery.NotFound);
      case "selected":
        return state.enqueueStorage(async () => {
          const admitted = state.admitManager();
          if (admitted.isErr()) return storageErr(admitted.error);
          try {
            return storageOk(
              this.adoptDiscovery(
                await admitted.value.discover_backup_folder_keyrings(
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
                await admitted.value.discover_provider_keyrings(
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
    discovered: ProviderKeyringDiscovery,
  ): StagedKeyringDiscovery {
    const state = this.state;
    switch (discovered.state) {
      case "listed":
        state.remoteVaultChoices = new RemoteVaultChoices(discovered);
        return StagedKeyringDiscovery.Listed;
      case "empty":
        state.remoteVaultChoices = RemoteVaultChoices.NONE;
        return StagedKeyringDiscovery.NotFound;
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
          state.errorMsg = state.t(accessStatus.error.translationKey);
          return;
        }
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
        state.errorMsg = state.t(providerSync.error.translationKey);
        return;
      }
      if (providerSync.value !== ProviderSyncOutcome.Synced) return;
      state.clearLoginSetup();
      state.addProviderOpen = false;
    } catch (error) {
      state.errorMsg =
        error instanceof Error
          ? error.message
          : state.t(I18N_KEYS.AuthStorageSyncFailed);
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
