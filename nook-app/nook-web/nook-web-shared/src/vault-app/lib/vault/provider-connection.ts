import type { ProviderActionsContext } from "$lib/vault/action-contexts";
import { createLogger } from "$lib/runtime/log";
import {
  localFolderHandle,
  LocalFolderHandleKind,
  type LocalFolderHandle,
} from "$lib/auth/providers";
import { LocalFolderHealthKind } from "$lib/vault/state/sync.svelte";
import {
  LocalFolderDraftKind,
  LoginSetupKind,
  StagedRemoteStorageKind,
} from "$lib/vault/state/provider.svelte";
import {
  startVaultDiscoveryTimeout,
  VAULT_ASSESS_TIMEOUT_ERROR_NAME,
} from "$lib/vault/vault-discovery-timeout";

const log = createLogger("vault-provider-connection");

export async function connectStagedProvider(
  state: ProviderActionsContext,
): Promise<void> {
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

export async function discoverStagedVaultStoreId(
  state: ProviderActionsContext,
): Promise<string> {
  if (!state.hasManager || state.loginSetup.kind !== LoginSetupKind.Active) {
    return "";
  }
  const setupType = state.loginSetup.providerType;
  if (state.isVerifying) {
    throw new Error(state.t("auth_storage.sync_failed"));
  }
  state.isVerifying = true;
  try {
    const discovery = (async () => {
      if (setupType === "local-folder") {
        const handle: LocalFolderHandle =
          state.localFolderDraft.kind === LocalFolderDraftKind.Configured
            ? localFolderHandle(state.localFolderDraft.config)
            : { kind: LocalFolderHandleKind.Unselected };
        if (handle.kind !== LocalFolderHandleKind.Selected) return "";
        return await state.enqueueStorage(async () => {
          state.requireManager().resetVaultSession();
          await state.requireManager().syncLocalFolderProvider(handle.handleId);
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
            .discoverRemoteVaultStoreId(storageMode, accessToken, remoteRef),
        )
      ).trim();
    })();
    const timeout = startVaultDiscoveryTimeout(
      state.t("auth_storage.sync_failed"),
      30_000,
    );
    try {
      const storeId = await Promise.race([discovery, timeout.completion]);
      if (storeId && state.hasManager) {
        try {
          state.recordExistingVaultRecovery(
            await state.enqueueStorage(() =>
              state.requireManager().vaultRecoveryOptions(),
            ),
          );
        } catch (error) {
          state.clearExistingVaultRecoverySummary();
          log.warn("vault recovery summary unavailable", {
            error: error instanceof Error ? error.message : String(error),
          });
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

export async function connectAndSyncStagedProvider(
  state: ProviderActionsContext,
): Promise<void> {
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
    const provider =
      state.syncProviders[state.syncProviders.length - 1] ??
      state.providers[state.providers.length - 1];
    if (!provider || provider.type === "local") {
      state.errorMsg = state.t("errors.cloud_sync_provider_required");
      return;
    }
    await state.flushRemoteEventOutboxNow(provider);
    await state.syncProviderById(provider.id, {
      quiet: true,
      propagateError: true,
    });
    state.clearLoginSetup();
    state.addProviderOpen = false;
  } catch (error: unknown) {
    const assessTimedOut =
      error instanceof Error && error.name === VAULT_ASSESS_TIMEOUT_ERROR_NAME;
    const stagedConflict =
      !assessTimedOut &&
      stagedRemoteArgs.kind === StagedRemoteStorageKind.Available
        ? await state.stageStagedProviderSyncIssue(stagedRemoteArgs.args)
        : false;
    if (!stagedConflict) {
      state.errorMsg =
        state.localFolderHealth.kind === LocalFolderHealthKind.MultipleVaults
          ? state.t("auth_storage.local_folder_multiple_vaults_short")
          : error instanceof Error
            ? error.message
            : state.t("auth_storage.sync_failed");
    }
  } finally {
    state.isVerifying = false;
  }
}
