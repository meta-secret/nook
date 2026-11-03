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
import type { StorageProvider } from "$lib/auth/providers";
import { provider_onboarding_type } from "$lib/vault/architecture-model";
import {
  SharedJoinerSelectionKind,
  type SharedJoinerSelection,
} from "$lib/vault/shared-joiner-selection";
import {
  InviteProviderChoiceKind,
  type InviteProviderChoice,
} from "$lib/vault/invite-provider-choice";

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
  readonly providerType: StorageProvider["provider"]["type"];
};

const log = browserLogRuntime.createLogger("identity-enrollment");

export type EnrollmentCodeIssueRequest = {
  readonly passphrase: string;
  /** The providers the invite carries, in the inviter's order. */
  readonly providers: readonly InviteProviderChoice[];
};

type InviteProviderBuild = Result<
  NookEnrollmentProvider,
  EnrollmentIssueFailure | StorageOperationFailure
>;

type SharedInviteGrant = {
  readonly provider: StorageProvider;
  readonly joiner: SharedJoinerSelection;
};

type InviteProviderSource = {
  readonly choice: InviteProviderChoice;
  readonly provider: StorageProvider;
};

const PASSPHRASE_MIN_LENGTH = 8;

/** Issues one-time codes that invite a new app into the current identity. */
export class IdentityEnrollmentIssue {
  constructor(private readonly state: VaultState) {}

  async issueEnrollmentCode({
    passphrase,
    providers: choices,
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
      if (!identity) {
        return storageErr(
          new EnrollmentIssueFailure(EnrollmentIssueRejection.ProviderNotMount),
        );
      }
      if (choices.length === 0) {
        return storageErr(
          new EnrollmentIssueFailure(EnrollmentIssueRejection.ProviderRequired),
        );
      }
      const sources: InviteProviderSource[] = [];
      for (const choice of choices) {
        const provider = state.identityControl.mounts.find(
          (mount) => mount.id === choice.providerId,
        );
        if (!provider) {
          return storageErr(
            new EnrollmentIssueFailure(
              EnrollmentIssueRejection.ProviderNotMount,
            ),
          );
        }
        const source: InviteProviderSource = { choice, provider };
        sources.push(source);
      }
      // The joiner reads the identity log from these mounts, so publish it first.
      const published = await state.identityControl.syncWithMounts();
      if (published.isErr()) return storageErr(published.error);
      log.info("enrollment providers selected");
      const providers: NookEnrollmentProvider[] = [];
      for (const source of sources) {
        const built = await this.inviteProvider(source);
        if (built.isErr()) {
          for (const provider of providers) provider.free();
          return storageErr(built.error);
        }
        providers.push(built.value);
      }
      log.info("enrollment provider payload prepared");
      let payload: NookEnrollmentIssueInput;
      try {
        payload = NookEnrollmentIssueInput.for_identity(
          providers,
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

  /** One provider of the invite: a credential-free grant naming the picked
   * account for Google Drive and iCloud, or the provider with the key the
   * inviter chose for it. */
  private async inviteProvider({
    choice,
    provider,
  }: InviteProviderSource): Promise<InviteProviderBuild> {
    const state = this.state;
    switch (provider.provider.type) {
      case "local":
        return storageErr(
          new EnrollmentIssueFailure(EnrollmentIssueRejection.LocalProvider),
        );
      case "local-folder":
        return storageErr(
          new EnrollmentIssueFailure(
            EnrollmentIssueRejection.LocalFolderProvider,
          ),
        );
      case "github":
      case "s3":
      case "oauth-file":
        break;
    }
    // Google Drive and iCloud invites name one of the provider's authorized
    // accounts and carry no provider credential; the account's access comes
    // from the provider's own sharing list.
    const usesSharedProviderGrant =
      provider_onboarding_type(provider, state.vaultArchitecture) ===
      OnboardingType.SharedProviderGrant;
    switch (choice.kind) {
      case InviteProviderChoiceKind.Personal:
        if (usesSharedProviderGrant)
          return storageErr(
            new EnrollmentIssueFailure(
              EnrollmentIssueRejection.SharedIdentityRequired,
            ),
          );
        try {
          return storageOk(
            enrollment_provider_for_architecture(
              provider,
              state.vaultArchitecture,
              choice.credential,
            ),
          );
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      case InviteProviderChoiceKind.Shared: {
        if (!usesSharedProviderGrant)
          return storageErr(
            new EnrollmentIssueFailure(
              EnrollmentIssueRejection.ProviderNotMount,
            ),
          );
        const grant: SharedInviteGrant = { provider, joiner: choice.joiner };
        return this.sharedProvider(grant);
      }
    }
  }

  private async sharedProvider({
    provider,
    joiner,
  }: SharedInviteGrant): Promise<InviteProviderBuild> {
    const state = this.state;
    switch (joiner.kind) {
      case SharedJoinerSelectionKind.None:
        return storageErr(
          new EnrollmentIssueFailure(
            EnrollmentIssueRejection.SharedIdentityRequired,
          ),
        );
      case SharedJoinerSelectionKind.Selected:
        break;
    }
    // The new device reads the vault from the shared target, so it must
    // hold the current vault event log before the invite exists.
    const targetArgs: ReturnType<typeof state.providerWasmArgs> =
      state.providerWasmArgs(provider);
    const flushed = await state.enqueueStorage(async () => {
      const admittedManager = state.admitManager();
      if (admittedManager.isErr()) return storageErr(admittedManager.error);
      try {
        await admittedManager.value.flush_event_outbox_for_provider(targetArgs);
        const flush: ProviderEventOutboxFlush = {
          providerType: provider.provider.type,
        };
        return storageOk(flush);
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure));
      }
    });
    if (flushed.isErr()) return storageErr(flushed.error);
    try {
      return storageOk(
        enrollment_shared_provider_for_architecture(
          provider,
          state.vaultArchitecture,
          joiner.email,
        ),
      );
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
  }
}
