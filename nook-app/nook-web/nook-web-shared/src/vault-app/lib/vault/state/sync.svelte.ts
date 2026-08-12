import {
  NookLocalFolderHealth,
  NookLocalFolderHealthState,
  NookManualProviderSync,
  NookManualProviderSyncState,
  NookPendingSyncConflict,
  type NookReplacementConflict,
  NookSecurityConflict,
  NookSyncConflictReview,
  NookSyncConflictReviewState,
  NookVaultLastSync,
} from "$app-wasm";

type ProjectionConflictReplacement = {
  readonly replacementConflicts: NookReplacementConflict[];
  readonly securityConflicts: NookSecurityConflict[];
};

type SecurityConflictStaging = {
  readonly events: string[];
  readonly reasons: string[];
};

type ContentSyncConflictStaging = {
  readonly providerLabel: string;
  readonly localVersion: number;
  readonly remoteVersion: number;
};

type StoreIdSyncConflictStaging = {
  readonly providerLabel: string;
  readonly localStoreId: string;
  readonly remoteStoreId: string;
};

export class VaultSyncState {
  private lastSyncedState = $state(NookVaultLastSync.never_synced());
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
  /** Rust-owned concurrent secret replacements from the event-log projection. */
  private replacementConflictState = $state.raw<NookReplacementConflict[]>([]);
  get replacementConflicts(): readonly NookReplacementConflict[] {
    return this.replacementConflictState;
  }
  /** Rust-owned concurrent key-epoch rotations; local writes fail closed while present. */
  private securityConflictState = $state.raw<NookSecurityConflict[]>([]);
  get securityConflicts(): readonly NookSecurityConflict[] {
    return this.securityConflictState;
  }
  replaceProjectionConflicts({
    replacementConflicts,
    securityConflicts,
  }: ProjectionConflictReplacement): void {
    for (const conflict of this.replacementConflictState) conflict.free();
    for (const conflict of this.securityConflictState) conflict.free();
    this.replacementConflictState = replacementConflicts;
    this.securityConflictState = securityConflicts;
  }
  clearProjectionConflicts(): void {
    const replaceProjectionConflictsArgs: Parameters<
      typeof this.replaceProjectionConflicts
    >[0] = { replacementConflicts: [], securityConflicts: [] };
    this.replaceProjectionConflicts(replaceProjectionConflictsArgs);
  }
  /** E2E/dev boundary: construct the injected domain record in Rust. */
  stageSecurityConflictForTesting({
    events,
    reasons,
  }: SecurityConflictStaging): void {
    for (const conflict of this.securityConflictState) conflict.free();
    this.securityConflictState = [
      NookSecurityConflict.from_display_parts(events, reasons),
    ];
  }
  /** E2E/dev boundary: construct the injected content conflict in Rust. */
  stageContentSyncConflictForTesting({
    providerLabel,
    localVersion,
    remoteVersion,
  }: ContentSyncConflictStaging): void {
    this.stageSyncConflict(
      NookPendingSyncConflict.for_testing_content(
        providerLabel,
        localVersion,
        remoteVersion,
      ),
    );
  }
  /** E2E/dev boundary: construct the injected store-id conflict in Rust. */
  stageStoreIdSyncConflictForTesting({
    providerLabel,
    localStoreId,
    remoteStoreId,
  }: StoreIdSyncConflictStaging): void {
    this.stageSyncConflict(
      NookPendingSyncConflict.for_testing_store_id(
        providerLabel,
        localStoreId,
        remoteStoreId,
      ),
    );
  }
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
    this.syncConflictState = NookSyncConflictReview.requires_decision(value);
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
