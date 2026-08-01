import type { StartSentinelGenesisArgs } from "$app-wasm";
import type { ActiveVault } from "$lib/vault/state/provider.svelte";
import type { ExistingVaultProviderSnapshot } from "$lib/vault/existing-vault-provider.svelte";

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

export type PendingExistingVaultImport = {
  storeId: string;
  previousActiveVault: ActiveVault;
  provider: ExistingVaultProviderSnapshot;
};

export enum ExistingVaultImportQueueKind {
  Idle = "idle",
  WaitingForDevice = "waiting-for-device",
}

export type ExistingVaultImportQueue =
  | { kind: ExistingVaultImportQueueKind.Idle }
  | {
      kind: ExistingVaultImportQueueKind.WaitingForDevice;
      request: PendingExistingVaultImport;
    };

export type PendingEnrollmentSubmit = { code: string; password: string };

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
