import { SvelteDate } from "svelte/reactivity";
import type { NookPendingSyncConflict } from "$app-wasm";
import type { LocalFolderMultipleVaultsIssue } from "$lib/vault/sync.svelte";
export class VaultSyncState {
  lastSyncedAt = $state<SvelteDate>();
  isSyncing = $state(false);
  /** Provider id currently running a manual sync (Settings UI). */
  syncingProviderId = $state<string>();
  /** Background push to all sync providers after a local vault mutation. */
  isFanOutSyncing = $state(false);
  /** Concurrent secret replacement conflicts from the event log projection. */
  replacementConflicts = $state<
    Array<{
      oldSecretId: string;
      candidates: Array<{ eventId: string; secretId: string }>;
    }>
  >([]);
  /** Concurrent key-epoch rotations; local writes fail closed while present. */
  securityConflicts = $state<Array<{ events: string[]; reasons: string[] }>>(
    [],
  );
  /** User must pick local vs remote before editing when versions match but content differs. */
  pendingSyncConflict = $state<NookPendingSyncConflict>();
  /** Local-folder provider points at a folder that contains several vault event logs. */
  localFolderMultipleVaultsIssue = $state<LocalFolderMultipleVaultsIssue>();
}
