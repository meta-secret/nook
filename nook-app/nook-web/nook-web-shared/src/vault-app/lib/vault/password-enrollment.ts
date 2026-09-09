import {
  select_shared_grant_provider,
  should_flush_shared_storage_grant,
  type SharedStorageGrantCredential,
  type SharedGrantProviderSelection,
} from "$app-wasm";
import {
  oauthAccessToken,
  OAuthAccessTokenKind,
  unselectedVaultScope,
  type OAuthFilePreset,
  type StorageProvider,
} from "$lib/auth/providers";
import type { SharedStorageGrantOutcome } from "$lib/vault/architecture-model";

export enum SharedStorageTargetKind {
  NotBound = "not-bound",
  Bound = "bound",
}

export type SharedStorageTarget =
  | { kind: SharedStorageTargetKind.NotBound }
  | { kind: SharedStorageTargetKind.Bound; storageTargetId: string };

export type SharedGrantProvider = SharedGrantProviderSelection;

export type SharedGrantProviderSearch = {
  readonly providers: StorageProvider[];
  readonly preset: OAuthFilePreset;
  readonly target: SharedStorageTarget;
};

export type SharedDriveGrantFlushAssessment = {
  readonly grant: SharedStorageGrantOutcome;
  readonly accessCredential: ReturnType<typeof oauthAccessToken>;
};

export function findSharedGrantProvider({
  providers,
  preset,
  target,
}: SharedGrantProviderSearch): SharedGrantProvider {
  return select_shared_grant_provider({
    snapshot: { providers, activeVaultStoreId: unselectedVaultScope() },
    preset,
    target:
      target.kind === SharedStorageTargetKind.Bound
        ? { state: "existing", storageTargetId: target.storageTargetId }
        : { state: "create" },
  });
}

export function shouldFlushSharedDriveGrant({
  grant,
  accessCredential,
}: SharedDriveGrantFlushAssessment): boolean {
  const credential: SharedStorageGrantCredential =
    accessCredential.kind === OAuthAccessTokenKind.Available
      ? { state: "accessToken", accessToken: accessCredential.token }
      : { state: "unavailable" };
  return should_flush_shared_storage_grant(grant, credential);
}
