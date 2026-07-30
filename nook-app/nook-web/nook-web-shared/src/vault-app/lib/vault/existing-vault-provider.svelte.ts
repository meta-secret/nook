import {
  ExistingVaultProviderSnapshotKind,
  type ExistingVaultProviderSnapshot,
} from "$lib/app-lifecycle-state";
import {
  existingVaultProviderReadiness,
  NookExistingVaultProviderReadiness,
} from "$app-wasm";
import {
  GITHUB_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  type StorageProviderType,
} from "$lib/auth-providers";
import type { ProviderActionsContext } from "$lib/vault/action-contexts";
import {
  LocalFolderDraftKind,
  OAuthFileDraftKind,
} from "$lib/vault/state/provider.svelte";

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
        kind: ExistingVaultProviderSnapshotKind.Github,
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
        kind: ExistingVaultProviderSnapshotKind.OAuthFile,
        setupType,
        oauthFile: $state.snapshot(state.requireOauthFileConfig()),
      },
    };
  }
  if (setupType === LOCAL_FOLDER_PROVIDER_TYPE) {
    return {
      kind: NookExistingVaultProviderReadiness.Ready,
      provider: {
        kind: ExistingVaultProviderSnapshotKind.LocalFolder,
        setupType,
        localFolder: $state.snapshot(state.requireLocalFolderConfig()),
      },
    };
  }
  return {
    kind: NookExistingVaultProviderReadiness.Ready,
    provider: {
      kind: ExistingVaultProviderSnapshotKind.Local,
      setupType,
    },
  };
}
