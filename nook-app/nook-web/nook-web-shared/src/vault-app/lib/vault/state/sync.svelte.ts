import {
  NookManualProviderSync,
  NookManualProviderSyncState,
  type NookReplacementConflict,
  NookSecurityConflict,
  NookVaultLastSync,
} from "$app-wasm";

type ProjectionConflictReplacement = {
  readonly replacementConflicts: NookReplacementConflict[];
  readonly securityConflicts: NookSecurityConflict[];
};

export type VaultProjectionConflictSnapshot = {
  readonly replacementConflicts: readonly NookReplacementConflict[];
  readonly securityConflicts: readonly NookSecurityConflict[];
};

type SecurityConflictStaging = {
  readonly events: string[];
  readonly reasons: string[];
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
  get projectionConflictSnapshot(): VaultProjectionConflictSnapshot {
    return {
      replacementConflicts: this.replacementConflictState,
      securityConflicts: this.securityConflictState,
    };
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
}
