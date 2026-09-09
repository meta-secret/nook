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

export class ProviderVaultProjectionReader {
  constructor(private readonly request: NookProviderVaultDecisionProjection) {}
  read(): ProviderVaultEvidence {
    const projection = this.request;
    try {
      return {
        kind: ProviderVaultEvidenceKind.Ready,
        decision: projection.decision,
        reason: projection.reason,
        identities: projection.identities.map(
          ProviderVaultEvidenceReader.readProviderVaultIdentity,
        ),
      };
    } finally {
      projection.free();
    }
  }
}
export class ProviderVaultEvidenceReader {
  constructor(private readonly request: LoadProviderVaultEvidenceRequest) {}
  async execute(): Promise<ProviderVaultEvidence> {
    const { manager, providerStoreId } = this.request;
    try {
      const projection =
        await manager.provider_vault_decision_request(providerStoreId);
      return new ProviderVaultProjectionReader(projection).read();
    } catch {
      return { kind: ProviderVaultEvidenceKind.Failed };
    }
  }
  static readProviderVaultIdentity(
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
}
export class PreparedProviderVaultIdentities {
  constructor(private readonly request: readonly ProviderVaultIdentityView[]) {}
  get identities(): readonly ProviderVaultIdentityView[] {
    const identities = this.request;
    return identities.filter(
      (identity) =>
        identity.eligibility ===
        ProviderVaultIdentityEligibility.LinkedAndPrepared,
    );
  }
}
