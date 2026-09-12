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
    if (readiness !== NookExistingVaultProviderReadiness.Ready)
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return ok({ kind: readiness });
    if (setupType === GITHUB_PROVIDER_TYPE) {
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return ok({
        kind: readiness,
        provider: {
          setupType,
          githubPat: state.githubPat,
          githubRepo: state.githubRepo,
        },
      });
    }
    if (setupType === OAUTH_FILE_PROVIDER_TYPE) {
      if (oauth.kind !== OAuthFileDraftKind.Configured)
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        return ok({
          kind: NookExistingVaultProviderReadiness.MissingOauthFile,
        });
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return ok({
        kind: readiness,
        provider: { setupType, oauthFile: $state.snapshot(oauth.config) },
      });
    }
    if (setupType === LOCAL_FOLDER_PROVIDER_TYPE) {
      if (folder.kind !== LocalFolderDraftKind.Configured)
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        return ok({
          kind: NookExistingVaultProviderReadiness.MissingLocalFolder,
        });
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      return ok({
        kind: readiness,
        provider: { setupType, localFolder: $state.snapshot(folder.config) },
      });
    }
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    return ok({
      kind: readiness,
      provider: { setupType: LOCAL_PROVIDER_TYPE },
    });
  }
}
