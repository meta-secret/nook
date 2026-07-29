import { VaultSyncConflictKind } from '$app-wasm'
import {
  SyncConflictReviewKind,
  type SyncConflictReview,
} from '$lib/vault/state/sync.svelte'

type SyncConflictLabelState = {
  syncConflictReview: SyncConflictReview
  t(key: string, values?: Record<string, string>): string
}

/** Translate the currently staged conflict without leaking UI concerns into sync actions. */
export function syncConflictLabel(state: SyncConflictLabelState): string {
  if (state.syncConflictReview.kind === SyncConflictReviewKind.Clear) return ''
  const { conflict } = state.syncConflictReview
  const key =
    conflict.kind === VaultSyncConflictKind.StoreId
      ? 'auth_storage.sync_conflict_store_id_banner'
      : 'auth_storage.sync_conflict_banner'
  return state.t(key, { provider: conflict.providerLabel })
}
