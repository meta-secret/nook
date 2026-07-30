import {
  NookOAuthAccountIdentityState,
  NookOAuthRefreshCredentialState,
  NookOAuthRemoteFileState,
  NookOAuthTokenExpiryState,
  type NookEnrollmentProvider,
} from "$app-wasm";
import {
  oauthAccessToken,
  OAuthAccessTokenKind,
  isConfiguredOAuthFile,
  oauthRefreshCredentialNotIssued,
  OAUTH_FILE_PROVIDER_TYPE,
  storedOAuthAccountEmail,
  storedOAuthRefreshCredential,
  storedOAuthRemoteFileId,
  storedOAuthRemoteFileName,
  storedOAuthTokenExpiry,
  unknownOAuthAccountIdentity,
  unknownOAuthTokenExpiry,
  unresolvedOAuthRemoteFileId,
  unresolvedOAuthRemoteFileName,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
} from "$lib/auth-providers";
import type { SharedStorageGrantOutcome } from "$lib/vault-architecture";

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

export function findSharedGrantProvider(
  providers: StorageProvider[],
  preset: OAuthFilePreset,
  target: SharedStorageTarget,
): SharedGrantProvider {
  const withToken = providers.filter((provider) => {
    const configuration = provider.oauthFile;
    return (
      provider.type === OAUTH_FILE_PROVIDER_TYPE &&
      isConfiguredOAuthFile(configuration) &&
      configuration.config.preset === preset &&
      oauthAccessToken(configuration.config).kind ===
        OAuthAccessTokenKind.Available
    );
  });
  if (target.kind === SharedStorageTargetKind.Bound) {
    const provider = withToken.find((candidate) => {
      const configuration = candidate.oauthFile;
      if (!isConfiguredOAuthFile(configuration)) {
        return false;
      }
      const { folderId, iCloudShareTarget } = configuration.config;
      return (
        (folderId.state === "folderId" &&
          folderId.value === target.storageTargetId) ||
        (iCloudShareTarget.state === "sharedTarget" &&
          iCloudShareTarget.value === target.storageTargetId)
      );
    });
    return provider
      ? { kind: SharedGrantProviderKind.Existing, provider }
      : { kind: SharedGrantProviderKind.AuthorizationRequired };
  }
  const provider = withToken[0];
  return provider
    ? { kind: SharedGrantProviderKind.Existing, provider }
    : { kind: SharedGrantProviderKind.AuthorizationRequired };
}

export function shouldFlushSharedDriveGrant(
  grant: SharedStorageGrantOutcome,
  accessCredential: ReturnType<typeof oauthAccessToken>,
): boolean {
  return (
    grant.kind !== "unsupported" &&
    accessCredential.kind === OAuthAccessTokenKind.Available
  );
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
