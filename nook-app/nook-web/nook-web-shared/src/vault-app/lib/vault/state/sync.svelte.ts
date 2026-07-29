import { SvelteDate } from "svelte/reactivity";
import type { NookPendingSyncConflict } from "$app-wasm";
import type { LocalFolderMultipleVaultsIssue } from "$lib/vault/sync.svelte";
enum LastSyncKind {
  NeverSynced = "never-synced",
  Synced = "synced",
}

type LastSync =
  | { kind: LastSyncKind.NeverSynced }
  | { kind: LastSyncKind.Synced; at: SvelteDate };
enum ManualProviderSyncKind {
  Idle = "idle",
  Running = "running",
}

type ManualProviderSync =
  | { kind: ManualProviderSyncKind.Idle }
  | { kind: ManualProviderSyncKind.Running; providerId: string };
enum SyncConflictReviewKind {
  Clear = "clear",
  RequiresDecision = "requires-decision",
}

type SyncConflictReview =
  | { kind: SyncConflictReviewKind.Clear }
  | {
      kind: SyncConflictReviewKind.RequiresDecision;
      conflict: NookPendingSyncConflict;
    };
enum LocalFolderHealthKind {
  Healthy = "healthy",
  MultipleVaults = "multiple-vaults",
}

type LocalFolderHealth =
  | { kind: LocalFolderHealthKind.Healthy }
  | {
      kind: LocalFolderHealthKind.MultipleVaults;
      issue: LocalFolderMultipleVaultsIssue;
    };
export class VaultSyncState {
  private lastSyncedState = $state<LastSync>({
    kind: LastSyncKind.NeverSynced,
  });
  get lastSyncedAt(): SvelteDate | void {
    if (this.lastSyncedState.kind === LastSyncKind.Synced)
      return this.lastSyncedState.at;
    return;
  }
  set lastSyncedAt(value: SvelteDate) {
    this.lastSyncedState = { kind: LastSyncKind.Synced, at: value };
  }
  isSyncing = $state(false);
  /** Provider id currently running a manual sync (Settings UI). */
  private syncingProviderState = $state<ManualProviderSync>({
    kind: ManualProviderSyncKind.Idle,
  });
  get syncingProviderId(): string | void {
    if (this.syncingProviderState.kind === ManualProviderSyncKind.Running)
      return this.syncingProviderState.providerId;
    return;
  }
  get manualProviderSyncRunning(): boolean {
    return this.syncingProviderState.kind === ManualProviderSyncKind.Running;
  }
  set syncingProviderId(value: string) {
    this.syncingProviderState = {
      kind: ManualProviderSyncKind.Running,
      providerId: value,
    };
  }
  clearSyncingProvider(): void {
    this.syncingProviderState = { kind: ManualProviderSyncKind.Idle };
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
  private syncConflictState = $state<SyncConflictReview>({
    kind: SyncConflictReviewKind.Clear,
  });
  get pendingSyncConflict(): NookPendingSyncConflict | void {
    if (this.syncConflictState.kind === SyncConflictReviewKind.RequiresDecision)
      return this.syncConflictState.conflict;
    return;
  }
  get syncConflictRequiresDecision(): boolean {
    return (
      this.syncConflictState.kind === SyncConflictReviewKind.RequiresDecision
    );
  }
  set pendingSyncConflict(value: NookPendingSyncConflict) {
    this.syncConflictState = {
      kind: SyncConflictReviewKind.RequiresDecision,
      conflict: value,
    };
  }
  clearPendingSyncConflict(): void {
    this.syncConflictState = { kind: SyncConflictReviewKind.Clear };
  }
  /** Local-folder provider points at a folder that contains several vault event logs. */
  private localFolderIssueState = $state<LocalFolderHealth>({
    kind: LocalFolderHealthKind.Healthy,
  });
  get localFolderMultipleVaultsIssue(): LocalFolderMultipleVaultsIssue | void {
    if (
      this.localFolderIssueState.kind === LocalFolderHealthKind.MultipleVaults
    )
      return this.localFolderIssueState.issue;
    return;
  }
  set localFolderMultipleVaultsIssue(value: LocalFolderMultipleVaultsIssue) {
    this.localFolderIssueState = {
      kind: LocalFolderHealthKind.MultipleVaults,
      issue: value,
    };
  }
  clearLocalFolderMultipleVaultsIssue(): void {
    this.localFolderIssueState = { kind: LocalFolderHealthKind.Healthy };
  }
}
