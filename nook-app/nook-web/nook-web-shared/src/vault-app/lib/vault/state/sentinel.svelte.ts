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
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from "../../../../explicit-state";
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
  private sentinelGenesisStoreState = $state<ValueState<StoreId>>(EMPTY_VALUE);
  get sentinelGenesisStoreId(): StoreId | void {
    if (this.sentinelGenesisStoreState.kind === "present")
      return this.sentinelGenesisStoreState.value;
    return;
  }
  set sentinelGenesisStoreId(value: StoreId | void) {
    this.sentinelGenesisStoreState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearSentinelGenesisStore(): void {
    this.sentinelGenesisStoreState = EMPTY_VALUE;
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
