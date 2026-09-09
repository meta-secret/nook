import {
  type NookProviderVaultDecisionProjection,
  type NookProviderVaultIdentityProjection,
  type NookVaultManager,
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

export type ProviderVaultIdentitySelection =
  | { readonly kind: ProviderVaultIdentitySelectionKind.NotSelected }
  | {
      readonly kind: ProviderVaultIdentitySelectionKind.Selected;
      readonly identityId: string;
    };

export type ProviderVaultEvidence =
  | { readonly kind: ProviderVaultEvidenceKind.Loading }
  | { readonly kind: ProviderVaultEvidenceKind.Failed }
  | {
      readonly kind: ProviderVaultEvidenceKind.Ready;
      readonly projection: NookProviderVaultDecisionProjection;
      readonly identities: readonly NookProviderVaultIdentityProjection[];
    };

type LoadProviderVaultEvidenceRequest = {
  readonly manager: NookVaultManager;
  readonly providerStoreId: string;
};

export class ProviderVaultEvidenceReader {
  constructor(private readonly request: LoadProviderVaultEvidenceRequest) {}
  async execute(): Promise<ProviderVaultEvidence> {
    const { manager, providerStoreId } = this.request;
    try {
      const projection =
        await manager.provider_vault_decision_request(providerStoreId);
      try {
        return {
          kind: ProviderVaultEvidenceKind.Ready,
          projection,
          identities: projection.identities,
        };
      } catch (error) {
        projection.free();
        throw error;
      }
    } catch {
      return { kind: ProviderVaultEvidenceKind.Failed };
    }
  }
  static release(evidence: ProviderVaultEvidence): void {
    if (evidence.kind !== ProviderVaultEvidenceKind.Ready) return;
    for (const identity of evidence.identities) identity.free();
    evidence.projection.free();
  }
}
