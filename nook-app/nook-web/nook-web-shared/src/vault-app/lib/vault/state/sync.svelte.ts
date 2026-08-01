import {
  NookLocalFolderHealth,
  NookLocalFolderHealthState,
  NookManualProviderSync,
  NookManualProviderSyncState,
  type NookPendingSyncConflict,
  NookSyncConflictReview,
  NookSyncConflictReviewState,
  NookVaultLastSync,
} from "$app-wasm";

export class VaultSyncState {
  private lastSyncedState = $state(NookVaultLastSync.neverSynced());
  get lastSync(): NookVaultLastSync {
    return this.lastSyncedState;
  }
  markSynced(atUnixMilliseconds: number): void {
    const previous = this.lastSyncedState;
    this.lastSyncedState = NookVaultLastSync.synced(atUnixMilliseconds);
    previous.free();
  }
  isSyncing = $state(false);
  /** Provider id currently running a manual sync (Settings UI). */
  private syncingProviderState = $state(NookManualProviderSync.idle());
  get manualProviderSync(): NookManualProviderSync {
    return this.syncingProviderState;
  }
  get manualProviderSyncRunning(): boolean {
    return (
      this.syncingProviderState.state === NookManualProviderSyncState.Running
    );
  }
  beginManualProviderSync(value: string): void {
    const previous = this.syncingProviderState;
    this.syncingProviderState = NookManualProviderSync.running(value);
    previous.free();
  }
  clearSyncingProvider(): void {
    const previous = this.syncingProviderState;
    this.syncingProviderState = NookManualProviderSync.idle();
    previous.free();
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
  private syncConflictState = $state(NookSyncConflictReview.clear());
  get syncConflictReview(): NookSyncConflictReview {
    return this.syncConflictState;
  }
  get syncConflictRequiresDecision(): boolean {
    return (
      this.syncConflictState.state ===
      NookSyncConflictReviewState.RequiresDecision
    );
  }
  stageSyncConflict(value: NookPendingSyncConflict): void {
    const previous = this.syncConflictState;
    this.syncConflictState = NookSyncConflictReview.requiresDecision(value);
    previous.free();
  }
  clearPendingSyncConflict(): void {
    const previous = this.syncConflictState;
    this.syncConflictState = NookSyncConflictReview.clear();
    previous.free();
  }
  /** Local-folder provider points at a folder that contains several vault event logs. */
  private localFolderIssueState = $state(NookLocalFolderHealth.healthy());
  get localFolderHealth(): NookLocalFolderHealth {
    return this.localFolderIssueState;
  }
  reportLocalFolderMultipleVaults(value: NookLocalFolderHealth): void {
    if (value.state !== NookLocalFolderHealthState.MultipleVaults) {
      value.free();
      return;
    }
    const previous = this.localFolderIssueState;
    this.localFolderIssueState = value;
    previous.free();
  }
  clearLocalFolderMultipleVaultsIssue(): void {
    const previous = this.localFolderIssueState;
    this.localFolderIssueState = NookLocalFolderHealth.healthy();
    previous.free();
  }
}
