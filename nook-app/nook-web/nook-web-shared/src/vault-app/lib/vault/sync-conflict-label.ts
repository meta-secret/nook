import { NookPendingSyncConflict, VaultSyncConflictKind } from "$app-wasm";

type SyncConflictLabelState = {
  pendingSyncConflict: NookPendingSyncConflict | void;
  t(key: string, values?: Record<string, string>): string;
};

/** Translate the currently staged conflict without leaking UI concerns into sync actions. */
export function syncConflictLabel(state: SyncConflictLabelState): string {
  const conflict = state.pendingSyncConflict;
  if (!conflict) return "";
  const key =
    conflict.kind === VaultSyncConflictKind.StoreId
      ? "auth_storage.sync_conflict_store_id_banner"
      : "auth_storage.sync_conflict_banner";
  return state.t(key, { provider: conflict.providerLabel });
}
