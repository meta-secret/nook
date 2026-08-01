import {
  existingVaultProviderReadiness,
  NookExistingVaultProviderReadiness,
} from "$app-wasm";
import {
  GITHUB_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  type StorageProviderType,
  type LocalFolderConfig,
  type OAuthFileConfig,
} from "$lib/auth-providers";
import type { ProviderActionsContext } from "$lib/vault/action-contexts";
import {
  LocalFolderDraftKind,
  OAuthFileDraftKind,
} from "$lib/vault/state/provider.svelte";

export type ExistingVaultProviderSnapshot =
  | { setupType: typeof LOCAL_PROVIDER_TYPE }
  | {
      setupType: typeof GITHUB_PROVIDER_TYPE;
      githubPat: string;
      githubRepo: string;
    }
  | {
      setupType: typeof OAUTH_FILE_PROVIDER_TYPE;
      oauthFile: OAuthFileConfig;
    }
  | {
      setupType: typeof LOCAL_FOLDER_PROVIDER_TYPE;
      localFolder: LocalFolderConfig;
    };

export type ExistingVaultProviderPreparation =
  | { kind: NookExistingVaultProviderReadiness.MissingOauthFile }
  | { kind: NookExistingVaultProviderReadiness.MissingLocalFolder }
  | {
      kind: NookExistingVaultProviderReadiness.Ready;
      provider: ExistingVaultProviderSnapshot;
    };

export function prepareExistingVaultProvider(
  state: ProviderActionsContext,
  setupType: StorageProviderType,
): ExistingVaultProviderPreparation {
  const readiness = existingVaultProviderReadiness(
    setupType,
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured,
    state.localFolderDraft.kind === LocalFolderDraftKind.Configured,
  );
  if (readiness !== NookExistingVaultProviderReadiness.Ready) {
    return { kind: readiness };
  }
  if (setupType === GITHUB_PROVIDER_TYPE) {
    return {
      kind: NookExistingVaultProviderReadiness.Ready,
      provider: {
        setupType,
        githubPat: state.githubPat,
        githubRepo: state.githubRepo,
      },
    };
  }
  if (setupType === OAUTH_FILE_PROVIDER_TYPE) {
    return {
      kind: NookExistingVaultProviderReadiness.Ready,
      provider: {
        setupType,
        oauthFile: $state.snapshot(state.requireOauthFileConfig()),
      },
    };
  }
  if (setupType === LOCAL_FOLDER_PROVIDER_TYPE) {
    return {
      kind: NookExistingVaultProviderReadiness.Ready,
      provider: {
        setupType,
        localFolder: $state.snapshot(state.requireLocalFolderConfig()),
      },
    };
  }
  return {
    kind: NookExistingVaultProviderReadiness.Ready,
    provider: {
      setupType: LOCAL_PROVIDER_TYPE,
    },
  };
}
