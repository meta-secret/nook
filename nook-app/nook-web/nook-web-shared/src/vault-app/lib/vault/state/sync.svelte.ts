import { SvelteDate } from "svelte/reactivity";
import type { NookPendingSyncConflict } from "$app-wasm";
import type { LocalFolderMultipleVaultsIssue } from "$lib/vault/sync.svelte";
type LastSync = { kind: "never-synced" } | { kind: "synced"; at: SvelteDate };
type ManualProviderSync =
  | { kind: "idle" }
  | { kind: "running"; providerId: string };
type SyncConflictReview =
  | { kind: "clear" }
  | { kind: "requires-decision"; conflict: NookPendingSyncConflict };
type LocalFolderHealth =
  | { kind: "healthy" }
  | { kind: "multiple-vaults"; issue: LocalFolderMultipleVaultsIssue };
export class VaultSyncState {
  private lastSyncedState = $state<LastSync>({ kind: "never-synced" });
  get lastSyncedAt(): SvelteDate | void {
    if (this.lastSyncedState.kind === "synced") return this.lastSyncedState.at;
    return;
  }
  set lastSyncedAt(value: SvelteDate) {
    this.lastSyncedState = { kind: "synced", at: value };
  }
  isSyncing = $state(false);
  /** Provider id currently running a manual sync (Settings UI). */
  private syncingProviderState = $state<ManualProviderSync>({ kind: "idle" });
  get syncingProviderId(): string | void {
    if (this.syncingProviderState.kind === "running")
      return this.syncingProviderState.providerId;
    return;
  }
  get manualProviderSyncRunning(): boolean {
    return this.syncingProviderState.kind === "running";
  }
  set syncingProviderId(value: string) {
    this.syncingProviderState = { kind: "running", providerId: value };
  }
  clearSyncingProvider(): void {
    this.syncingProviderState = { kind: "idle" };
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
  private syncConflictState = $state<SyncConflictReview>({ kind: "clear" });
  get pendingSyncConflict(): NookPendingSyncConflict | void {
    if (this.syncConflictState.kind === "requires-decision")
      return this.syncConflictState.conflict;
    return;
  }
  get syncConflictRequiresDecision(): boolean {
    return this.syncConflictState.kind === "requires-decision";
  }
  set pendingSyncConflict(value: NookPendingSyncConflict) {
    this.syncConflictState = { kind: "requires-decision", conflict: value };
  }
  clearPendingSyncConflict(): void {
    this.syncConflictState = { kind: "clear" };
  }
  /** Local-folder provider points at a folder that contains several vault event logs. */
  private localFolderIssueState = $state<LocalFolderHealth>({
    kind: "healthy",
  });
  get localFolderMultipleVaultsIssue(): LocalFolderMultipleVaultsIssue | void {
    if (this.localFolderIssueState.kind === "multiple-vaults")
      return this.localFolderIssueState.issue;
    return;
  }
  set localFolderMultipleVaultsIssue(value: LocalFolderMultipleVaultsIssue) {
    this.localFolderIssueState = { kind: "multiple-vaults", issue: value };
  }
  clearLocalFolderMultipleVaultsIssue(): void {
    this.localFolderIssueState = { kind: "healthy" };
  }
}
