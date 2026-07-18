import {
  NookVaultArchitecture,
  defaultVaultArchitecture,
  firstCompatibleProviderId as wasmFirstCompatibleProviderId,
  providerReplicationCapability,
  providerSupportsReplication,
  prepareSharedStorageGrant,
  providerOnboardingType,
  validateProviderReplication,
  validateVaultArchitecture as wasmValidateVaultArchitecture,
  vaultArchitectureCanCreateSecret as canCreateSecret,
  vaultArchitectureOnboardingType as onboardingType,
} from "$app-wasm";
import type { DeviceMode, ReplicationType, VaultType } from "$app-wasm";
import type { StorageProvider } from "$lib/auth-providers";

export type {
  DeviceMode,
  NookProviderReplicationCapability as ProviderReplicationCapability,
  ReplicationType,
  SharedStorageGrantOutcome,
  SharedStorageGrantRequest,
  NookVaultArchitecture as VaultArchitecture,
  VaultType,
} from "$app-wasm";

export {
  canCreateSecret,
  defaultVaultArchitecture,
  onboardingType,
  providerOnboardingType,
  providerReplicationCapability,
  providerSupportsReplication,
  prepareSharedStorageGrant,
  validateProviderReplication,
};

export type VaultArchitectureDraft = {
  device_mode: DeviceMode;
  vault_type: VaultType;
  replication_type: ReplicationType;
  sentinel?: {
    threshold: number;
    required_participants: number;
    ready_participants: number;
  };
};

export function validateVaultArchitecture(
  architecture: VaultArchitectureDraft,
): NookVaultArchitecture {
  const candidate =
    architecture.vault_type === "sentinel"
      ? NookVaultArchitecture.sentinel(
          architecture.device_mode,
          architecture.replication_type,
          architecture.sentinel?.threshold ?? 2,
          architecture.sentinel?.required_participants ?? 3,
          architecture.sentinel?.ready_participants ?? 0,
        )
      : NookVaultArchitecture.simple(
          architecture.device_mode,
          architecture.replication_type,
        );
  try {
    return wasmValidateVaultArchitecture(candidate);
  } finally {
    candidate.free();
  }
}

export type ProviderCapabilityLabelKey =
  | "provider_picker.capability_personal_only"
  | "provider_picker.capability_personal_shared";

/** Presentation label derived from the Rust-owned provider capability. */
export function providerCapabilityLabelKey(
  provider: StorageProvider,
): ProviderCapabilityLabelKey {
  const capability = providerReplicationCapability(provider);
  try {
    return capability.supportsShared
      ? "provider_picker.capability_personal_shared"
      : "provider_picker.capability_personal_only";
  } finally {
    capability.free();
  }
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
    { providers },
    replicationType,
    preferredId ?? undefined,
  );
  return providers.find((provider) => provider.id === selectedId);
}
