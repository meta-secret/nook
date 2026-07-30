import {
  DeviceMode,
  NookVaultArchitecture,
  OnboardingType,
  ReplicationType,
  VaultType,
  defaultVaultArchitecture,
  firstCompatibleProviderId as wasmFirstCompatibleProviderId,
  firstCompatibleProviderIdPreferred as wasmFirstCompatibleProviderIdPreferred,
  NookProviderSelectionState,
  providerOauthPresetForConfig,
  providerOauthPresetForProvider,
  providerReplicationCapability,
  providerSupportsReplication,
  prepareSharedStorageGrant,
  providerOnboardingType,
  validateProviderReplication,
  validateVaultArchitecture as wasmValidateVaultArchitecture,
  vaultArchitectureCanCreateSecret as canCreateSecret,
  vaultArchitectureOnboardingType as onboardingType,
  type SharedStorageGrantCredential,
  type SharedStorageTargetHint,
  type SharedStorageTargetSelection,
} from "$app-wasm";
import {
  unselectedVaultScope,
  type StorageProvider,
} from "$lib/auth-providers";

export type {
  NookProviderReplicationCapability as ProviderReplicationCapability,
  SharedStorageGrantOutcome,
  SharedStorageGrantRequest,
  NookVaultArchitecture as VaultArchitecture,
} from "$app-wasm";

export {
  DeviceMode,
  OnboardingType,
  ReplicationType,
  VaultType,
  canCreateSecret,
  defaultVaultArchitecture,
  onboardingType,
  providerOnboardingType,
  providerOauthPresetForConfig,
  providerOauthPresetForProvider,
  providerReplicationCapability,
  providerSupportsReplication,
  prepareSharedStorageGrant,
  validateProviderReplication,
};

export function suggestedSharedStorageTarget(
  name: string,
): SharedStorageTargetHint {
  return { state: "suggested", hint: name };
}

export function createSharedStorageTarget(): SharedStorageTargetSelection {
  return { state: "create" };
}

export function existingSharedStorageTarget(
  storageTargetId: string,
): SharedStorageTargetSelection {
  return { state: "existing", storageTargetId };
}

export function sharedStorageGrantAccessToken(
  accessToken: string,
): SharedStorageGrantCredential {
  return { state: "accessToken", accessToken };
}

export function unavailableSharedStorageGrantCredential(): SharedStorageGrantCredential {
  return { state: "unavailable" };
}

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
    architecture.vault_type === VaultType.Sentinel
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

export enum ProviderCapabilityLabelKey {
  PersonalOnly = "provider_picker.capability_personal_only",
  PersonalShared = "provider_picker.capability_personal_shared",
}

/** Presentation label derived from the Rust-owned provider capability. */
export function providerCapabilityLabelKey(
  provider: StorageProvider,
): ProviderCapabilityLabelKey {
  const capability = providerReplicationCapability(provider);
  try {
    return capability.supportsShared
      ? ProviderCapabilityLabelKey.PersonalShared
      : ProviderCapabilityLabelKey.PersonalOnly;
  } finally {
    capability.free();
  }
}

/**
 * Keep the user's compatible selection, otherwise choose the first provider
 * accepted by Rust. Incompatible rows remain visible for explanation/removal.
 */
export enum CompatibleProviderSelectionKind {
  Selected = "selected",
  Unavailable = "unavailable",
}

export type CompatibleProviderSelection =
  | {
      kind: CompatibleProviderSelectionKind.Selected;
      provider: StorageProvider;
    }
  | { kind: CompatibleProviderSelectionKind.Unavailable };

export enum CompatibleProviderPreferenceKind {
  Automatic = "automatic",
  Selected = "selected",
}

export type CompatibleProviderPreference =
  | { kind: CompatibleProviderPreferenceKind.Automatic }
  | {
      kind: CompatibleProviderPreferenceKind.Selected;
      providerId: string;
    };

export function firstCompatibleProvider(
  providers: StorageProvider[],
  replicationType: ReplicationType,
  preference: CompatibleProviderPreference,
): CompatibleProviderSelection {
  const snapshot = {
    providers,
    activeVaultStoreId: unselectedVaultScope(),
  };
  const selection =
    preference.kind === CompatibleProviderPreferenceKind.Selected
      ? wasmFirstCompatibleProviderIdPreferred(
          snapshot,
          replicationType,
          preference.providerId,
        )
      : wasmFirstCompatibleProviderId(snapshot, replicationType);
  if (selection.state === NookProviderSelectionState.Selected) {
    const provider = providers.find(
      (candidate) => candidate.id === selection.providerId,
    );
    selection.free();
    return provider
      ? { kind: CompatibleProviderSelectionKind.Selected, provider }
      : { kind: CompatibleProviderSelectionKind.Unavailable };
  }
  selection.free();
  return { kind: CompatibleProviderSelectionKind.Unavailable };
}
