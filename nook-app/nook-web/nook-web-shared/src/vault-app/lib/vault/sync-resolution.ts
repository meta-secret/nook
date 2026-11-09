import {
  NativeVaultStorageFailure,
  VaultStorageFailure as StorageOperationFailure,
} from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import { VaultChangeOutcome } from "$lib/vault/vault-change-outcome";

import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { SyncActionsContext } from "$lib/vault/action-contexts";
import type { ProjectionConflictRefreshSnapshot } from "$lib/vault/action-contexts";
import type { NookReplacementConflict, NookSecurityConflict } from "$app-wasm";

export interface ReplacementConflictResolution {
  readonly oldSecretId: string;
  readonly chosenSecretId: string;
}

/** Owns browser orchestration for one sync resolution context. */
export class SyncConflictActions {
  constructor(private readonly state: SyncActionsContext) {}

  async resolveReplacementConflict({
    oldSecretId,
    chosenSecretId,
  }: ReplacementConflictResolution): Promise<void> {
    const state = this.state;
    if (!state.hasManager || state.isSaving) return;
    state.isSaving = true;
    state.errorMsg = "";
    try {
      const raw = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager();
        if (admittedManager.isErr()) return storageErr(admittedManager.error);
        try {
          await admittedManager.value.resolve_projection_conflict(
            oldSecretId,
            chosenSecretId,
          );
          return storageOk(VaultChangeOutcome.Completed);
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure));
        }
      });
      if (raw.isErr()) {
        state.errorMsg = state.t(raw.error.translationKey);
        return;
      }
      const secretRefresh1 = await state.refreshSecretsFromSession();
      if (secretRefresh1.isErr()) {
        state.errorMsg = state.t(secretRefresh1.error.translationKey);
        return;
      }
      const conflicts = await state.refreshReplacementConflicts();
      if (conflicts.isErr()) {
        state.errorMsg = state.t(conflicts.error.translationKey);
        return;
      }
      const synchronized = await state.runFanOutSyncAfterLocalSave();
      if (synchronized.isErr()) {
        state.errorMsg = state.t(synchronized.error.translationKey);
        return;
      }
      state.showSuccess(state.t(I18N_KEYS.ToastsSecretConflictResolved));
    } catch (error) {
      state.errorMsg =
        error instanceof Error
          ? error.message
          : state.t(I18N_KEYS.ErrorsConflictResolutionFailed);
    } finally {
      state.isSaving = false;
    }
  }

  async refreshReplacementConflicts(): Promise<
    Result<ProjectionConflictRefreshSnapshot, StorageOperationFailure>
  > {
    const state = this.state;
    if (!state.hasManager) {
      state.clearProjectionConflicts();
      const emptySnapshot: ProjectionConflictRefreshSnapshot = {
        replacementConflictCount: 0,
        securityConflictCount: 0,
      };
      return storageOk(emptySnapshot);
    }
    const snapshot = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      let conflicts: NookReplacementConflict[] = [];
      try {
        if (!manager.value.event_log_mode()) {
          const conflictsSnapshot: Parameters<
            typeof state.replaceProjectionConflicts
          >[0] = {
            replacementConflicts: conflicts,
            securityConflicts: [] as NookSecurityConflict[],
          };
          return storageOk(conflictsSnapshot);
        }
        conflicts = await manager.value.list_projection_conflicts();
        const securityConflicts =
          await manager.value.list_projection_security_conflicts();
        const conflictsSnapshot: Parameters<
          typeof state.replaceProjectionConflicts
        >[0] = {
          replacementConflicts: conflicts,
          securityConflicts,
        };
        return storageOk(conflictsSnapshot);
      } catch (failure) {
        for (const conflict of conflicts) conflict.free();
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (snapshot.isErr()) return storageErr(snapshot.error);
    state.replaceProjectionConflicts(snapshot.value);
    const refreshedSnapshot: ProjectionConflictRefreshSnapshot = {
      replacementConflictCount: snapshot.value.replacementConflicts.length,
      securityConflictCount: snapshot.value.securityConflicts.length,
    };
    return storageOk(refreshedSnapshot);
  }
}
