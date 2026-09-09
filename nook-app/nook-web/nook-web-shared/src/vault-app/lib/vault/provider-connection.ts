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
import {
  VaultDiscoveryTimeout,
  VAULT_ASSESS_TIMEOUT_ERROR_NAME,
} from "$lib/vault/vault-discovery-timeout";
import { VaultSyncActions } from "$lib/vault/sync.svelte";

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

  async discoverStagedVaultStoreId(): Promise<string> {
    const state = this.state;
    if (!state.hasManager || state.loginSetup.kind !== LoginSetupKind.Active) {
      return "";
    }
    const setupType = state.loginSetup.providerType;
    if (state.isVerifying) {
      throw new Error(state.t(I18N_KEYS.AuthStorageSyncFailed));
    }
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
          if (handle.kind !== LocalFolderHandleKind.Selected) return "";
          return await state.enqueueStorage(async () => {
            state.requireManager().reset_vault_session();
            await state
              .requireManager()
              .sync_local_folder_provider_js(handle.handleId);
            return state.requireManager().vaultStoreId.trim();
          });
        }
        const stagedStorage = state.stagedRemoteStorageArgs();
        const [storageMode, accessToken, remoteRef] =
          stagedStorage.kind === StagedRemoteStorageKind.Available
            ? stagedStorage.args
            : state.wasmStorageArgs();
        return (
          await state.enqueueStorage(() =>
            state
              .requireManager()
              .discover_remote_vault_store_id(
                storageMode,
                accessToken,
                remoteRef,
              ),
          )
        ).trim();
      })();
      const timeoutArgs: ConstructorParameters<
        typeof VaultDiscoveryTimeout
      >[0] = {
        message: state.t(I18N_KEYS.AuthStorageSyncFailed),
        timeoutMs: 30_000,
      };
      const timeout = new VaultDiscoveryTimeout(timeoutArgs);
      try {
        const storeId = await Promise.race([discovery, timeout.completion]);
        if (storeId && state.hasManager) {
          try {
            state.recordExistingVaultRecovery(
              await state.enqueueStorage(() =>
                state.requireManager().vault_recovery_options(),
              ),
            );
          } catch {
            state.clearExistingVaultRecoverySummary();
            log.warn("vault recovery summary unavailable");
          }
        }
        return storeId;
      } finally {
        timeout.cancel();
      }
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
        if (await state.handleRemoteVaultAssessStatus(accessStatus)) return;
      }

      const saved = await state.ensureProviderSaved();
      if (!saved) {
        return;
      }
      const [provider = state.providers[state.providers.length - 1]] = [
        state.syncProviders[state.syncProviders.length - 1],
      ];
      if (!provider || provider.type === "local") {
        state.errorMsg = state.t(I18N_KEYS.ErrorsCloudSyncProviderRequired);
        return;
      }
      const request = VaultSyncActions.eventOutboxRequestForProvider(provider);
      await state.flushRemoteEventOutboxNow(request);
      const syncProviderByIdArgs: Parameters<typeof state.syncProviderById>[0] =
        {
          providerId: provider.id,
          visibility: ProviderSyncVisibility.Quiet,
          failureHandling: ProviderSyncFailureHandling.Propagate,
        };
      await state.syncProviderById(syncProviderByIdArgs);
      state.clearLoginSetup();
      state.addProviderOpen = false;
    } catch (error) {
      const assessTimedOut =
        error instanceof Error &&
        error.name === VAULT_ASSESS_TIMEOUT_ERROR_NAME;
      const stagedConflict =
        !assessTimedOut &&
        stagedRemoteArgs.kind === StagedRemoteStorageKind.Available
          ? await state.stageStagedProviderSyncIssue(stagedRemoteArgs.args)
          : false;
      if (!stagedConflict) {
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
