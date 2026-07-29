import {
  ExistingVaultProviderSnapshotKind,
  type ExistingVaultProviderSnapshot,
} from "$lib/app-lifecycle-state";
import type { ProviderActionsContext } from "$lib/vault/action-contexts";
import {
  LocalFolderDraftKind,
  LoginSetupKind,
  OAuthFileDraftKind,
} from "$lib/vault/state/provider.svelte";

export enum ExistingVaultProviderPreparationKind {
  Inactive = "inactive",
  MissingOAuthFile = "missing-oauth-file",
  MissingLocalFolder = "missing-local-folder",
  Ready = "ready",
}

export type ExistingVaultProviderPreparation =
  | { kind: ExistingVaultProviderPreparationKind.Inactive }
  | { kind: ExistingVaultProviderPreparationKind.MissingOAuthFile }
  | { kind: ExistingVaultProviderPreparationKind.MissingLocalFolder }
  | {
      kind: ExistingVaultProviderPreparationKind.Ready;
      provider: ExistingVaultProviderSnapshot;
    };

export function prepareExistingVaultProvider(
  state: ProviderActionsContext,
): ExistingVaultProviderPreparation {
  if (state.loginSetup.kind !== LoginSetupKind.Active) {
    return { kind: ExistingVaultProviderPreparationKind.Inactive };
  }
  const setupType = state.loginSetup.providerType;
  if (
    setupType === "oauth-file" &&
    state.oauthFileDraft.kind !== OAuthFileDraftKind.Configured
  ) {
    return { kind: ExistingVaultProviderPreparationKind.MissingOAuthFile };
  }
  if (
    setupType === "local-folder" &&
    state.localFolderDraft.kind !== LocalFolderDraftKind.Configured
  ) {
    return { kind: ExistingVaultProviderPreparationKind.MissingLocalFolder };
  }
  if (setupType === "github") {
    return {
      kind: ExistingVaultProviderPreparationKind.Ready,
      provider: {
        kind: ExistingVaultProviderSnapshotKind.Github,
        setupType,
        githubPat: state.githubPat,
        githubRepo: state.githubRepo,
      },
    };
  }
  if (
    setupType === "oauth-file" &&
    state.oauthFileDraft.kind === OAuthFileDraftKind.Configured
  ) {
    return {
      kind: ExistingVaultProviderPreparationKind.Ready,
      provider: {
        kind: ExistingVaultProviderSnapshotKind.OAuthFile,
        setupType,
        oauthFile: $state.snapshot(state.oauthFileDraft.config),
      },
    };
  }
  if (
    setupType === "local-folder" &&
    state.localFolderDraft.kind === LocalFolderDraftKind.Configured
  ) {
    return {
      kind: ExistingVaultProviderPreparationKind.Ready,
      provider: {
        kind: ExistingVaultProviderSnapshotKind.LocalFolder,
        setupType,
        localFolder: $state.snapshot(state.localFolderDraft.config),
      },
    };
  }
  return {
    kind: ExistingVaultProviderPreparationKind.Ready,
    provider: {
      kind: ExistingVaultProviderSnapshotKind.Local,
      setupType,
    },
  };
}
