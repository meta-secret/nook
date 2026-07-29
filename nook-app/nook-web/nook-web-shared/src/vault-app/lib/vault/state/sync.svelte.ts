import { SvelteDate } from "svelte/reactivity";
import type { NookPendingSyncConflict } from "$app-wasm";
import type { LocalFolderMultipleVaultsIssue } from "$lib/vault/sync.svelte";
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from "../../../../explicit-state";
export class VaultSyncState {
  private lastSyncedState = $state<ValueState<SvelteDate>>(EMPTY_VALUE);
  get lastSyncedAt(): SvelteDate | undefined {
    return this.lastSyncedState.kind === "present"
      ? this.lastSyncedState.value
      : undefined;
  }
  set lastSyncedAt(value: SvelteDate | undefined) {
    this.lastSyncedState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
  isSyncing = $state(false);
  /** Provider id currently running a manual sync (Settings UI). */
  private syncingProviderState = $state<ValueState<string>>(EMPTY_VALUE);
  get syncingProviderId(): string | undefined {
    return this.syncingProviderState.kind === "present"
      ? this.syncingProviderState.value
      : undefined;
  }
  set syncingProviderId(value: string | undefined) {
    this.syncingProviderState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
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
  private syncConflictState =
    $state<ValueState<NookPendingSyncConflict>>(EMPTY_VALUE);
  get pendingSyncConflict(): NookPendingSyncConflict | undefined {
    return this.syncConflictState.kind === "present"
      ? this.syncConflictState.value
      : undefined;
  }
  set pendingSyncConflict(value: NookPendingSyncConflict | undefined) {
    this.syncConflictState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
  /** Local-folder provider points at a folder that contains several vault event logs. */
  private localFolderIssueState =
    $state<ValueState<LocalFolderMultipleVaultsIssue>>(EMPTY_VALUE);
  get localFolderMultipleVaultsIssue():
    | LocalFolderMultipleVaultsIssue
    | undefined {
    return this.localFolderIssueState.kind === "present"
      ? this.localFolderIssueState.value
      : undefined;
  }
  set localFolderMultipleVaultsIssue(
    value: LocalFolderMultipleVaultsIssue | undefined,
  ) {
    this.localFolderIssueState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
}
