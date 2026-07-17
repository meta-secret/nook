import {
  defaultVaultArchitecture as wasmDefaultVaultArchitecture,
  firstCompatibleProviderId as wasmFirstCompatibleProviderId,
  prepareSharedStorageGrant as wasmPrepareSharedStorageGrant,
  providerOnboardingType as wasmProviderOnboardingType,
  providerReplicationCapability as wasmProviderReplicationCapability,
  providerSupportsReplication as wasmProviderSupportsReplication,
  validateProviderReplication as wasmValidateProviderReplication,
  validateVaultArchitecture as wasmValidateVaultArchitecture,
  vaultArchitectureCanCreateSecret as wasmVaultArchitectureCanCreateSecret,
  vaultArchitectureOnboardingType as wasmVaultArchitectureOnboardingType,
} from "$app-wasm";
import type { StorageProvider } from "$lib/auth-providers";

export type DeviceMode = "standard" | "anti-hacker";
export type VaultType = "simple" | "sentinel";
export type ReplicationType = "personal" | "shared";

export type SentinelPolicy = {
  threshold: number;
  required_participants: number;
  ready_participants: number;
};

export type VaultArchitecture = {
  device_mode: DeviceMode;
  vault_type: VaultType;
  replication_type: ReplicationType;
  sentinel?: SentinelPolicy;
};

export type ProviderReplicationCapability = {
  providerType: string;
  oauthPreset?: string;
  supportsPersonal: boolean;
  supportsShared: boolean;
  sharedJoinerIdentity?: "email";
};

export function defaultVaultArchitecture(): VaultArchitecture {
  return normalizeVaultArchitecture(
    wasmDefaultVaultArchitecture() as Partial<VaultArchitecture>,
  );
}

export function validateVaultArchitecture(
  architecture: VaultArchitecture,
): VaultArchitecture {
  return normalizeVaultArchitecture(
    wasmValidateVaultArchitecture(architecture) as Partial<VaultArchitecture>,
  );
}

function normalizeVaultArchitecture(
  architecture: Partial<VaultArchitecture>,
): VaultArchitecture {
  return {
    device_mode: architecture.device_mode ?? "standard",
    vault_type: architecture.vault_type ?? "simple",
    replication_type: architecture.replication_type ?? "personal",
    sentinel: architecture.sentinel,
  };
}

export function onboardingType(architecture: VaultArchitecture): string {
  return wasmVaultArchitectureOnboardingType(architecture);
}

export function providerOnboardingType(
  provider: StorageProvider,
  architecture: VaultArchitecture,
): string {
  return wasmProviderOnboardingType(provider, architecture);
}

export function canCreateSecret(architecture: VaultArchitecture): boolean {
  return wasmVaultArchitectureCanCreateSecret(architecture);
}

export function providerReplicationCapability(
  provider: StorageProvider,
): ProviderReplicationCapability {
  return wasmProviderReplicationCapability(
    provider,
  ) as ProviderReplicationCapability;
}

export function validateProviderReplication(
  provider: StorageProvider,
  replicationType: ReplicationType,
): ProviderReplicationCapability {
  return wasmValidateProviderReplication(
    provider,
    replicationType,
  ) as ProviderReplicationCapability;
}

export type ProviderCapabilityLabelKey =
  | "provider_picker.capability_personal_only"
  | "provider_picker.capability_personal_shared";

/** Presentation label derived from the Rust-owned provider capability. */
export function providerCapabilityLabelKey(
  provider: StorageProvider,
): ProviderCapabilityLabelKey {
  const capability = providerReplicationCapability(provider);
  return capability.supportsShared
    ? "provider_picker.capability_personal_shared"
    : "provider_picker.capability_personal_only";
}

/** Fail closed by asking Rust to validate this provider/mode combination. */
export function providerSupportsReplication(
  provider: StorageProvider,
  replicationType: ReplicationType,
): boolean {
  return wasmProviderSupportsReplication(provider, replicationType);
}

/**
 * Keep the user's compatible selection, otherwise choose the first provider
 * accepted by Rust. Incompatible rows remain visible for explanation/removal.
 */
export function firstCompatibleProvider(
  providers: StorageProvider[],
  replicationType: ReplicationType,
  preferredId?: string,
): StorageProvider | undefined {
  const selectedId = wasmFirstCompatibleProviderId(
    providers,
    replicationType,
    preferredId ?? undefined,
  );
  return providers.find((provider) => provider.id === selectedId);
}

export type SharedStorageGrantRequest = {
  providerType: string;
  oauthPreset?: string;
  joinerIdentityKind: "email";
  joinerIdentity: string;
  storageTargetHint?: string;
  storageTargetId?: string;
  accessToken?: string;
};

export type SharedStorageGrantOutcome =
  | {
      kind: "granted";
      note: string;
      storageTargetId: string;
      storageTargetName?: string;
    }
  | {
      kind: "manual-grant-required";
      instructionsKey: string;
      joinerIdentity: string;
      storageTargetId?: string;
      storageTargetName?: string;
    }
  | { kind: "unsupported"; reasonKey: string };

export async function prepareSharedStorageGrant(
  request: SharedStorageGrantRequest,
): Promise<SharedStorageGrantOutcome> {
  return (await wasmPrepareSharedStorageGrant(
    request,
  )) as SharedStorageGrantOutcome;
}
