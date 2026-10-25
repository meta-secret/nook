import { select_shared_grant_provider } from "$app-wasm";
import {
  unselectedVaultScope,
  type OAuthFilePreset,
  type StorageProvider,
} from "$lib/auth/providers";

export enum SharedStorageTargetKind {
  NotBound = "not-bound",
  Bound = "bound",
}

export enum SharedGrantProviderOutcomeKind {
  AuthorizationRequired = "authorizationRequired",
  Existing = "existing",
}

export type SharedStorageTarget =
  | { kind: SharedStorageTargetKind.NotBound }
  | { kind: SharedStorageTargetKind.Bound; storageTargetId: string };

export type SharedGrantProviderOutcome =
  | {
      kind: `${SharedGrantProviderOutcomeKind.AuthorizationRequired}`;
    }
  | {
      kind: `${SharedGrantProviderOutcomeKind.Existing}`;
      provider: StorageProvider;
    };

export type SharedGrantProviderSearch = {
  readonly providers: StorageProvider[];
  readonly preset: OAuthFilePreset;
  readonly target: SharedStorageTarget;
};

export function findSharedGrantProvider({
  providers,
  preset,
  target,
}: SharedGrantProviderSearch): SharedGrantProviderOutcome {
  const selection: Parameters<typeof select_shared_grant_provider>[0] = {
    snapshot: { providers, activeVaultStoreId: unselectedVaultScope() },
    preset,
    target:
      target.kind === SharedStorageTargetKind.Bound
        ? { state: "existing", storageTargetId: target.storageTargetId }
        : { state: "create" },
  };
  return select_shared_grant_provider(selection);
}
