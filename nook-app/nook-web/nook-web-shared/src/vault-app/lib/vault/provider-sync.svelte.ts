import type { OAuthFailure } from "$lib/auth/oauth-failure";
import { err, ok, type Result } from "neverthrow";
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
  NativeVaultStorageFailure,
} from "$lib/runtime/storage-failure";
import { ProviderFailureLogContext } from "$lib/vault/provider-failure-log-context";

/** Sync actions that snapshot reactive Svelte state at WASM boundaries. */
import type {
  ProviderSyncRequest,
  SyncActionsContext,
} from "$lib/vault/action-contexts";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  VaultStorageSynchronization,
  type NookVaultSyncResult,
} from "$lib/nook";
import {
  NookManualProviderSyncState,
  NookProviderSyncRevision,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
  read_local_vault_yaml,
} from "$app-wasm";
import type { StorageProvider } from "$lib/auth/providers";

const log = browserLogRuntime.createLogger("vault-sync");

interface LocalFolderProviderSync {
  readonly provider: StorageProvider;
}

interface ProviderSyncTimeoutRequest {
  readonly promise: Promise<Result<NookVaultSyncResult, VaultStorageFailure>>;
  readonly releaseLateValue: (result: NookVaultSyncResult) => void;
}

type ProviderSyncExecution = ProviderSyncRequest;

export enum ProviderSyncOutcome {
  Synced = "synced",
  Skipped = "skipped",
  FailureCaptured = "failure-captured",
}

export enum LocalFolderProviderSyncOutcome {
  Synchronized = "synchronized",
}

type ProviderFailurePresentation = {
  readonly provider: StorageProvider;
  readonly visibility: ProviderSyncVisibility;
  readonly failureHandling: ProviderSyncFailureHandling;
  readonly failure: VaultStorageFailure;
};

/** Owns provider synchronization and its visible or captured outcome. */
export class ProviderSyncActions {
  constructor(private readonly state: SyncActionsContext) {}

  async syncLocalFolderProvider({
    provider,
  }: LocalFolderProviderSync): Promise<
    Result<LocalFolderProviderSyncOutcome, VaultStorageFailure>
  > {
    const state = this.state;
    const localYaml = await state.enqueueStorage(async () => {
      const admitted = state.admitManager();
      if (admitted.isErr()) return err(admitted.error);
      try {
        return ok(
          await admitted.value.sync_local_folder_provider_row_js(
            $state.snapshot(provider),
          ),
        );
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (localYaml.isErr()) return err(localYaml.error);
    if (localYaml.value.trim()) {
      const revision = NookProviderSyncRevision.untracked();
      const metadataRequest: Parameters<
        typeof state.updateProviderSyncMetadata
      >[0] = {
        providerId: provider.id,
        yaml: localYaml.value,
        revision,
      };
      const metadata = await state.updateProviderSyncMetadata(metadataRequest);
      if (metadata.isErr()) return err(metadata.error);
    }
    return ok(LocalFolderProviderSyncOutcome.Synchronized);
  }

  private presentFailure({
    provider,
    visibility,
    failureHandling,
    failure,
  }: ProviderFailurePresentation): Result<
    ProviderSyncOutcome,
    VaultStorageFailure
  > {
    const state = this.state;
    const failureRequest: Parameters<typeof ProviderFailureLogContext.from>[0] =
      {
        provider_type: provider.provider.type,
        failure_kind: failure.kind,
        cause: failure.cause,
      };
    const failureContext = ProviderFailureLogContext.from(failureRequest);
    const warningContext: Parameters<typeof log.warnWithContext>[0] = {
      message: "provider synchronization failed",
      serializedContext: failureContext.serialize(),
    };
    log.warnWithContext(warningContext);
    if (visibility === ProviderSyncVisibility.Visible && !state.errorMsg)
      state.errorMsg = state.t(failure.translationKey);
    return failureHandling === ProviderSyncFailureHandling.Propagate
      ? err(failure)
      : ok(ProviderSyncOutcome.FailureCaptured);
  }

  async syncProviderById({
    providerId,
    visibility,
    failureHandling,
  }: ProviderSyncExecution): Promise<
    Result<ProviderSyncOutcome, VaultStorageFailure | OAuthFailure>
  > {
    const state = this.state;
    if (!state.hasManager)
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.ManagerUnavailable),
      );
    if (state.isInviteBusy || state.isSaving)
      return ok(ProviderSyncOutcome.Skipped);
    const provider = state.providers.find((entry) => entry.id === providerId);
    if (!provider || provider.provider.type === "local")
      return ok(ProviderSyncOutcome.Skipped);
    if (
      state.manualProviderSync.state === NookManualProviderSyncState.Running &&
      state.manualProviderSync.providerId !== providerId
    )
      return ok(ProviderSyncOutcome.Skipped);
    state.beginManualProviderSync(providerId);
    if (visibility === ProviderSyncVisibility.Visible) state.errorMsg = "";
    try {
      if (provider.provider.type === "local-folder") {
        const localSync: Parameters<typeof this.syncLocalFolderProvider>[0] = {
          provider,
        };
        const synced = await this.syncLocalFolderProvider(localSync);
        if (synced.isErr()) {
          const failurePresentation: ProviderFailurePresentation = {
            provider,
            visibility,
            failureHandling,
            failure: synced.error,
          };
          return this.presentFailure(failurePresentation);
        }
      } else {
        const connection = state.providerWasmArgs(provider);
        const synced = await state.enqueueStorage(async () => {
          const admitted = state.admitManager();
          if (admitted.isErr()) return err(admitted.error);
          const synchronizationArgs: ConstructorParameters<
            typeof VaultStorageSynchronization
          >[0] = {
            manager: admitted.value,
            connection,
          };
          const timeoutRequest: ProviderSyncTimeoutRequest = {
            promise: new VaultStorageSynchronization(synchronizationArgs).run(),
            releaseLateValue: (result) => result.free(),
          };
          return state.raceStorageTimeout(timeoutRequest);
        });
        if (synced.isErr()) {
          const failurePresentation: ProviderFailurePresentation = {
            provider,
            visibility,
            failureHandling,
            failure: synced.error,
          };
          return this.presentFailure(failurePresentation);
        }
        const applied = state.applyVaultSyncResult(synced.value);
        if (applied.isErr()) {
          const failurePresentation: ProviderFailurePresentation = {
            provider,
            visibility,
            failureHandling,
            failure: applied.error,
          };
          return this.presentFailure(failurePresentation);
        }
        let yaml: string;
        try {
          yaml = await read_local_vault_yaml();
        } catch (failure) {
          const nativeFailure = new NativeVaultStorageFailure(failure);
          const failurePresentation: ProviderFailurePresentation = {
            provider,
            visibility,
            failureHandling,
            failure: nativeFailure,
          };
          return this.presentFailure(failurePresentation);
        }
        const metadataRequest: Parameters<
          typeof state.updateProviderSyncMetadata
        >[0] = {
          providerId,
          yaml,
          revision: NookProviderSyncRevision.untracked(),
        };
        const metadata =
          await state.updateProviderSyncMetadata(metadataRequest);
        if (metadata.isErr()) {
          const failurePresentation: ProviderFailurePresentation = {
            provider,
            visibility,
            failureHandling,
            failure: metadata.error,
          };
          return this.presentFailure(failurePresentation);
        }
      }
      if (state.isAuthenticated) {
        const secretRefresh1 = await state.refreshSecretsFromSession();
        if (secretRefresh1.isErr()) {
          return err(secretRefresh1.error);
        }
      }
      const conflicts = await state.refreshReplacementConflicts();
      if (conflicts.isErr()) {
        return err(conflicts.error);
      }
      if (state.isAuthenticated) {
        const roster = await state.hydrateMultiDeviceState();
        if (roster.isErr()) return err(roster.error);
      }
      log.debug("provider sync finished");
      return ok(ProviderSyncOutcome.Synced);
    } finally {
      if (
        state.manualProviderSync.state ===
          NookManualProviderSyncState.Running &&
        state.manualProviderSync.providerId === providerId
      )
        state.clearSyncingProvider();
    }
  }
}
