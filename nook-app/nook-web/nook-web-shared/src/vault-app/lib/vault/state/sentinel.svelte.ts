import {
  SentinelGenesisPhase,
  SentinelVaultUnlockState,
  type NookSentinelGenesisDelivery,
  type NookSentinelGenesisParticipantStatus,
  type StoreId,
} from "$app-wasm";
import {
  inactiveSentinelUnlockSession,
  type SentinelStoredDeliverySummary,
  type SentinelUnlockSessionStatus,
} from "$lib/vault/sentinel-unlock";
enum SentinelGenesisTargetKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

type SentinelGenesisTarget =
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
  get sentinelGenesisStoreId(): StoreId | void {
    if (
      this.sentinelGenesisStoreState.kind === SentinelGenesisTargetKind.Selected
    )
      return this.sentinelGenesisStoreState.storeId;
    return;
  }
  set sentinelGenesisStoreId(value: StoreId) {
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
    inactiveSentinelUnlockSession(),
  );
  /** Provider-free encrypted deliveries available to this protected device. */
  sentinelStoredDeliveries = $state<SentinelStoredDeliverySummary[]>([]);
}
