import {
  NookOAuthAccountIdentityState,
  NookOAuthRefreshCredentialState,
  NookOAuthRemoteFileState,
  NookOAuthTokenExpiryState,
  NookProviderSelectionState,
  shared_grant_provider_id,
  should_flush_shared_storage_grant,
  type NookEnrollmentProvider,
  type SharedStorageGrantCredential,
} from "$app-wasm";
import {
  oauthAccessToken,
  OAuthAccessTokenKind,
  oauthRefreshCredentialNotIssued,
  storedOAuthAccountEmail,
  storedOAuthRefreshCredential,
  storedOAuthRemoteFileId,
  storedOAuthRemoteFileName,
  storedOAuthTokenExpiry,
  unselectedVaultScope,
  unknownOAuthAccountIdentity,
  unknownOAuthTokenExpiry,
  unresolvedOAuthRemoteFileId,
  unresolvedOAuthRemoteFileName,
  type OAuthFileConfig,
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

export enum SharedGrantProviderKind {
  Existing = "existing",
  AuthorizationRequired = "authorization-required",
}

export type SharedGrantProvider =
  | { kind: SharedGrantProviderKind.Existing; provider: StorageProvider }
  | { kind: SharedGrantProviderKind.AuthorizationRequired };

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
  const snapshot: Parameters<typeof shared_grant_provider_id>[0] = {
    providers,
    activeVaultStoreId: unselectedVaultScope(),
  };
  const storageTarget: Parameters<typeof shared_grant_provider_id>[2] =
    target.kind === SharedStorageTargetKind.Bound
      ? { state: "existing", storageTargetId: target.storageTargetId }
      : { state: "create" };
  const selection = shared_grant_provider_id(snapshot, preset, storageTarget);
  try {
    if (selection.state !== NookProviderSelectionState.Selected) {
      return { kind: SharedGrantProviderKind.AuthorizationRequired };
    }
    const provider = providers.find(
      (candidate) => candidate.id === selection.providerId,
    );
    return provider
      ? { kind: SharedGrantProviderKind.Existing, provider }
      : { kind: SharedGrantProviderKind.AuthorizationRequired };
  } finally {
    selection.free();
  }
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

export function enrollmentOauthState(
  provider: NookEnrollmentProvider,
): Pick<
  OAuthFileConfig,
  "refreshToken" | "expiresAt" | "fileId" | "fileName" | "accountEmail"
> {
  const refresh = provider.oauthRefresh;
  const expiry = provider.oauthExpiry;
  const remoteFile = provider.oauthRemoteFile;
  const account = provider.oauthAccount;
  try {
    return {
      refreshToken:
        refresh.state === NookOAuthRefreshCredentialState.Token
          ? storedOAuthRefreshCredential(refresh.value)
          : oauthRefreshCredentialNotIssued(),
      expiresAt:
        expiry.state === NookOAuthTokenExpiryState.ExpiresAt
          ? storedOAuthTokenExpiry(expiry.value)
          : unknownOAuthTokenExpiry(),
      fileId:
        remoteFile.state === NookOAuthRemoteFileState.FileId ||
        remoteFile.state === NookOAuthRemoteFileState.Identified
          ? storedOAuthRemoteFileId(remoteFile.fileIdValue)
          : unresolvedOAuthRemoteFileId(),
      fileName:
        remoteFile.state === NookOAuthRemoteFileState.FileName ||
        remoteFile.state === NookOAuthRemoteFileState.Identified
          ? storedOAuthRemoteFileName(remoteFile.fileNameValue)
          : unresolvedOAuthRemoteFileName(),
      accountEmail:
        account.state === NookOAuthAccountIdentityState.Email
          ? storedOAuthAccountEmail(account.value)
          : unknownOAuthAccountIdentity(),
    };
  } finally {
    refresh.free();
    expiry.free();
    remoteFile.free();
    account.free();
  }
}
