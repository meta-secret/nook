import { StagedProviderConflictOutcome } from "$lib/vault/sync.svelte";
import { ProviderSyncOutcome } from "$lib/vault/provider-sync.svelte";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { ProviderActionsContext } from "$lib/vault/action-contexts";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  LocalFolderPresentation,
  LocalFolderHandleKind,
  type LocalFolderHandle,
} from "$lib/auth/providers";
import {
  NookLocalFolderHealthState,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
} from "$app-wasm";
import {
  LocalFolderDraftKind,
  LoginSetupKind,
  StagedRemoteStorageKind,
} from "$lib/vault/state/provider.svelte";
import { VaultDiscoveryTimeout } from "$lib/vault/vault-discovery-timeout";
import { ProviderEventOutbox } from "$lib/vault/sync-operation-state";

const log = browserLogRuntime.createLogger("vault-provider-connection");

/** Owns browser orchestration for one provider connection context. */
export class ProviderConnectionActions {
  constructor(private readonly state: ProviderActionsContext) {}

  async connectStagedProvider(): Promise<void> {
    const state = this.state;
    if (state.loginSetup.kind === LoginSetupKind.Active) {
      state.storageMode = state.loginSetup.providerType;
    }
    if (
      state.isAuthenticated &&
      (state.loginSetup.kind !== LoginSetupKind.Active ||
        state.loginSetup.providerType !== "local")
    ) {
      await state.connectAndSyncStagedProvider();
      return;
    }
    await state.loadDb();
  }

  async discoverStagedVaultStoreId(): Promise<
    Result<string, StorageOperationFailure>
  > {
    const state = this.state;
    if (!state.hasManager || state.loginSetup.kind !== LoginSetupKind.Active)
      return storageOk("");
    if (state.isVerifying)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    const setupType = state.loginSetup.providerType;
    state.isVerifying = true;
    try {
      const discovery = (async () => {
        if (setupType === "local-folder") {
          const handle: LocalFolderHandle =
            state.localFolderDraft.kind === LocalFolderDraftKind.Configured
              ? new LocalFolderPresentation(
                  state.localFolderDraft.config,
                ).localFolderHandle()
              : { kind: LocalFolderHandleKind.Unselected };
          if (handle.kind !== LocalFolderHandleKind.Selected)
            return storageOk("");
          return state.enqueueStorage(async () => {
            const admitted = state.admitManager();
            if (admitted.isErr()) return storageErr(admitted.error);
            try {
              admitted.value.reset_vault_session();
              await admitted.value.sync_local_folder_provider_js(
                handle.handleId,
              );
              return storageOk(admitted.value.vaultStoreId.trim());
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure));
            }
          });
        }
        const staged = state.stagedRemoteStorageArgs();
        const args =
          staged.kind === StagedRemoteStorageKind.Available
            ? staged.args
            : state.wasmStorageArgs();
        return state.enqueueStorage(async () => {
          const admitted = state.admitManager();
          if (admitted.isErr()) return storageErr(admitted.error);
          try {
            return storageOk(
              (
                await admitted.value.discover_remote_vault_store_id(
                  args.mode,
                  args.pat,
                  args.repo,
                )
              ).trim(),
            );
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure));
          }
        });
      })();
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      const storeId = await new VaultDiscoveryTimeout({
        timeoutMs: 30_000,
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      }).waitFor({ operation: discovery, releaseLateValue: () => {} });
      if (storeId.isErr()) return storageErr(storeId.error);
      if (storeId.value && state.hasManager) {
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
      return storeId;
    } finally {
      state.isVerifying = false;
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
            if (stagedConflict.value === StagedProviderConflictOutcome.Staged)
              return;
          }
          state.errorMsg = state.t(accessStatus.error.translationKey);
          return;
        }
        if (await state.handleRemoteVaultAssessStatus(accessStatus.value))
          return;
      }

      const saved = await state.ensureProviderSaved();
      if (saved.isErr()) {
        state.errorMsg = state.t(saved.error.translationKey);
        return;
      }
      const [provider = state.providers[state.providers.length - 1]] = [
        state.syncProviders[state.syncProviders.length - 1],
      ];
      if (!provider || provider.type === "local") {
        state.errorMsg = state.t(I18N_KEYS.ErrorsCloudSyncProviderRequired);
        return;
      }
      const request = new ProviderEventOutbox(provider).request();
      const flushed = await state.flushRemoteEventOutboxNow(request);
      if (flushed.isErr()) {
        state.errorMsg = state.t(flushed.error.translationKey);
        return;
      }
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
      if (stagedRemoteArgs.kind === StagedRemoteStorageKind.Available) {
        const stagedConflict = await state.stageStagedProviderSyncIssue(
          stagedRemoteArgs.args,
        );
        if (stagedConflict.isErr()) {
          state.errorMsg = state.t(stagedConflict.error.translationKey);
          return;
        }
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
    }
  }
}
