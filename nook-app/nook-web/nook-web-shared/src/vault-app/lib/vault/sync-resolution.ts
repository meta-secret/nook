import type { SyncActionsContext } from "$lib/vault/action-contexts";
import { RemoteVaultRecoveryState } from "$app-wasm";
import { createLogger } from "$lib/log";
import type { NookSecretRecord } from "$lib/nook";

const log = createLogger("vault-sync-resolution");

export async function resolveReplacementConflict(
  state: SyncActionsContext,
  oldSecretId: string,
  chosenSecretId: string,
): Promise<void> {
  if (!state.manager || state.isSaving) return;
  state.isSaving = true;
  state.errorMsg = "";
  try {
    const raw = await state.enqueueStorage(() =>
      state.manager!.resolveProjectionConflict(oldSecretId, chosenSecretId),
    );
    for (const record of raw as NookSecretRecord[]) record.free();
    await state.refreshSecretsFromSession();
    await state.refreshReplacementConflicts();
    void state.runFanOutSyncAfterLocalSave();
    state.showSuccess(state.t("toasts.secret_conflict_resolved"));
  } catch (error: unknown) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : state.t("errors.conflict_resolution_failed");
  } finally {
    state.isSaving = false;
  }
}

export async function refreshReplacementConflicts(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.manager) {
    state.replacementConflicts = [];
    state.securityConflicts = [];
    return;
  }
  // These borrow the wasm manager (`&mut self`); route them through the storage
  // chain so they never alias an in-flight foreground op (e.g. a delete), which
  // would trigger a wasm-bindgen recursive-borrow hang/panic.
  const [conflicts, securityConflicts] = await state.enqueueStorage(async () => {
    if (!state.manager!.eventLogMode()) {
      return [
        [] as Awaited<ReturnType<typeof state.manager.listProjectionConflicts>>,
        [] as Awaited<
          ReturnType<typeof state.manager.listProjectionSecurityConflicts>
        >,
      ] as const;
    }
    // Both wasm methods take `&mut self`; starting them together causes their
    // IndexedDB callbacks to re-enter a dropped wasm-bindgen closure. Keep
    // this pair serial even though the outer storage operation is queued.
    const conflicts = await state.manager!.listProjectionConflicts();
    const securityConflicts =
      await state.manager!.listProjectionSecurityConflicts();
    return [conflicts, securityConflicts] as const;
  });
  state.replacementConflicts = conflicts.map((conflict) => {
    const candidates = conflict.candidates.map((candidate) => {
      const value = {
        eventId: candidate.eventId,
        secretId: candidate.secretId,
      };
      candidate.free();
      return value;
    });
    const value = { oldSecretId: conflict.oldSecretId, candidates };
    conflict.free();
    return value;
  });
  state.securityConflicts = securityConflicts.map((conflict) => {
    const value = { events: conflict.events, reasons: conflict.reasons };
    conflict.free();
    return value;
  });
}

export async function resolveSyncConflictKeepLocal(
  state: SyncActionsContext,
): Promise<void> {
  const conflict = state.pendingSyncConflict;
  if (!conflict || state.isVerifying) return;

  state.isVerifying = true;
  state.errorMsg = "";
  log.info("sync conflict resolved (keep local)", {
    provider: conflict.providerLabel,
    kind: conflict.kind,
  });
  state.errorMsg = state.t("errors.whole_vault_conflict_resolution_retired");
  state.isVerifying = false;
}

export async function resolveSyncConflictKeepRemote(
  state: SyncActionsContext,
): Promise<void> {
  const conflict = state.pendingSyncConflict;
  if (!conflict || state.isVerifying) return;

  log.info("sync conflict resolved (keep remote)", {
    provider: conflict.providerLabel,
    kind: conflict.kind,
  });
  state.errorMsg = state.t("errors.whole_vault_conflict_resolution_retired");
  state.isVerifying = false;
}

export async function confirmRecoverRemoteVault(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.manager) return;
  state.errorMsg = "";
  state.isVerifying = true;
  try {
    await state.enqueueStorage(() =>
      state.manager!.prepareConnectFromLocalCache(),
    );
    state.remoteVaultRecoveryState = RemoteVaultRecoveryState.ConnectFromCache;
    if (state.loginSetupType) {
      await state.loadDb();
      return;
    }
    await state.refreshPasswordEntriesList();
  } catch (error: unknown) {
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Could not load the local vault copy.";
  } finally {
    state.isVerifying = false;
  }
}

export async function confirmCreateFreshRemoteVault(
  state: SyncActionsContext,
): Promise<void> {
  if (!state.manager) return;
  state.errorMsg = "";
  state.remoteVaultRecoveryState = RemoteVaultRecoveryState.ConnectFresh;
  if (state.loginSetupType) {
    state.isVerifying = true;
    try {
      await state.loadDb();
    } catch (error: unknown) {
      state.errorMsg =
        error instanceof Error
          ? error.message
          : "Could not create a new vault file.";
    } finally {
      state.isVerifying = false;
    }
  }
}

export function clearRemoteVaultRecovery(state: SyncActionsContext): void {
  state.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
  try {
    state.manager?.clearConnectRecovery();
  } catch {
    // Engine not ready yet.
  }
}
