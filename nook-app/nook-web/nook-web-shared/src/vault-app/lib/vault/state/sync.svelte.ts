import { SvelteDate } from "svelte/reactivity";
import type { NookPendingSyncConflict } from "$app-wasm";
import type { LocalFolderMultipleVaultsIssue } from "$lib/vault/sync.svelte";
export enum LastSyncKind {
  NeverSynced = "never-synced",
  Synced = "synced",
}

export type LastSync =
  | { kind: LastSyncKind.NeverSynced }
  | { kind: LastSyncKind.Synced; at: SvelteDate };
export enum ManualProviderSyncKind {
  Idle = "idle",
  Running = "running",
}

export type ManualProviderSync =
  | { kind: ManualProviderSyncKind.Idle }
  | { kind: ManualProviderSyncKind.Running; providerId: string };
export enum SyncConflictReviewKind {
  Clear = "clear",
  RequiresDecision = "requires-decision",
}

export type SyncConflictReview =
  | { kind: SyncConflictReviewKind.Clear }
  | {
      kind: SyncConflictReviewKind.RequiresDecision;
      conflict: NookPendingSyncConflict;
    };
export enum LocalFolderHealthKind {
  Healthy = "healthy",
  MultipleVaults = "multiple-vaults",
}

export type LocalFolderHealth =
  | { kind: LocalFolderHealthKind.Healthy }
  | {
      kind: LocalFolderHealthKind.MultipleVaults;
      issue: LocalFolderMultipleVaultsIssue;
    };
export class VaultSyncState {
  private lastSyncedState = $state<LastSync>({
    kind: LastSyncKind.NeverSynced,
  });
  get lastSync(): LastSync {
    return this.lastSyncedState;
  }
  markSynced(value: SvelteDate): void {
    this.lastSyncedState = { kind: LastSyncKind.Synced, at: value };
  }
  isSyncing = $state(false);
  /** Provider id currently running a manual sync (Settings UI). */
  private syncingProviderState = $state<ManualProviderSync>({
    kind: ManualProviderSyncKind.Idle,
  });
  get manualProviderSync(): ManualProviderSync {
    return this.syncingProviderState;
  }
  get manualProviderSyncRunning(): boolean {
    return this.syncingProviderState.kind === ManualProviderSyncKind.Running;
  }
  beginManualProviderSync(value: string): void {
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
  get syncConflictReview(): SyncConflictReview {
    return this.syncConflictState;
  }
  get syncConflictRequiresDecision(): boolean {
    return (
      this.syncConflictState.kind === SyncConflictReviewKind.RequiresDecision
    );
  }
  stageSyncConflict(value: NookPendingSyncConflict): void {
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
  get localFolderHealth(): LocalFolderHealth {
    return this.localFolderIssueState;
  }
  reportLocalFolderMultipleVaults(value: LocalFolderMultipleVaultsIssue): void {
    this.localFolderIssueState = {
      kind: LocalFolderHealthKind.MultipleVaults,
      issue: value,
    };
  }
  clearLocalFolderMultipleVaultsIssue(): void {
    this.localFolderIssueState = { kind: LocalFolderHealthKind.Healthy };
  }
}
