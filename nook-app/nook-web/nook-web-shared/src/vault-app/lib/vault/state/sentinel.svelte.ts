import {
  SentinelGenesisPhase,
  SentinelVaultUnlockState,
  type NookSentinelGenesisDelivery,
  type NookSentinelGenesisParticipantStatus,
  type StoreId,
} from "$app-wasm";
import {
  type SentinelStoredDeliverySummary,
  type SentinelUnlockSessionStatus,
  SentinelUnlockActions,
} from "$lib/vault/sentinel-unlock";
export enum SentinelGenesisTargetKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

export type SentinelGenesisTarget =
  | { kind: SentinelGenesisTargetKind.NotSelected }
  | { kind: SentinelGenesisTargetKind.Selected; storeId: StoreId };
export class VaultSentinelState {
  sentinelGenesisPhase = $state<SentinelGenesisPhase>(
    SentinelGenesisPhase.Inactive,
  );
  sentinelGenesisRequest = $state("");
  sentinelGenesisParticipantCount = $state(0);
  sentinelGenesisParticipants = $state<NookSentinelGenesisParticipantStatus[]>(
    [],
  );
  sentinelGenesisDeliveries = $state<NookSentinelGenesisDelivery[]>([]);
  private sentinelGenesisStoreState = $state<SentinelGenesisTarget>({
    kind: SentinelGenesisTargetKind.NotSelected,
  });
  get sentinelGenesisTarget(): SentinelGenesisTarget {
    return this.sentinelGenesisStoreState;
  }
  selectSentinelGenesisStore(value: StoreId): void {
    this.sentinelGenesisStoreState = {
      kind: SentinelGenesisTargetKind.Selected,
      storeId: value,
    };
  }
  clearSentinelGenesisStore(): void {
    this.sentinelGenesisStoreState = {
      kind: SentinelGenesisTargetKind.NotSelected,
    };
  }

  sentinelCeremonyPrompt = $state(false);
  sentinelUnlockStatus = $state<SentinelVaultUnlockState>(
    SentinelVaultUnlockState.NotSentinel,
  );
  /** Public, signed Sentinel unlock request. It contains no share material. */
  sentinelUnlockRequest = $state("");
  /** Rust-owned unlock-session progress rendered by the web layer. */
  sentinelUnlockSession = $state<SentinelUnlockSessionStatus>(
    SentinelUnlockActions.inactiveSentinelUnlockSession(),
  );
  /** Provider-free encrypted deliveries available to this protected device. */
  sentinelStoredDeliveries = $state<SentinelStoredDeliverySummary[]>([]);
}
