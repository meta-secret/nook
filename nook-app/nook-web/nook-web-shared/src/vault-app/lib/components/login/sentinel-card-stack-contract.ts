import type {
  NookSentinelGenesisDelivery,
  NookSentinelGenesisParticipantStatus,
  SentinelGenesisPhase,
  StartSentinelGenesisArgs,
} from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import type { SentinelActionResult } from "$lib/vault/sentinel-genesis";

export type SentinelParticipation = {
  readonly payload: string;
  readonly participantLabel: string;
};

export type SentinelCardStackProperties = {
  vault: VaultState;
  name: string;
  participantCount: number;
  threshold: number;
  status: SentinelGenesisPhase;
  request: string;
  participantResponse?: string;
  participants: NookSentinelGenesisParticipantStatus[];
  deliveries: NookSentinelGenesisDelivery[];
  isBusy: boolean;
  initiatorFingerprint: string;
  initiatorKeyLoading: boolean;
  onPrepareInitiator: () => void | Promise<void>;
  onBack: () => void;
  onStart: (args: StartSentinelGenesisArgs) => Promise<boolean>;
  onAddParticipant: (
    args: SentinelParticipation,
  ) => Promise<SentinelActionResult<void>>;
  onFinalize: () => Promise<SentinelActionResult<void>>;
  onCompleteDelivery: () => Promise<SentinelActionResult<void>>;
};
