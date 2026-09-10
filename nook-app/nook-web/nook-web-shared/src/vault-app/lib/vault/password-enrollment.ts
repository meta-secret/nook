import {
  select_shared_grant_provider,
  should_flush_shared_storage_grant,
  type SharedStorageGrantCredential,
  type SharedGrantProviderSelection,
} from "$app-wasm";
export type { SharedGrantProviderSelection } from "$app-wasm";
import {
  oauth_access_token,
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

export type SharedGrantProviderSearch = {
  readonly providers: StorageProvider[];
  readonly preset: OAuthFilePreset;
  readonly target: SharedStorageTarget;
};

export type SharedDriveGrantFlushAssessment = {
  readonly grant: SharedStorageGrantOutcome;
  readonly accessCredential: ReturnType<typeof oauth_access_token>;
};

export function findSharedGrantProvider({
  providers,
  preset,
  target,
}: SharedGrantProviderSearch): SharedGrantProviderSelection {
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
    accessCredential.kind === "available"
      ? { state: "accessToken", accessToken: accessCredential.token }
      : { state: "unavailable" };
  return should_flush_shared_storage_grant(grant, credential);
}
