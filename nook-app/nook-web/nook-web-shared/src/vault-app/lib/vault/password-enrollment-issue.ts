import {
  EnrollmentIssueFailure,
  EnrollmentIssueRejection,
  type EnrollmentCodeIssueResult,
} from "$lib/vault/enrollment-issue-failure";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";

import { VaultState } from "$lib/vault.svelte";
import { isoTimestamp } from "$lib/nook";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  NookEnrollmentIssueInput,
  type NookEnrollmentProvider,
  OnboardingType,
  enrollment_provider_for_architecture,
  enrollment_shared_provider_for_architecture,
  generate_id,
} from "$app-wasm";
import {
  githubPatValue,
  githubRepositoryValue,
  decodeStoredOAuthFileConfiguration,
  StoredOAuthFileConfigurationDecodeKind,
  OAuthFilePresentation,
  type StorageProvider,
} from "$lib/auth/providers";
import { provider_onboarding_type } from "$lib/vault/architecture-model";

enum StorageChainReadinessKind {
  Idle = "idle",
}

type StorageChainReadiness = {
  readonly kind: StorageChainReadinessKind.Idle;
};

type StorageChainReadinessResult = Result<
  StorageChainReadiness,
  StorageOperationFailure
>;

type StorageChainReadinessRace = {
  readonly promise: Promise<StorageChainReadinessResult>;
  readonly releaseLateValue: (readiness: StorageChainReadiness) => void;
};

type ProviderEventOutboxFlush = {
  readonly providerType: StorageProvider["type"];
};

const log = browserLogRuntime.createLogger("identity-enrollment");

export type EnrollmentCodeIssueRequest = {
  readonly passphrase: string;
  readonly providerId: string;
};

const PASSPHRASE_MIN_LENGTH = 8;

/** Issues one-time codes that invite a new app into the current identity. */
export class IdentityEnrollmentIssue {
  constructor(private readonly state: VaultState) {}

  async issueEnrollmentCode({
    passphrase,
    providerId,
  }: EnrollmentCodeIssueRequest): Promise<EnrollmentCodeIssueResult> {
    const state = this.state;
    if (!state.hasManager) {
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.ManagerUnavailable,
        ),
      );
    }
    // `isPasswordBusy` makes the periodic sync tick skip, but we still wait for
    // any already in-flight `&mut self` storage future before pushing the
    // identity log, or wasm-bindgen's borrow detector trips.
    state.isPasswordBusy = true;
    log.info("enrollment code issue started");
    try {
      // Wait for the queued wasm op to settle. We deliberately do NOT
      // `resetStorageChain()` on timeout: abandoning an in-flight `&mut self`
      // future leaves its IndexedDB transaction dangling, which surfaces later as
      // "database is not open" and poisons subsequent borrows. Surface a
      // retriable error instead.
      const storageChainReadiness: StorageChainReadiness = {
        kind: StorageChainReadinessKind.Idle,
      };
      const idleResult: StorageChainReadinessResult = storageOk(
        storageChainReadiness,
      );
      const waitForStorageRequest: StorageChainReadinessRace = {
        promise: state.waitForStorageChain().then(() => idleResult),
        releaseLateValue: () => {},
      };
      const idle = await state.raceStorageTimeout(waitForStorageRequest);
      if (idle.isErr()) return storageErr(idle.error);
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (passphrase.trim().length < PASSPHRASE_MIN_LENGTH) {
        return storageErr(
          new EnrollmentIssueFailure(
            EnrollmentIssueRejection.PassphraseTooShort,
          ),
        );
      }
      const identity = state.identityControl.snapshot;
      const selectedProvider = state.identityControl.mounts.find(
        (p) => p.id === providerId,
      );
      if (!identity || !selectedProvider) {
        return storageErr(
          new EnrollmentIssueFailure(EnrollmentIssueRejection.ProviderNotMount),
        );
      }
      // The joiner reads the identity log from this mount, so publish it first.
      const published = await state.identityControl.syncWithMounts();
      if (published.isErr()) return storageErr(published.error);
      if (!selectedProvider) {
        return storageErr(
          new EnrollmentIssueFailure(EnrollmentIssueRejection.ProviderRequired),
        );
      }
      if (selectedProvider.type === "local") {
        return storageErr(
          new EnrollmentIssueFailure(EnrollmentIssueRejection.LocalProvider),
        );
      }
      if (selectedProvider.type === "local-folder") {
        return storageErr(
          new EnrollmentIssueFailure(
            EnrollmentIssueRejection.LocalFolderProvider,
          ),
        );
      }
      const githubPat = githubPatValue(selectedProvider.githubPat);
      const githubRepo = githubRepositoryValue(selectedProvider.githubRepo);
      const selectedOauthConfiguration = decodeStoredOAuthFileConfiguration(
        selectedProvider.oauthFile,
      );
      // Google Drive and iCloud invites name one of the provider's authorized
      // accounts and carry no provider credential; the account's access comes
      // from the provider's own sharing list.
      const sharedJoinerIdentity = state.sharedJoinerIdentity.trim();
      const usesSharedProviderGrant =
        provider_onboarding_type(selectedProvider, state.vaultArchitecture) ===
        OnboardingType.SharedProviderGrant;
      log.info("enrollment provider selected");
      if (
        selectedProvider.type === "github" &&
        !usesSharedProviderGrant &&
        (!githubPat || !githubRepo)
      ) {
        return storageErr(
          new EnrollmentIssueFailure(
            EnrollmentIssueRejection.GithubCredentialsRequired,
          ),
        );
      }
      state.sharedGrantInstructions = "";
      let provider: NookEnrollmentProvider;
      if (usesSharedProviderGrant) {
        if (
          selectedOauthConfiguration.kind !==
          StoredOAuthFileConfigurationDecodeKind.Configured
        ) {
          return storageErr(
            new EnrollmentIssueFailure(
              EnrollmentIssueRejection.OAuthProviderRequired,
            ),
          );
        }
        const presentation = new OAuthFilePresentation(
          selectedOauthConfiguration.config,
        );
        if (selectedOauthConfiguration.config.preset === "icloud") {
          if (!presentation.hasICloudShareTarget())
            return storageErr(
              new EnrollmentIssueFailure(
                EnrollmentIssueRejection.ICloudTargetRequired,
              ),
            );
        } else if (!presentation.hasGoogleDriveFolder()) {
          return storageErr(
            new EnrollmentIssueFailure(
              EnrollmentIssueRejection.SharedTargetUnavailable,
            ),
          );
        }
        if (!sharedJoinerIdentity) {
          return storageErr(
            new EnrollmentIssueFailure(
              EnrollmentIssueRejection.SharedIdentityRequired,
            ),
          );
        }
        // The new device reads the vault from the shared target, so it must
        // hold the current vault event log before the invite exists.
        const targetArgs: ReturnType<typeof state.providerWasmArgs> =
          state.providerWasmArgs(selectedProvider);
        const flushed = await state.enqueueStorage(async () => {
          const admittedManager = state.admitManager();
          if (admittedManager.isErr()) return storageErr(admittedManager.error);
          try {
            await admittedManager.value.flush_event_outbox_for_provider(
              targetArgs.mode,
              targetArgs.pat,
              targetArgs.repo,
            );
            const flush: ProviderEventOutboxFlush = {
              providerType: selectedProvider.type,
            };
            return storageOk(flush);
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure));
          }
        });
        if (flushed.isErr()) return storageErr(flushed.error);
        try {
          provider = enrollment_shared_provider_for_architecture(
            selectedProvider,
            state.vaultArchitecture,
            sharedJoinerIdentity,
          );
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      } else {
        try {
          provider = enrollment_provider_for_architecture(
            selectedProvider,
            state.vaultArchitecture,
          );
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      }
      log.info("enrollment provider payload prepared");
      let payload: NookEnrollmentIssueInput;
      try {
        payload = NookEnrollmentIssueInput.for_identity(
          provider,
          identity.identityId,
          identity.identityLabel,
          generate_id(),
          isoTimestamp(),
        );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      // The code carries a one-time invite and the identity's vault DEKs,
      // so its holder joins without a member approving it.
      const invite: Parameters<typeof state.identityControl.issueInvite>[0] = {
        input: payload,
        passphrase: passphrase.trim(),
      };
      const issued = await state.identityControl
        .issueInvite(invite)
        .finally(() => payload.free());
      if (issued.isErr()) return storageErr(issued.error);
      const code = issued.value;
      state.enrollmentCode = code;
      log.info("enrollment code issued");
      return storageOk(code);
    } finally {
      state.isPasswordBusy = false;
    }
  }
}
