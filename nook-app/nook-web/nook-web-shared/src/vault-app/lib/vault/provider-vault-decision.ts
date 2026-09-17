import { ok, err, type Result } from "neverthrow";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
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
  | ReadyProviderVaultEvidence;

export class ReadyProviderVaultEvidence {
  readonly kind = ProviderVaultEvidenceKind.Ready;
  constructor(
    readonly projection: NookProviderVaultDecisionProjection,
    readonly identities: readonly NookProviderVaultIdentityProjection[],
  ) {}
  release(): void {
    for (const identity of this.identities) identity.free();
    this.projection.free();
  }
}

type LoadProviderVaultEvidenceRequest = {
  readonly manager: NookVaultManager;
  readonly providerStoreId: string;
};

export class ProviderVaultEvidenceReader {
  constructor(private readonly request: LoadProviderVaultEvidenceRequest) {}
  async execute(): Promise<
    Result<ReadyProviderVaultEvidence, VaultStorageFailure>
  > {
    const { manager, providerStoreId } = this.request;
    let projection: NookProviderVaultDecisionProjection;
    try {
      projection =
        await manager.provider_vault_decision_request(providerStoreId);
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    try {
      return ok(
        new ReadyProviderVaultEvidence(projection, projection.identities),
      );
    } catch (failure) {
      projection.free();
      return err(new NativeVaultStorageFailure(failure));
    }
  }
}
