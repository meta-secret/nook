import type {
  NookSentinelGenesisDelivery,
  NookSentinelGenesisParticipantStatus,
  SentinelGenesisPhase,
  StartSentinelGenesisArgs,
  VaultApplication,
} from "$app-wasm";
import type {
  SentinelActionResult,
  SentinelGenesisDeliveryCompletionOutcome,
  SentinelGenesisFinalizationOutcome,
  SentinelGenesisParticipantResponseOutcome,
  SentinelGenesisRequestMemoryOutcome,
  SentinelGenesisShareDeliveryOutcome,
} from "$lib/vault/sentinel-genesis";
import type { VaultState } from "$lib/vault.svelte";

export type SentinelGenesisParticipation = {
  readonly payload: string;
  readonly participantLabel?: string;
};

export type LoginCreateVaultChooserProps = {
  vault: VaultState;
  appKind: VaultApplication;
  isVerifying: boolean;
  isInitializing: boolean;
  usesExtensionDeviceIdentity?: boolean;
  onCreateDeviceVault: (label: string) => void | Promise<void>;
  onConnectStorage: () => void;
  onStartSentinelGenesis: (args: StartSentinelGenesisArgs) => Promise<boolean>;
  onAddSentinelGenesisParticipantResponse?: (
    args: SentinelGenesisParticipation,
  ) => Promise<SentinelActionResult<SentinelGenesisParticipantResponseOutcome>>;
  onFinalizeSentinelGenesis?: () => Promise<
    SentinelActionResult<SentinelGenesisFinalizationOutcome>
  >;
  onCreateSentinelGenesisParticipantResponse?: (
    requestPayload: string,
  ) => Promise<SentinelActionResult<string>>;
  onCreateSentinelGenesisPublicKeyAnnouncement?: () => Promise<
    SentinelActionResult<string>
  >;
  onRememberSentinelGenesisRequest?: (
    requestPayload: string,
  ) => Promise<SentinelActionResult<SentinelGenesisRequestMemoryOutcome>>;
  onReceiveSentinelGenesisShare?: (
    sharePayload: string,
  ) => Promise<SentinelActionResult<SentinelGenesisShareDeliveryOutcome>>;
  onCompleteSentinelGenesisDelivery?: () => Promise<
    SentinelActionResult<SentinelGenesisDeliveryCompletionOutcome>
  >;
  sentinelGenesisPhase?: SentinelGenesisPhase;
  sentinelGenesisRequest?: string;
  sentinelGenesisParticipants?: NookSentinelGenesisParticipantStatus[];
  sentinelGenesisDeliveries?: NookSentinelGenesisDelivery[];
  sentinelInvitationRequest?: string;
  sentinelParticipantResponsePending?: boolean;
  sentinelParticipantResponse?: string;
  sentinelOnboardingPackage?: string;
  onAcceptSentinelOnboardingPackage?: (
    packageJson: string,
  ) => void | Promise<void>;
  onFinishSentinelInvitation?: () => void;
};
