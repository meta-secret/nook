import {
  DeviceProtectedOperationState,
  PendingVaultCreationKind,
  type StartSentinelGenesisArgs,
} from "$app-wasm";
import type { ActiveVault } from "$lib/vault/state/provider.svelte";
import type { ExistingVaultProviderSnapshot } from "$lib/vault/existing-vault-provider.svelte";

export type PendingVaultCreation =
  | { kind: PendingVaultCreationKind.Simple; label: string }
  | { kind: PendingVaultCreationKind.Sentinel; args: StartSentinelGenesisArgs }
  | { kind: PendingVaultCreationKind.SentinelParticipantKey }
  | {
      kind: PendingVaultCreationKind.SentinelParticipantResponse;
      requestPayload: string;
    }
  | { kind: PendingVaultCreationKind.SentinelOnboarding; packageJson: string };

export type VaultCreationQueue =
  | { kind: DeviceProtectedOperationState.Idle }
  | {
      kind: DeviceProtectedOperationState.WaitingForDevice;
      request: PendingVaultCreation;
    };

export type PendingExistingVaultImport = {
  storeId: string;
  previousActiveVault: ActiveVault;
  provider: ExistingVaultProviderSnapshot;
};

export type ExistingVaultImportQueue =
  | { kind: DeviceProtectedOperationState.Idle }
  | {
      kind: DeviceProtectedOperationState.WaitingForDevice;
      request: PendingExistingVaultImport;
    };

export type PendingEnrollmentSubmit = { code: string; password: string };

export type EnrollmentSubmitQueue =
  | { kind: DeviceProtectedOperationState.Idle }
  | {
      kind: DeviceProtectedOperationState.WaitingForDevice;
      request: PendingEnrollmentSubmit;
    };
