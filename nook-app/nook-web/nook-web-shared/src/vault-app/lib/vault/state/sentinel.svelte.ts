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
  sentinelGenesisStoreId = $state<StoreId>();

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
