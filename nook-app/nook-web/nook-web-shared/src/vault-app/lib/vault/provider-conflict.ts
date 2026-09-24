import {
  isLocalDataInvalidationFailure,
  NativeVaultStorageFailure,
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  NookEventLogSyncIssueState,
  NookPendingSyncConflict,
  NookProviderSyncRevision,
  type NookStorageConnectArgs,
  type NookSyncConflictReview,
  read_local_vault_yaml,
} from "$app-wasm";
import { LOCAL_PROVIDER_TYPE } from "$lib/auth/providers";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  VaultOperationStale,
  VaultOperationStaleKind,
} from "$lib/runtime/vault-operation-stale";
import type { SyncActionsContext } from "$lib/vault/action-contexts";
import type { ActiveVault } from "$lib/vault/state/provider.svelte";

/** Whether the browser staged a conflict dialog for the attempted provider. */
export enum StagedProviderConflictOutcome {
  NotStaged = "not-staged",
  Staged = "staged",
}

type StagedProviderRestoreOutcome = ActiveVault | VaultOperationStale;

export type ProviderConflictActionsContext = Pick<
  SyncActionsContext,
  | "activeVault"
  | "addProviderOpen"
  | "admitManager"
  | "clearLoginSetup"
  | "enqueueStorage"
  | "ensureProviderSaved"
  | "providers"
  | "stageSyncConflict"
  | "stagedProviderLabel"
  | "syncProviders"
>;

interface StagedProviderConflictCompletion {
  readonly conflict: NookSyncConflictReview;
}

interface ProviderConflictPersistence {
  readonly conflict: NookSyncConflictReview;
}

interface StagedProviderSyncIssueAssessment {
  readonly args: NookStorageConnectArgs;
}

const log = browserLogRuntime.createLogger("vault-sync");

/** Owns the staged-provider conflict lifecycle for a vault context. */
export class ProviderConflictActions {
  constructor(private readonly state: ProviderConflictActionsContext) {}

  finishStagedProviderConnectAfterConflict({
    conflict,
  }: StagedProviderConflictCompletion): void {
    const state = this.state;
    if (!conflict.isPendingProvider) return;
    state.clearLoginSetup();
    state.addProviderOpen = false;
  }

  async ensureProviderSavedAfterConflict({
    conflict,
  }: ProviderConflictPersistence): Promise<
    Result<string, StorageOperationFailure>
  > {
    const state = this.state;
    if (
      !conflict.isPendingProvider &&
      state.providers.some((provider) => provider.id === conflict.providerId)
    ) {
      return storageOk(conflict.providerId);
    }
    const saved = await state.ensureProviderSaved();
    if (saved.isErr()) return storageErr(saved.error);
    const [provider = state.providers[state.providers.length - 1]] = [
      state.syncProviders[state.syncProviders.length - 1],
    ];
    if (!provider || provider.type === LOCAL_PROVIDER_TYPE) {
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.OperationFailed,
        ),
      );
    }
    return storageOk(provider.id);
  }

  async stageStagedProviderSyncIssue({
    args,
  }: StagedProviderSyncIssueAssessment): Promise<
    Result<
      StagedProviderConflictOutcome | VaultOperationStale,
      StorageOperationFailure
    >
  > {
    const state = this.state;
    const activeVault = state.activeVault;
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    let issueResult: ReturnType<typeof manager.value.take_event_log_sync_issue>;
    try {
      issueResult = manager.value.take_event_log_sync_issue();
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
    let issue: ReturnType<typeof issueResult.issue>;
    try {
      if (issueResult.state === NookEventLogSyncIssueState.Clear)
        return storageOk(StagedProviderConflictOutcome.NotStaged);
      issue = issueResult.issue();
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    } finally {
      issueResult.free();
    }
    try {
      let localStoreId: string;
      let remoteStoreId: string;
      try {
        if (!issue.isStoreMismatch)
          return storageOk(StagedProviderConflictOutcome.NotStaged);
        localStoreId = issue.localStoreId;
        remoteStoreId = issue.remoteStoreId;
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      let localYaml: string;
      try {
        localYaml = await read_local_vault_yaml();
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      const restored = await state.enqueueStorage<
        StagedProviderRestoreOutcome,
        NativeVaultStorageFailure
      >(async () => {
        const current = state.admitManager();
        if (current.isErr())
          return storageOk(
            new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
          );
        if (
          current.value !== manager.value ||
          state.activeVault !== activeVault
        )
          return storageOk(
            new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
          );
        try {
          await current.value.restore_local_after_provider_assessment();
          return storageOk(state.activeVault);
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (restored.isErr()) {
        if (isLocalDataInvalidationFailure(restored.error))
          return storageErr(restored.error);
        const current = state.admitManager();
        if (
          current.isErr() ||
          current.value !== manager.value ||
          state.activeVault !== activeVault
        )
          return storageOk(
            new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
          );
        return storageErr(restored.error);
      }
      if (restored.value instanceof VaultOperationStale)
        return storageOk(restored.value);
      const current = state.admitManager();
      if (current.isErr())
        return storageOk(
          new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
        );
      if (current.value !== manager.value || state.activeVault !== activeVault)
        return storageOk(
          new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
        );
      let revision: NookProviderSyncRevision;
      try {
        revision = NookProviderSyncRevision.untracked();
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      let conflict: NookPendingSyncConflict;
      try {
        conflict = NookPendingSyncConflict.pending_store_id(
          state.stagedProviderLabel(),
          localYaml,
          "",
          args.mode,
          args.pat,
          args.repo,
          revision,
          localStoreId,
          remoteStoreId,
        );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      } finally {
        revision.free();
      }
      state.stageSyncConflict(conflict);
      log.warn("staged provider store mismatch staged");
      return storageOk(StagedProviderConflictOutcome.Staged);
    } finally {
      issue.free();
    }
  }
}
