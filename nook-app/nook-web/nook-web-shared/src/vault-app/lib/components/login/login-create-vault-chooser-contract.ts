import type {
  NookSentinelGenesisDelivery,
  NookSentinelGenesisParticipantStatus,
  SentinelGenesisPhase,
  StartSentinelGenesisArgs,
  VaultApplication,
} from "$app-wasm";
import type { SentinelActionResult } from "$lib/vault/sentinel-genesis";
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
  ) => Promise<SentinelActionResult<void>>;
  onFinalizeSentinelGenesis?: () => Promise<SentinelActionResult<void>>;
  onCreateSentinelGenesisParticipantResponse?: (
    requestPayload: string,
  ) => Promise<SentinelActionResult<string>>;
  onCreateSentinelGenesisPublicKeyAnnouncement?: () => Promise<
    SentinelActionResult<string>
  >;
  onRememberSentinelGenesisRequest?: (
    requestPayload: string,
  ) => Promise<SentinelActionResult<void>>;
  onReceiveSentinelGenesisShare?: (
    sharePayload: string,
  ) => Promise<SentinelActionResult<void>>;
  onCompleteSentinelGenesisDelivery?: () => Promise<SentinelActionResult<void>>;
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
