import { err, ok, type Result } from "neverthrow";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import {
  existing_vault_provider_readiness,
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
} from "$lib/auth/providers";
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

export type ExistingVaultProviderRequest = {
  readonly state: ProviderActionsContext;
  readonly setupType: StorageProviderType;
};

/** Owns one browser draft snapshot before it enters the Rust import workflow. */
export class ExistingVaultProviderDraft {
  constructor(private readonly request: ExistingVaultProviderRequest) {}

  prepare(): Result<ExistingVaultProviderPreparation, VaultStorageFailure> {
    const { state, setupType } = this.request;
    const oauth = state.oauthFileDraft;
    const folder = state.localFolderDraft;
    let readiness: NookExistingVaultProviderReadiness;
    try {
      readiness = existing_vault_provider_readiness(
        setupType,
        oauth.kind === OAuthFileDraftKind.Configured,
        folder.kind === LocalFolderDraftKind.Configured,
      );
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    if (readiness !== NookExistingVaultProviderReadiness.Ready) {
      const incomplete: ExistingVaultProviderPreparation = { kind: readiness };
      return ok(incomplete);
    }
    if (setupType === GITHUB_PROVIDER_TYPE) {
      const preparation: ExistingVaultProviderPreparation = {
        kind: readiness,
        provider: {
          setupType,
          githubPat: state.githubPat,
          githubRepo: state.githubRepo,
        },
      };
      return ok(preparation);
    }
    if (setupType === OAUTH_FILE_PROVIDER_TYPE) {
      if (oauth.kind !== OAuthFileDraftKind.Configured) {
        const missingOAuthFile: ExistingVaultProviderPreparation = {
          kind: NookExistingVaultProviderReadiness.MissingOauthFile,
        };
        return ok(missingOAuthFile);
      }
      const preparation: ExistingVaultProviderPreparation = {
        kind: readiness,
        provider: { setupType, oauthFile: $state.snapshot(oauth.config) },
      };
      return ok(preparation);
    }
    if (setupType === LOCAL_FOLDER_PROVIDER_TYPE) {
      if (folder.kind !== LocalFolderDraftKind.Configured) {
        const missingLocalFolder: ExistingVaultProviderPreparation = {
          kind: NookExistingVaultProviderReadiness.MissingLocalFolder,
        };
        return ok(missingLocalFolder);
      }
      const preparation: ExistingVaultProviderPreparation = {
        kind: readiness,
        provider: { setupType, localFolder: $state.snapshot(folder.config) },
      };
      return ok(preparation);
    }
    const preparation: ExistingVaultProviderPreparation = {
      kind: readiness,
      provider: { setupType: LOCAL_PROVIDER_TYPE },
    };
    return ok(preparation);
  }
}
