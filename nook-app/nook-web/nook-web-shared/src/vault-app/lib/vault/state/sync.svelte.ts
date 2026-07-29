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
  get lastSyncedAt(): SvelteDate | void {
    if (this.lastSyncedState.kind === "present")
      return this.lastSyncedState.value;
    return;
  }
  set lastSyncedAt(value: SvelteDate | void) {
    this.lastSyncedState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  isSyncing = $state(false);
  /** Provider id currently running a manual sync (Settings UI). */
  private syncingProviderState = $state<ValueState<string>>(EMPTY_VALUE);
  get syncingProviderId(): string | void {
    if (this.syncingProviderState.kind === "present")
      return this.syncingProviderState.value;
    return;
  }
  set syncingProviderId(value: string | void) {
    this.syncingProviderState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearSyncingProvider(): void {
    this.syncingProviderState = EMPTY_VALUE;
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
  get pendingSyncConflict(): NookPendingSyncConflict | void {
    if (this.syncConflictState.kind === "present")
      return this.syncConflictState.value;
    return;
  }
  set pendingSyncConflict(value: NookPendingSyncConflict | void) {
    this.syncConflictState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearPendingSyncConflict(): void {
    this.syncConflictState = EMPTY_VALUE;
  }
  /** Local-folder provider points at a folder that contains several vault event logs. */
  private localFolderIssueState =
    $state<ValueState<LocalFolderMultipleVaultsIssue>>(EMPTY_VALUE);
  get localFolderMultipleVaultsIssue(): LocalFolderMultipleVaultsIssue | void {
    if (this.localFolderIssueState.kind === "present")
      return this.localFolderIssueState.value;
    return;
  }
  set localFolderMultipleVaultsIssue(
    value: LocalFolderMultipleVaultsIssue | void,
  ) {
    this.localFolderIssueState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearLocalFolderMultipleVaultsIssue(): void {
    this.localFolderIssueState = EMPTY_VALUE;
  }
}
