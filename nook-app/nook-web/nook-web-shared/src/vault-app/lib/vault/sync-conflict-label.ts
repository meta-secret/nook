import {
  NookSyncConflictReviewState,
  type NookSyncConflictReview,
  VaultSyncConflictKind,
} from "$app-wasm";

type SyncConflictLabelState = {
  syncConflictReview: NookSyncConflictReview;
  t(key: string, values?: Record<string, string>): string;
};

/** Translate the currently staged conflict without leaking UI concerns into sync actions. */
export function syncConflictLabel(state: SyncConflictLabelState): string {
  const conflict = state.syncConflictReview;
  if (conflict.state === NookSyncConflictReviewState.Clear) return "";
  const key =
    conflict.conflictKind === VaultSyncConflictKind.StoreId
      ? "auth_storage.sync_conflict_store_id_banner"
      : "auth_storage.sync_conflict_banner";
  return state.t(key, { provider: conflict.providerLabel });
}
