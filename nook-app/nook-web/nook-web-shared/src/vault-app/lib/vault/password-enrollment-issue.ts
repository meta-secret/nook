import {
  EnrollmentIssueFailure,
  EnrollmentIssueRejection,
  type EnrollmentCodeIssueResult,
} from "$lib/vault/enrollment-issue-failure";
import { SharedStorageGrantFailure } from "$lib/auth/oauth-failure";
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
  SharedStorageTargetKind,
  shouldFlushSharedDriveGrant,
  type SharedStorageTarget,
} from "$lib/vault/password-enrollment";
import {
  NookEnrollmentIssueInput,
  type NookEnrollmentProvider,
  OnboardingType,
  enrollment_icloud_shared_provider_for_architecture,
  enrollment_provider_for_architecture,
  enrollment_shared_provider_for_architecture,
  generate_id,
} from "$app-wasm";
import {
  bind_google_drive_shared_folder,
  configuredOAuthFile,
  githubPatValue,
  githubRepositoryValue,
  decodeStoredOAuthFileConfiguration,
  StoredOAuthFileConfigurationDecodeKind,
  oauth_access_token,
  OAuthFilePresentation,
  OAuthFileNameKind,
  type StorageProvider,
} from "$lib/auth/providers";
import {
  prepare_shared_storage_grant,
  createSharedStorageTarget,
  existingSharedStorageTarget,
  provider_onboarding_type,
  provider_oauth_preset_for_provider,
  sharedStorageGrantAccessToken,
  suggestedSharedStorageTarget,
  unavailableSharedStorageGrantCredential,
} from "$lib/vault/architecture-model";

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
  readonly target: SharedStorageTarget;
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
      const sharedJoinerIdentity = state.sharedJoinerIdentity.trim();
      const usesSharedProviderGrant =
        provider_onboarding_type(selectedProvider, state.vaultArchitecture) ===
        OnboardingType.SharedProviderGrant;
      const usesSharedICloud =
        usesSharedProviderGrant &&
        selectedOauthConfiguration.kind ===
          StoredOAuthFileConfigurationDecodeKind.Configured &&
        selectedOauthConfiguration.config.preset === "icloud";
      log.info("enrollment provider selected");
      if (
        usesSharedProviderGrant &&
        !usesSharedICloud &&
        !sharedJoinerIdentity
      ) {
        return storageErr(
          new EnrollmentIssueFailure(
            EnrollmentIssueRejection.SharedIdentityRequired,
          ),
        );
      }
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
      let sharedStorageTarget: SharedStorageTarget = {
        kind: SharedStorageTargetKind.NotBound,
      };
      let enrollmentProviderRow: StorageProvider = selectedProvider;
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
        const selectedOauth = selectedOauthConfiguration.config;
        if (usesSharedICloud) {
          if (selectedOauth.iCloudShareTarget.state === "personal") {
            return storageErr(
              new EnrollmentIssueFailure(
                EnrollmentIssueRejection.ICloudTargetRequired,
              ),
            );
          }
          const targetId = selectedOauth.iCloudShareTarget.value;
          sharedStorageTarget = {
            kind: SharedStorageTargetKind.Bound,
            storageTargetId: targetId,
          };
        } else {
          const accessCredential = oauth_access_token(selectedOauth);
          log.info("shared enrollment grant started");
          const fileName = new OAuthFilePresentation(
            selectedOauth,
          ).oauthFileName();
          const storageTargetHint =
            fileName.kind === OAuthFileNameKind.Resolved
              ? fileName.fileName
              : githubRepo;
          const folderId = selectedOauth.folderId;
          const prepareSharedStorageGrantArgs: Parameters<
            typeof prepare_shared_storage_grant
          >[0] = {
            providerType: selectedProvider.type,
            oauthPreset: provider_oauth_preset_for_provider(selectedProvider),
            joinerIdentityKind: "email",
            joinerIdentity: sharedJoinerIdentity,
            storageTargetHint: suggestedSharedStorageTarget(
              storageTargetHint || "shared folder",
            ),
            storageTarget:
              folderId.state === "folderId"
                ? existingSharedStorageTarget(folderId.value)
                : createSharedStorageTarget(),
            credential:
              accessCredential.kind === "available"
                ? sharedStorageGrantAccessToken(accessCredential.token)
                : unavailableSharedStorageGrantCredential(),
          };
          let grant;
          try {
            grant = await prepare_shared_storage_grant(
              prepareSharedStorageGrantArgs,
            );
          } catch (failure) {
            return storageErr(new NativeVaultStorageFailure(failure));
          }
          log.info("shared enrollment grant prepared");
          if (grant.kind === "unsupported") {
            return storageErr(new SharedStorageGrantFailure(grant));
          }
          const grantTarget = grant.target;
          if (grant.kind === "granted") {
            if (grantTarget.state === "unavailable") {
              return storageErr(
                new EnrollmentIssueFailure(
                  EnrollmentIssueRejection.SharedTargetUnavailable,
                ),
              );
            }
            sharedStorageTarget = {
              kind: SharedStorageTargetKind.Bound,
              storageTargetId: grantTarget.storageTargetId,
            };
            const tArgs2: Parameters<typeof state.t>[0] = {
              key: grant.note,
              replacements: {
                email: sharedJoinerIdentity,
                folder:
                  grantTarget.state === "named"
                    ? grantTarget.storageTargetName
                    : grantTarget.storageTargetId,
              },
            };
            state.sharedGrantInstructions = state.t(tArgs2);
          } else if (grant.kind === "manual-grant-required") {
            if (grantTarget.state !== "unavailable") {
              sharedStorageTarget = {
                kind: SharedStorageTargetKind.Bound,
                storageTargetId: grantTarget.storageTargetId,
              };
            }
            const tArgs: Parameters<typeof state.t>[0] = {
              key: grant.instructionsKey,
              replacements: {
                email: grant.joinerIdentity,
                folder:
                  grantTarget.state === "named"
                    ? grantTarget.storageTargetName
                    : grantTarget.state === "identified"
                      ? grantTarget.storageTargetId
                      : "shared folder",
              },
            };
            state.sharedGrantInstructions = state.t(tArgs);
          }
          if (sharedStorageTarget.kind === SharedStorageTargetKind.Bound) {
            let updatedOauth;
            try {
              updatedOauth = bind_google_drive_shared_folder(
                selectedOauth,
                sharedStorageTarget.storageTargetId,
              );
            } catch (failure) {
              return storageErr(new NativeVaultStorageFailure(failure));
            }
            enrollmentProviderRow = {
              ...selectedProvider,
              oauthFile: configuredOAuthFile(updatedOauth),
            };
            const providers = state.providers.map((row) =>
              row.id === selectedProvider.id ? enrollmentProviderRow : row,
            );
            const persistenceOptions: Parameters<
              typeof state.persistProviders
            >[0] = { replace: false, providers };
            const persistence =
              await state.persistProviders(persistenceOptions);
            if (persistence.isErr()) return storageErr(persistence.error);
            state.configureOauthFile(updatedOauth);

            if (
              (() => {
                const shouldFlushSharedDriveGrantArgs: Parameters<
                  typeof shouldFlushSharedDriveGrant
                >[0] = { grant, accessCredential };
                return shouldFlushSharedDriveGrant(
                  shouldFlushSharedDriveGrantArgs,
                );
              })()
            ) {
              // The target is not usable until it contains the current vault
              // event log, even when collaborator access needs manual completion.
              // Await Rust/WASM fan-out before issuing the enrollment code.
              const targetArgs: ReturnType<typeof state.providerWasmArgs> =
                state.providerWasmArgs(enrollmentProviderRow);
              const flushed = await state.enqueueStorage(async () => {
                const admittedManager = state.admitManager();
                if (admittedManager.isErr())
                  return storageErr(admittedManager.error);
                try {
                  await admittedManager.value.flush_event_outbox_for_provider(
                    targetArgs.mode,
                    targetArgs.pat,
                    targetArgs.repo,
                  );
                  const flush: ProviderEventOutboxFlush = {
                    providerType: selectedProvider.type,
                    target: sharedStorageTarget,
                  };
                  return storageOk(flush);
                } catch (nativeFailure) {
                  return storageErr(
                    new NativeVaultStorageFailure(nativeFailure),
                  );
                }
              });
              if (flushed.isErr()) return storageErr(flushed.error);
            }
          }
        }
        if (usesSharedICloud) {
          const targetArgs: ReturnType<typeof state.providerWasmArgs> =
            state.providerWasmArgs(enrollmentProviderRow);
          const flushed = await state.enqueueStorage(async () => {
            const admittedManager = state.admitManager();
            if (admittedManager.isErr())
              return storageErr(admittedManager.error);
            try {
              await admittedManager.value.flush_event_outbox_for_provider(
                targetArgs.mode,
                targetArgs.pat,
                targetArgs.repo,
              );
              const flush: ProviderEventOutboxFlush = {
                providerType: selectedProvider.type,
                target: sharedStorageTarget,
              };
              return storageOk(flush);
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure));
            }
          });
          if (flushed.isErr()) return storageErr(flushed.error);
        }
      }
      if (sharedStorageTarget.kind === SharedStorageTargetKind.Bound) {
        // The shared target is a new identity mount: record it and publish
        // the identity log there before the joiner reads it.
        const mounted = await state.identityControl.syncWithMounts();
        if (mounted.isErr()) return storageErr(mounted.error);
      }
      let provider: NookEnrollmentProvider;
      try {
        provider =
          usesSharedProviderGrant &&
          sharedStorageTarget.kind === SharedStorageTargetKind.Bound
            ? usesSharedICloud
              ? enrollment_icloud_shared_provider_for_architecture(
                  enrollmentProviderRow,
                  state.vaultArchitecture,
                  sharedStorageTarget.storageTargetId,
                )
              : enrollment_shared_provider_for_architecture(
                  enrollmentProviderRow,
                  state.vaultArchitecture,
                  sharedJoinerIdentity,
                  sharedStorageTarget.storageTargetId,
                )
            : enrollment_provider_for_architecture(
                enrollmentProviderRow,
                state.vaultArchitecture,
              );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
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
