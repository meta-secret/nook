import type { EnrollmentCodeUseRequest } from "$lib/app/app-interaction-types";
import type { StartSentinelGenesisArgs } from "$app-wasm";

export enum PendingVaultCreationKind {
  Simple = "simple",
  Sentinel = "sentinel",
  SentinelParticipantKey = "sentinel-participant-key",
  SentinelParticipantResponse = "sentinel-participant-response",
  SentinelOnboarding = "sentinel-onboarding",
}

export type PendingVaultCreation =
  | { kind: PendingVaultCreationKind.Simple; label: string }
  | { kind: PendingVaultCreationKind.Sentinel; args: StartSentinelGenesisArgs }
  | { kind: PendingVaultCreationKind.SentinelParticipantKey }
  | {
      kind: PendingVaultCreationKind.SentinelParticipantResponse;
      requestPayload: string;
    }
  | { kind: PendingVaultCreationKind.SentinelOnboarding; packageJson: string };

export enum VaultCreationQueueKind {
  Idle = "idle",
  WaitingForDevice = "waiting-for-device",
}

export type VaultCreationQueue =
  | { kind: VaultCreationQueueKind.Idle }
  | {
      kind: VaultCreationQueueKind.WaitingForDevice;
      request: PendingVaultCreation;
    };

export type PendingEnrollmentSubmit = EnrollmentCodeUseRequest;

export enum EnrollmentSubmitQueueKind {
  Idle = "idle",
  WaitingForDevice = "waiting-for-device",
}

export type EnrollmentSubmitQueue =
  | { kind: EnrollmentSubmitQueueKind.Idle }
  | {
      kind: EnrollmentSubmitQueueKind.WaitingForDevice;
      request: PendingEnrollmentSubmit;
    };

export class PendingVaultCreationView {
  constructor(private readonly value: VaultCreationQueue) {}
  isSentinelParticipantResponsePending(): boolean {
    const queue = this.value;
    return (
      queue.kind === VaultCreationQueueKind.WaitingForDevice &&
      queue.request.kind ===
        PendingVaultCreationKind.SentinelParticipantResponse
    );
  }

  isSentinelParticipantKeyPending(): boolean {
    const queue = this.value;
    return (
      queue.kind === VaultCreationQueueKind.WaitingForDevice &&
      queue.request.kind === PendingVaultCreationKind.SentinelParticipantKey
    );
  }
}
