import {
  NookVaultArchitecture,
  NookSharedStorageGrantRequestValue,
  NookStorageProviderList,
  NookStorageProviderValue,
  defaultVaultArchitecture as wasmDefaultVaultArchitecture,
  enrollmentProviderForArchitecture as wasmEnrollmentProviderForArchitecture,
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
import type {
  NookEnrollmentProvider,
  NookProviderReplicationCapability,
} from "$app-wasm";
import type { StorageProvider } from "$lib/auth-providers";

export type DeviceMode = "standard" | "anti-hacker";
export type VaultType = "simple" | "sentinel";
export type ReplicationType = "personal" | "shared";

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

export type VaultArchitecture = NookVaultArchitecture & {
  readonly device_mode: DeviceMode;
  readonly vault_type: VaultType;
  readonly replication_type: ReplicationType;
};
export type ProviderReplicationCapability = NookProviderReplicationCapability;

function withProvider<T>(
  provider: StorageProvider,
  operation: (value: NookStorageProviderValue) => T,
): T {
  const value = NookStorageProviderValue.fromObject(
    JSON.parse(JSON.stringify(provider)) as object,
  );
  try {
    return operation(value);
  } finally {
    value.free();
  }
}

export function defaultVaultArchitecture(): VaultArchitecture {
  return wasmDefaultVaultArchitecture() as VaultArchitecture;
}

export function draftVaultArchitecture(
  deviceMode: DeviceMode,
  vaultType: VaultType,
  replicationType: ReplicationType,
): VaultArchitecture {
  return NookVaultArchitecture.draft(
    deviceMode,
    vaultType,
    replicationType,
  ) as VaultArchitecture;
}

export function validateVaultArchitecture(
  architecture: VaultArchitectureDraft,
): VaultArchitecture {
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
    return wasmValidateVaultArchitecture(candidate) as VaultArchitecture;
  } finally {
    candidate.free();
  }
}

export function onboardingType(architecture: VaultArchitecture): string {
  return wasmVaultArchitectureOnboardingType(architecture);
}

export function providerOnboardingType(
  provider: StorageProvider,
  architecture: VaultArchitecture,
): string {
  return withProvider(provider, (value) =>
    wasmProviderOnboardingType(value, architecture),
  );
}

export function enrollmentProviderForArchitecture(
  provider: StorageProvider,
  architecture: VaultArchitecture,
  sharedJoinerIdentity?: string,
  sharedStorageTargetId?: string,
): NookEnrollmentProvider {
  return withProvider(provider, (value) =>
    wasmEnrollmentProviderForArchitecture(
      value,
      architecture,
      sharedJoinerIdentity,
      sharedStorageTargetId,
    ),
  );
}

export function canCreateSecret(architecture: VaultArchitecture): boolean {
  return wasmVaultArchitectureCanCreateSecret(architecture);
}

export function providerReplicationCapability(
  provider: StorageProvider,
): ProviderReplicationCapability {
  return withProvider(provider, wasmProviderReplicationCapability);
}

export function validateProviderReplication(
  provider: StorageProvider,
  replicationType: ReplicationType,
): ProviderReplicationCapability {
  return withProvider(provider, (value) =>
    wasmValidateProviderReplication(value, replicationType),
  );
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

/** Fail closed by asking Rust to validate this provider/mode combination. */
export function providerSupportsReplication(
  provider: StorageProvider,
  replicationType: ReplicationType,
): boolean {
  return withProvider(provider, (value) =>
    wasmProviderSupportsReplication(value, replicationType),
  );
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
  const providerList = NookStorageProviderList.fromArray(
    JSON.parse(JSON.stringify(providers)) as object[],
  );
  let selectedId: string | undefined;
  try {
    selectedId = wasmFirstCompatibleProviderId(
      providerList,
      replicationType,
      preferredId ?? undefined,
    );
  } finally {
    providerList.free();
  }
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
  const requestValue = NookSharedStorageGrantRequestValue.fromObject(
    JSON.parse(JSON.stringify(request)) as object,
  );
  try {
    const outcome = await wasmPrepareSharedStorageGrant(requestValue);
    try {
      return outcome.toObject() as SharedStorageGrantOutcome;
    } finally {
      outcome.free();
    }
  } finally {
    requestValue.free();
  }
}
