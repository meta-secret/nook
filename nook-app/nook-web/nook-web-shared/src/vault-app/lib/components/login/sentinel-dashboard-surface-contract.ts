import type {
  NookSentinelGenesisDelivery,
  NookSentinelGenesisParticipantStatus,
  SentinelGenesisPhase,
  StartSentinelGenesisArgs,
} from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import type {
  SentinelActionResult,
  SentinelGenesisDeliveryCompletionOutcome,
  SentinelGenesisFinalizationOutcome,
  SentinelGenesisParticipantResponseOutcome,
} from "$lib/vault/sentinel-genesis";
import type { SentinelDashboard } from "$lib/components/login/sentinel-dashboard-portal";
import type { SentinelParticipation } from "$lib/components/login/sentinel-card-stack-contract";

export type SentinelDashboardSurfaceProps = {
  vault: VaultState;
  dashboard: SentinelDashboard;
  name: string;
  participantCount: number;
  threshold: number;
  status: SentinelGenesisPhase;
  request: string;
  participantResponse: string;
  participants: NookSentinelGenesisParticipantStatus[];
  deliveries: NookSentinelGenesisDelivery[];
  isBusy: boolean;
  initiatorFingerprint: string;
  initiatorKeyLoading: boolean;
  onPrepareInitiator: () => void | Promise<void>;
  onBack: () => void;
  onStart: (args: StartSentinelGenesisArgs) => Promise<boolean>;
  onAddCardParticipant: (
    args: SentinelParticipation,
  ) => Promise<SentinelActionResult<SentinelGenesisParticipantResponseOutcome>>;
  onAddTerminalParticipant: (
    payload: string,
  ) => Promise<SentinelActionResult<SentinelGenesisParticipantResponseOutcome>>;
  onFinalizeSentinelGenesis?: () => Promise<
    SentinelActionResult<SentinelGenesisFinalizationOutcome>
  >;
  onCompleteSentinelGenesisDelivery?: () => Promise<
    SentinelActionResult<SentinelGenesisDeliveryCompletionOutcome>
  >;
};
