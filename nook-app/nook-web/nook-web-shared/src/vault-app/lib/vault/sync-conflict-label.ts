import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  NookSyncConflictReviewState,
  type NookSyncConflictReview,
  VaultSyncConflictKind,
} from "$app-wasm";
import type { TranslationRequest } from "$lib/vault/translation";

type SyncConflictLabelState = {
  syncConflictReview: NookSyncConflictReview;
  t(request: TranslationRequest): string;
};

/** Translate the currently staged conflict without leaking UI concerns into sync actions. */
export function syncConflictLabel(state: SyncConflictLabelState): string {
  const conflict = state.syncConflictReview;
  if (conflict.state === NookSyncConflictReviewState.Clear) return "";
  const key =
    conflict.conflictKind === VaultSyncConflictKind.StoreId
      ? I18N_KEYS.AuthStorageSyncConflictStoreIdBanner
      : I18N_KEYS.AuthStorageSyncConflictBanner;
  const translationRequest: TranslationRequest = {
    key,
    replacements: { provider: conflict.providerLabel },
  };
  return state.t(translationRequest);
}
