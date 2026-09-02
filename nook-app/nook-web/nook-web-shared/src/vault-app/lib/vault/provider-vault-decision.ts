import {
  type NookProviderVaultDecisionProjection,
  type NookProviderVaultIdentityProjection,
  type NookVaultManager,
  ProviderVaultDecision,
  ProviderVaultDecisionReason,
  ProviderVaultIdentityEligibility,
} from "$app-wasm";

export enum ProviderVaultEvidenceKind {
  Loading = "loading",
  Ready = "ready",
  Failed = "failed",
}

export enum ProviderVaultIdentitySelectionKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

export enum ProviderVaultIdentityCurrentKind {
  Current = "current",
  Other = "other",
}

export type ProviderVaultIdentitySelection =
  | { readonly kind: ProviderVaultIdentitySelectionKind.NotSelected }
  | {
      readonly kind: ProviderVaultIdentitySelectionKind.Selected;
      readonly identityId: string;
    };

export type ProviderVaultIdentityView = {
  readonly identityId: string;
  readonly label: string;
  readonly currentKind: ProviderVaultIdentityCurrentKind;
  readonly eligibility: ProviderVaultIdentityEligibility;
};

export type ProviderVaultEvidence =
  | { readonly kind: ProviderVaultEvidenceKind.Loading }
  | { readonly kind: ProviderVaultEvidenceKind.Failed }
  | {
      readonly kind: ProviderVaultEvidenceKind.Ready;
      readonly decision: ProviderVaultDecision;
      readonly reason: ProviderVaultDecisionReason;
      readonly identities: readonly ProviderVaultIdentityView[];
    };

type LoadProviderVaultEvidenceRequest = {
  readonly manager: NookVaultManager;
  readonly providerStoreId: string;
};

function readProviderVaultIdentity(
  identity: NookProviderVaultIdentityProjection,
): ProviderVaultIdentityView {
  try {
    return {
      identityId: identity.identityId,
      label: identity.identityLabel,
      currentKind: identity.isCurrentApp
        ? ProviderVaultIdentityCurrentKind.Current
        : ProviderVaultIdentityCurrentKind.Other,
      eligibility: identity.eligibility,
    };
  } finally {
    identity.free();
  }
}

export function readProviderVaultProjection(
  projection: NookProviderVaultDecisionProjection,
): ProviderVaultEvidence {
  try {
    return {
      kind: ProviderVaultEvidenceKind.Ready,
      decision: projection.decision,
      reason: projection.reason,
      identities: projection.identities.map(readProviderVaultIdentity),
    };
  } finally {
    projection.free();
  }
}

export async function loadProviderVaultEvidence({
  manager,
  providerStoreId,
}: LoadProviderVaultEvidenceRequest): Promise<ProviderVaultEvidence> {
  try {
    const projection =
      await manager.provider_vault_decision_request(providerStoreId);
    return readProviderVaultProjection(projection);
  } catch {
    return { kind: ProviderVaultEvidenceKind.Failed };
  }
}

export function preparedProviderVaultIdentities(
  identities: readonly ProviderVaultIdentityView[],
): readonly ProviderVaultIdentityView[] {
  return identities.filter(
    (identity) =>
      identity.eligibility ===
      ProviderVaultIdentityEligibility.LinkedAndPrepared,
  );
}
